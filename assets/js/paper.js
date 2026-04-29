function openPaperTrade(side) {
  const ind = compute();
  const sr = ind ? strategies(ind) : null;
  const plan = ind && sr ? positionPlan(ind, sr) : null;
  const current = parseFloat((document.getElementById('m-price').textContent||'').replace(/[$,]/g,'')) || ind?.last;
  if (!ind || !ind.risk || !Number.isFinite(current)) {
    pushAlert('!', '#f5c842', 'No paper trade opened: waiting for enough price and ATR data');
    return;
  }
  openPaperTradeFromPlan(side, current, ind, plan, 'manual');
}

function currentSymbol() {
  return document.getElementById('ticker')?.value.toUpperCase().trim() || 'BTCUSDT';
}

function computeTradePnl(trade, price) {
  if (!trade || !Number.isFinite(price)) return null;
  return trade.side === 'LONG'
    ? (price-trade.entry)/trade.entry*100
    : (trade.entry-price)/trade.entry*100;
}

function tradeRiskMultiple(trade, price) {
  const riskPerUnit = Math.abs(trade.entry-trade.stop);
  if (!riskPerUnit) return 0;
  return trade.side === 'LONG'
    ? (price-trade.entry) / riskPerUnit
    : (trade.entry-price) / riskPerUnit;
}

function tradeSizingSnapshot(entry, stop) {
  const {account, riskPct, feePct} = accountInputs();
  const kellyCap = fractionalKellyRiskPct();
  const adjustedRiskPct = adjustedRiskPctForStreak(kellyCap ? Math.min(riskPct, kellyCap) : riskPct);
  const riskDollars = account * adjustedRiskPct / 100;
  const stopDistance = Math.abs(entry-stop);
  const qty = stopDistance > 0 ? riskDollars / stopDistance : 0;
  const notional = qty * entry;
  const impliedLeverage = account > 0 ? notional / account : 0;
  return { accountSize: account, riskPct: adjustedRiskPct, configuredRiskPct: riskPct, feePct, riskDollars, qty, notional, impliedLeverage, kellyCap };
}

function consecutiveLosses() {
  let streak = 0;
  for (const trade of paperLedger) {
    if (Number(trade.rMultiple || 0) < 0) streak++;
    else break;
  }
  return streak;
}

function adjustedRiskPctForStreak(baseRiskPct) {
  const streak = consecutiveLosses();
  if (streak >= 5) return baseRiskPct * 0.25;
  if (streak >= 3) return baseRiskPct * 0.5;
  return baseRiskPct;
}

function fractionalKellyRiskPct() {
  if (paperLedger.length < 50) return null;
  const wins = paperLedger.filter(t => Number(t.rMultiple || 0) > 0);
  const losses = paperLedger.filter(t => Number(t.rMultiple || 0) < 0);
  if (!wins.length || !losses.length) return null;
  const winRate = wins.length / paperLedger.length;
  const avgWin = wins.reduce((sum,t)=>sum + Number(t.rMultiple || 0), 0) / wins.length;
  const avgLoss = Math.abs(losses.reduce((sum,t)=>sum + Number(t.rMultiple || 0), 0) / losses.length);
  if (!avgLoss) return null;
  const odds = avgWin / avgLoss;
  const kelly = winRate - ((1 - winRate) / odds);
  return Math.max(0, Math.min(2, kelly * 25));
}

function dailyClosedLossPct() {
  const {account} = accountInputs();
  if (!account) return 0;
  const today = new Date().toDateString();
  const lossDollars = paperLedger
    .filter(t => t.closedAt && new Date(t.closedAt).toDateString() === today)
    .reduce((sum,t) => {
      const pnlR = Number(t.rMultiple || 0);
      const riskDollars = Number(t.riskDollars || 0);
      return pnlR < 0 ? sum + Math.abs(pnlR * riskDollars) : sum;
    }, 0);
  return lossDollars / account * 100;
}

function totalOpenRiskPct() {
  const {account} = accountInputs();
  if (!account) return 0;
  const risk = paperTrades.reduce((sum, trade) => {
    const sizing = tradeSizingFor(trade);
    return sum + (Number(sizing?.riskDollars) || 0);
  }, 0);
  return risk / account * 100;
}

function hardRiskGate(symbol = currentSymbol()) {
  const maxOpen = Number(document.getElementById('live-max-open')?.value || 3);
  const dailyLimit = Number(document.getElementById('daily-loss-limit')?.value || 2);
  const totalRiskCap = Math.max(0.25, dailyLimit);
  const dailyLoss = dailyClosedLossPct();
  const openRisk = totalOpenRiskPct();
  if (riskLockout) return { ok:false, reason:'Risk lockout is active' };
  if (dailyLoss >= dailyLimit) return { ok:false, reason:`Daily loss cap breached (${dailyLoss.toFixed(2)}% / ${dailyLimit}%)` };
  if (paperTrades.length >= maxOpen) return { ok:false, reason:`Max open trades reached (${paperTrades.length}/${maxOpen})` };
  if (openRisk >= totalRiskCap) return { ok:false, reason:`Total open risk cap reached (${openRisk.toFixed(2)}% / ${totalRiskCap}%)` };
  if (symbol && paperTrades.some(trade => trade.symbol === symbol)) return { ok:false, reason:`${symbol} already has an open trade` };
  const correlated = paperTrades.find(trade => {
    const corr = correlationCache?.[symbol]?.[trade.symbol] ?? correlationCache?.[trade.symbol]?.[symbol];
    return Number.isFinite(corr) && Math.abs(corr) >= 0.85;
  });
  if (correlated) {
    const corr = correlationCache?.[symbol]?.[correlated.symbol] ?? correlationCache?.[correlated.symbol]?.[symbol];
    return { ok:false, reason:`Correlation block: ${symbol} and ${correlated.symbol} are ${corr.toFixed(2)} correlated` };
  }
  return { ok:true, reason:'Risk checks passed', dailyLoss, openRisk };
}

function tradeSizingFor(trade) {
  if (!trade) return null;
  if (Number.isFinite(trade.qty) && Number.isFinite(trade.notional)) return trade;
  return tradeSizingSnapshot(trade.entry, trade.stop);
}

function currentCandles() {
  return K.c.map((close, index) => ({
    open: K.o[index],
    high: K.h[index],
    low: K.l[index],
    close
  }));
}

function refreshTradeTrailingStop(trade, candles = currentCandles()) {
  if (!trade || (trade.side !== 'LONG' && trade.side !== 'SHORT') || !candles.length) return trade;
  const atr14 = calcATR(candles);
  if (!Number.isFinite(atr14)) return trade;
  const dynamicStop = Number.isFinite(trade.dynamicStop)
    ? trade.dynamicStop
    : calcDynamicStop(trade.entry, atr14, trade.side);
  const chandelierStop = calcChandelierExit(candles, atr14, trade.side, CHANDELIER_PERIOD, CHANDELIER_MULTIPLIER, trade.chandelierStop);
  if (!Number.isFinite(chandelierStop)) return trade;
  const candidateStop = trade.side === 'LONG'
    ? Math.max(dynamicStop, chandelierStop)
    : Math.min(dynamicStop, chandelierStop);
  const tightenedStop = Number.isFinite(trade.stop)
    ? (trade.side === 'LONG' ? Math.max(trade.stop, candidateStop) : Math.min(trade.stop, candidateStop))
    : candidateStop;
  trade.atr14 = atr14;
  trade.dynamicStop = dynamicStop;
  trade.chandelierStop = chandelierStop;
  trade.stopType = tightenedStop === chandelierStop ? 'CHANDELIER' : 'INITIAL';
  trade.stopPrice = tightenedStop;
  trade.stop = tightenedStop;
  return trade;
}

function tradeClosePrice(trade) {
  if (!trade) return null;
  if (trade.symbol === currentSymbol()) {
    const live = parseFloat((document.getElementById('m-price').textContent||'').replace(/[$,]/g,''));
    if (Number.isFinite(live)) return live;
  }
  if (Number.isFinite(trade.lastPrice)) return trade.lastPrice;
  return trade.entry;
}

function selectPaperTrade(tradeId) {
  activeTradeId = tradeId;
  const trade = syncPaperTradeSelection();
  if (typeof syncAlpacaSymbol === 'function') syncAlpacaSymbol();
  syncTradeChartLines();
  if (chart) chart.update('none');
  renderOpenTrades();
  renderTradeDetail(true);
  if (trade) {
    const price = tradeClosePrice(trade);
    const exit = exitSignalForTrade(trade, price, lastSignalSnapshot);
    renderTradeStatus(trade, computeTradePnl(trade, price), exit.status, exit.rule);
  } else {
    renderTradeStatus(null, null, 'Waiting', 'Open a paper position to track it');
  }
  renderRiskDashboard();
  if (typeof previewAlpacaOrder === 'function') previewAlpacaOrder();
  persistAppStateSoon();
}

function openPaperTradeFromPlan(side, current, ind, plan, mode='manual', options={}) {
  if (!ind || !ind.risk || !Number.isFinite(current)) return false;
  const symbol = options.symbol || currentSymbol();
  const activate = options.activate !== false;
  const isLong = side === 'LONG';
  const gate = hardRiskGate(symbol);
  if (!gate.ok) {
    pushAlert('!', '#ff4d6d', `No trade opened: ${gate.reason}`);
    updateAutoPaperStatus(`Waiting: ${gate.reason}`);
    return false;
  }
  if (mode === 'auto' && paperTrades.some(trade => trade.symbol === symbol)) return false;
  const sr = options.signalSnapshot || strategies(ind);
  const entryPlan = { ...(plan || positionPlan(ind, sr)), side };
  const entrySnapshot = compactEntrySnapshot(ind, sr, entryPlan, options.source || mode);
  if (mode === 'auto' && !entrySnapshot.quality?.autoPass) {
    pushAlert('!', '#f5c842', `Auto skipped ${side} ${symbol}: ${(entrySnapshot.quality?.blockers || ['quality gate failed']).slice(0, 2).join(', ')}`);
    return false;
  }
  const slipPct = Math.max(0, Number(document.getElementById('exec-slip')?.value || 0));
  const fillPrice = typeof applyEntrySlip === 'function' ? applyEntrySlip(current, side, slipPct) : current;
  const stopOffset = current - (entryPlan.stopPrice ?? entryPlan.stop ?? (isLong ? ind.risk.longStop : ind.risk.shortStop));
  const entryStop = fillPrice - stopOffset;
  const targetOffset = (isLong ? 1 : -1) * Math.abs(fillPrice - entryStop) * TARGET_R_MULTIPLE;
  const partialOffset = (isLong ? 1 : -1) * Math.abs(fillPrice - entryStop) * PARTIAL_EXIT_R;
  const newTrade = {
    tradeId: crypto.randomUUID ? crypto.randomUUID() : `trade-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    side,
    symbol,
    entry: fillPrice,
    stop: entryStop,
    atr14: entryPlan.atr14 ?? ind.risk.atr14,
    dynamicStop: entryStop,
    chandelierStop: entryPlan.chandelierStop ?? entryPlan.stopInfo?.chandelierStop ?? null,
    stopType: entryPlan.stopType || 'INITIAL',
    stopPrice: entryStop,
    target: fillPrice + targetOffset,
    partialTarget: fillPrice + partialOffset,
    partialExitFraction: PARTIAL_EXIT_FRACTION,
    partialClosed: false,
    openedAt: new Date(),
    entrySignal: entryPlan?.side || 'NO TRADE',
    entrySnapshot,
    mode,
    lastExitStatus: null,
    lastPrice: current,
    ...tradeSizingSnapshot(fillPrice, entryStop)
  };
  paperTrades.unshift(newTrade);
  if (activate || !activeTradeId) activeTradeId = newTrade.tradeId;
  paperTrade = syncPaperTradeSelection();
  syncTradeChartLines();
  if (chart) chart.update('none');
  pushAlert(isLong?'▲':'▼', isLong?'#00e5a0':'#ff4d6d', `${mode === 'auto' ? 'Auto paper' : 'Paper'} ${side} filled at ${fmtPrice(fillPrice)}. Lines added to chart.`, {
    persist:true,
    tradeId:newTrade.tradeId,
    symbol:newTrade.symbol,
    side:newTrade.side,
    kind:'trade',
    status:'open'
  });
  renderOpenTrades();
  renderTradeDetail(true);
  updatePaperTrades(current, lastSignalSnapshot);
  renderRiskDashboard();
  persistAppStateSoon();
  return true;
}

function closePaperTrade(reason='manual', tradeId = activeTradeId, exitPrice = null) {
  const trade = paperTrades.find(item => item.tradeId === tradeId) || null;
  if (!trade) return;
  const current = Number.isFinite(exitPrice) ? exitPrice : tradeClosePrice(trade);
  const pnl = computeTradePnl(trade, current);
  const rMultiple = tradeRiskMultiple(trade, current);
  paperLedger.unshift({
    ...trade,
    exit: current,
    closedAt: new Date(),
    reason,
    pnl,
    rMultiple,
  });
  if (paperLedger.length > 50) paperLedger.pop();
  pushAlert('■', pnl>=0?'#00e5a0':'#ff4d6d', `Paper ${trade.side} closed: ${reason}, P/L ${pnl.toFixed(2)}%`, {
    persist:true,
    tradeId:trade.tradeId,
    symbol:trade.symbol,
    side:trade.side,
    kind:'trade',
    status:'closed',
    expiresAt:new Date(Date.now()+3*24*60*60*1000).toISOString()
  });
  if (window.Persistence) {
    Persistence.markTradeAlertsClosed(trade.tradeId).catch(err => Persistence.setStatus(`Alert cleanup failed: ${err.message}`));
  }
  paperTrades = paperTrades.filter(item => item.tradeId !== trade.tradeId);
  if (activeTradeId === trade.tradeId) activeTradeId = paperTrades[0]?.tradeId || null;
  paperTrade = syncPaperTradeSelection();
  syncTradeChartLines();
  if (chart) chart.update('none');
  renderOpenTrades();
  renderTradeDetail(true);
  if (paperTrade) {
    const price = tradeClosePrice(paperTrade);
    const exit = exitSignalForTrade(paperTrade, price, lastSignalSnapshot);
    renderTradeStatus(paperTrade, computeTradePnl(paperTrade, price), exit.status, exit.rule);
  } else {
    renderTradeStatus(null, null, 'FLAT', 'Open a paper position to track it');
  }
  renderLedger();
  renderRiskDashboard();
  if (typeof runLiveReadiness === 'function') runLiveReadiness();
  persistAppStateSoon();
}

function partialClosePaperTrade(trade, exitPrice) {
  if (!trade || trade.partialClosed) return;
  const fraction = Number(trade.partialExitFraction || PARTIAL_EXIT_FRACTION);
  const closedQty = Number(trade.qty || 0) * fraction;
  const rMultiple = tradeRiskMultiple(trade, exitPrice);
  paperLedger.unshift({
    ...trade,
    qty: closedQty,
    exit: exitPrice,
    closedAt: new Date(),
    reason: 'partial',
    pnl: computeTradePnl(trade, exitPrice),
    rMultiple,
    partial: true,
  });
  trade.qty = Number(trade.qty || 0) * (1 - fraction);
  trade.notional = trade.qty * trade.entry;
  trade.riskDollars = Number(trade.riskDollars || 0) * (1 - fraction);
  trade.partialClosed = true;
  trade.stop = trade.side === 'LONG' ? Math.max(trade.stop, trade.entry) : Math.min(trade.stop, trade.entry);
  trade.stopPrice = trade.stop;
  pushAlert('◒', '#f5c842', `Partial exit ${trade.side} ${trade.symbol}: closed ${(fraction * 100).toFixed(0)}% at ${fmtPrice(exitPrice)}.`);
  renderLedger();
  renderRiskDashboard();
  persistAppStateSoon();
}

function toggleAutoPaper() {
  autoPaper = !autoPaper;
  const btn = document.getElementById('auto-paper-btn');
  if (btn) {
    btn.textContent = `Auto Paper: ${autoPaper ? 'On' : 'Off'}`;
    btn.classList.toggle('active', autoPaper);
  }
  pushAlert('A', autoPaper?'#7b6fff':'#f5c842', `Auto paper trading ${autoPaper?'enabled':'disabled'}`);
  updateAutoPaperStatus();
  persistAppStateSoon();
  maybeAutoPaper();
}

function exitSignalForTrade(trade, price, sr) {
  if (!trade) return {status:'Waiting', rule:'No open paper position'};
  if (trade.side === 'LONG') {
    if (price <= trade.stop) return {status:'SELL / STOP', rule:'Price hit long stop', exitPrice: trade.stop};
    if (!trade.partialClosed && Number.isFinite(trade.partialTarget) && price >= trade.partialTarget) return {status:'SELL / PARTIAL', rule:`Price reached ${PARTIAL_EXIT_R}R partial exit`, exitPrice: trade.partialTarget, partial:true};
    if (price >= trade.target) return {status:'SELL / TARGET', rule:'Price hit long target', exitPrice: trade.target};
    if (sr && sr.cons === 'SELL' && sr.conf >= 58) return {status:'SELL / FLIP', rule:'Signal flipped against long', exitPrice: price};
  }
  if (trade.side === 'SHORT') {
    if (price >= trade.stop) return {status:'COVER / STOP', rule:'Price hit short stop', exitPrice: trade.stop};
    if (!trade.partialClosed && Number.isFinite(trade.partialTarget) && price <= trade.partialTarget) return {status:'COVER / PARTIAL', rule:`Price reached ${PARTIAL_EXIT_R}R partial exit`, exitPrice: trade.partialTarget, partial:true};
    if (price <= trade.target) return {status:'COVER / TARGET', rule:'Price hit short target', exitPrice: trade.target};
    if (sr && sr.cons === 'BUY' && sr.conf >= 58) return {status:'COVER / FLIP', rule:'Signal flipped against short', exitPrice: price};
  }
  return {status:'HOLD', rule:'No exit trigger yet'};
}

function updatePaperTrades(price, sr=null) {
  if (!paperTrades.length || !Number.isFinite(price)) return;
  const symbol = currentSymbol();
  const toClose = [];
  paperTrades.forEach(trade => {
    if (trade.symbol !== symbol) return;
    trade.lastPrice = price;
    refreshTradeTrailingStop(trade);
    const exit = exitSignalForTrade(trade, price, sr);
    if (trade.tradeId === activeTradeId) {
      renderTradeStatus(trade, computeTradePnl(trade, price), exit.status, exit.rule);
      renderTradeDetail(false);
      renderPositionPlan(lastSignalSnapshot?.plan);
    }
    if (exit.status !== 'HOLD') {
      if (trade.lastExitStatus !== exit.status) {
        trade.lastExitStatus = exit.status;
        emitPlatformAlert(exit.status, `${trade.side} ${trade.symbol}: ${exit.rule}`);
      }
      if (exit.partial) {
        partialClosePaperTrade(trade, exit.exitPrice);
      } else if (autoPaper && trade.mode === 'auto') {
        toClose.push({ tradeId: trade.tradeId, reason: exit.status.toLowerCase(), exitPrice: exit.exitPrice });
      }
    }
  });
  if (!paperTrades.some(trade => trade.tradeId === activeTradeId)) {
    syncPaperTradeSelection();
  }
  syncTradeChartLines();
  if (chart) chart.update('none');
  renderOpenTrades();
  toClose.forEach(item => {
    closePaperTrade(item.reason, item.tradeId, item.exitPrice);
    lastAutoActionAt = Date.now();
  });
  if (!toClose.length) {
    renderRiskDashboard();
  }
}

function renderTradeStatus(trade, pnl, exitStatus, rule) {
  const el = document.getElementById('trade-status');
  if (!el) return;
  if (!trade) {
    el.innerHTML = `
      <div><span>Position</span><strong>FLAT</strong></div>
      <div><span>P/L</span><strong>—</strong></div>
      <div><span>Exit signal</span><strong>${exitStatus}</strong></div>
      <div><span>Rule</span><strong>${rule}</strong></div>`;
    return;
  }
  const pnlColor = pnl>=0?'var(--accent)':'var(--accent2)';
  el.innerHTML = `
    <div><span>Position</span><strong>${trade.side} ${trade.symbol}</strong></div>
    <div><span>P/L</span><strong style="color:${pnlColor}">${pnl.toFixed(2)}%</strong></div>
    <div><span>Exit signal</span><strong>${exitStatus}</strong></div>
    <div><span>Mode</span><strong>${trade.mode === 'auto' ? 'AUTO PAPER' : 'MANUAL'}</strong></div>
    <div><span>Rule</span><strong>${rule}</strong></div>`;
}

function maybeAutoPaper() {
  if (!autoPaper) {
    updateAutoPaperStatus('Auto paper is off.');
    return;
  }
  if (Date.now() - lastAutoActionAt < 10000) {
    updateAutoPaperStatus('Waiting: auto paper cooldown is active.');
    return;
  }
  const ind = compute();
  const sr = ind ? strategies(ind) : null;
  const plan = ind && sr ? positionPlan(ind, sr) : null;
  if (!plan || (plan.side !== 'LONG' && plan.side !== 'SHORT')) {
    const reason = plan?.reason || 'need a higher-probability setup first.';
    const mtfNote = reason.includes('MTF entry')
      ? ' Scanner confidence is raw for the dropdown timeframe; Auto Paper waits for 4h/1h/15m confluence.'
      : '';
    updateAutoPaperStatus(`Waiting: ${reason}.${mtfNote}`);
    return;
  }
  const symbol = currentSymbol();
  if (paperTrades.some(trade => trade.symbol === symbol)) {
    updateAutoPaperStatus(`Waiting: ${symbol} already has an open paper trade.`);
    return;
  }
  const current = parseFloat((document.getElementById('m-price').textContent||'').replace(/[$,]/g,'')) || ind.last;
  const quality = tradeQuality(ind, sr, plan.side);
  if (!quality?.autoPass) {
    lastAutoActionAt = Date.now();
    updateAutoPaperStatus(autoPaperQualityMessage(symbol, plan.side, quality));
    pushAlert('!', '#f5c842', `Auto skipped ${plan.side} ${symbol}: ${(quality?.blockers || ['quality gate failed']).slice(0, 2).join(', ')}`);
    return;
  }
  updateAutoPaperStatus(`Ready: ${plan.side} ${symbol} passed auto quality checks.`);
  const opened = openPaperTradeFromPlan(plan.side, current, ind, plan, 'auto');
  if (opened) lastAutoActionAt = Date.now();
}

function autoPaperQualityMessage(symbol, side, quality) {
  if (!quality) return `Waiting: ${side} ${symbol} quality gate failed.`;
  const blockers = quality.blockers?.length ? `; ${quality.blockers.slice(0, 2).join(', ')}` : '';
  const blockerCount = quality.blockers?.length || 0;
  return `Waiting: ${side} ${symbol} score ${quality.score}/72, EV ${quality.expectedValueR}/0.20R, blockers ${blockerCount}/1${blockers}.`;
}

function updateAutoPaperStatus(message = null) {
  const el = document.getElementById('auto-paper-status');
  if (!el) return;
  el.textContent = message || (autoPaper ? 'Auto paper is watching for a qualified probability setup.' : 'Auto paper is off.');
  el.style.color = autoPaper ? 'var(--accent3)' : 'var(--muted)';
}

function renderOpenTrades() {
  const el = document.getElementById('open-paper-trades');
  if (!el) return;
  if (!paperTrades.length) {
    el.innerHTML = '<div class="scan-empty">No open paper trades yet.</div>';
    return;
  }
  el.innerHTML = paperTrades.map(trade => {
    const selected = trade.tradeId === activeTradeId;
    const price = tradeClosePrice(trade);
    const pnl = computeTradePnl(trade, price);
    const exit = exitSignalForTrade(trade, price, trade.symbol === currentSymbol() ? lastSignalSnapshot : null);
    return `<div class="open-trade-row ${selected ? 'selected' : ''}" onclick="selectPaperTrade('${trade.tradeId}')">
      <strong>${trade.symbol}</strong>
      <span>${trade.side}</span>
      <span class="open-trade-mode ${trade.mode}">${trade.mode === 'auto' ? 'AUTO' : 'MANUAL'}</span>
      <span>${fmtPrice(trade.entry)}</span>
      <span>${Number.isFinite(price) ? fmtPrice(price) : '—'}</span>
      <span style="color:${pnl >= 0 ? 'var(--accent)' : 'var(--accent2)'}">${pnl === null ? '—' : `${pnl.toFixed(2)}%`}</span>
      <span class="ledger-note">${formatTradeAge(trade.openedAt)}</span>
      <span class="ledger-note">${exit.status}</span>
      <button class="mini-close-btn" type="button" onclick="event.stopPropagation(); closePaperTrade('manual','${trade.tradeId}')">Close</button>
    </div>`;
  }).join('');
}

function formatTradeAge(openedAt) {
  if (!openedAt) return '—';
  const opened = new Date(openedAt);
  if (Number.isNaN(opened.getTime())) return '—';
  const seconds = Math.max(0, Math.floor((Date.now() - opened.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function formatTradeOpenedAt(openedAt) {
  if (!openedAt) return '—';
  const opened = new Date(openedAt);
  if (Number.isNaN(opened.getTime())) return '—';
  const mins = Math.max(0, Math.floor((Date.now() - opened.getTime()) / 60000));
  const age = mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
  return `${opened.toLocaleString()} · ${age}`;
}

function setTradeDetailText(id, value, color = '') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value;
  el.style.color = color;
}

function renderTradeDetail(refreshChart = false) {
  const panel = document.getElementById('trade-detail');
  if (!panel) return;
  const trade = syncPaperTradeSelection();
  if (!trade) {
    panel.hidden = true;
    if (tradeDetailChart) {
      tradeDetailChart.destroy();
      tradeDetailChart = null;
    }
    return;
  }
  panel.hidden = false;
  const price = tradeClosePrice(trade);
  const pnl = computeTradePnl(trade, price);
  const rMultiple = tradeRiskMultiple(trade, price);
  const sizing = tradeSizingFor(trade);
  const qty = Number.isFinite(sizing?.qty) ? sizing.qty : null;
  const entryValue = Number.isFinite(sizing?.notional) ? sizing.notional : null;
  const currentValue = qty !== null && Number.isFinite(price) ? qty * price : null;
  const riskDollars = Number.isFinite(sizing?.riskDollars) ? sizing.riskDollars : null;
  const pnlColor = pnl >= 0 ? 'var(--accent)' : 'var(--accent2)';

  setTradeDetailText('td-title', `${trade.side} ${trade.symbol} · ${trade.mode === 'auto' ? 'AUTO' : 'MANUAL'}`);
  setTradeDetailText('td-opened', formatTradeOpenedAt(trade.openedAt));
  setTradeDetailText('td-entry', fmtPrice(trade.entry));
  setTradeDetailText('td-current', Number.isFinite(price) ? fmtPrice(price) : '—');
  setTradeDetailText('td-pnl', pnl === null ? '—' : `${pnl.toFixed(2)}% · ${rMultiple.toFixed(2)}R`, pnl === null ? '' : pnlColor);
  setTradeDetailText('td-entry-value', entryValue === null ? '—' : `$${entryValue.toFixed(2)}`);
  setTradeDetailText('td-current-value', currentValue === null ? '—' : `$${currentValue.toFixed(2)}`, currentValue !== null && entryValue !== null ? pnlColor : '');
  setTradeDetailText('td-qty', qty === null ? '—' : qty.toFixed(5));
  setTradeDetailText('td-risk', riskDollars === null ? '—' : `$${riskDollars.toFixed(2)} · ${trade.riskPct ?? sizing?.riskPct ?? '—'}%`);
  setTradeDetailText('td-stop', `${fmtPrice(trade.stop)} (${trade.stopType === 'CHANDELIER' ? 'Chandelier' : `ATR x ${ATR_STOP_MULTIPLIER.toFixed(1)}`})`);
  setTradeDetailText('td-target', fmtPrice(trade.target));

  const chartBtn = document.getElementById('td-open-chart');
  if (chartBtn) chartBtn.onclick = () => selectSymbol(trade.symbol);
  if (refreshChart) renderTradeDetailChart(trade);
}

async function renderTradeDetailChart(trade) {
  const canvas = document.getElementById('tradeDetailChart');
  if (!canvas || !trade) return;
  const token = ++tradeDetailChartToken;
  let labels = [];
  let closes = [];
  try {
    if (trade.symbol === currentSymbol() && K.c.length) {
      labels = K.labels.slice(-100);
      closes = K.c.slice(-100);
    } else {
      const tf = document.getElementById('timeframe')?.value || '5m';
      const data = await fetchKlineData(trade.symbol, tf, 120);
      if (token !== tradeDetailChartToken || trade.tradeId !== activeTradeId) return;
      labels = data.map(k => {
        const d = new Date(k[0]);
        return d.getHours()+':'+(d.getMinutes()+'').padStart(2,'0');
      });
      closes = data.map(k => +k[4]);
    }
  } catch (error) {
    pushAlert('!', '#f5c842', `Could not load detail chart for ${trade.symbol}`);
    return;
  }
  if (!labels.length || !closes.length) return;
  const line = value => new Array(labels.length).fill(value);
  const datasets = [
    {label:'Price',data:closes,borderColor:cssVar('--accent3'),borderWidth:1.8,pointRadius:0,tension:.18},
    {label:'Entry',data:line(trade.entry),borderColor:'#f5c842',borderWidth:1,borderDash:[5,5],pointRadius:0},
    {label:'Stop',data:line(trade.stop),borderColor:'#ff4d6d',borderWidth:1,borderDash:[4,4],pointRadius:0},
    {label:'Target',data:line(trade.target),borderColor:'#00e5a0',borderWidth:1,borderDash:[4,4],pointRadius:0}
  ];
  if (!tradeDetailChart) {
    tradeDetailChart = new Chart(canvas, {
      type:'line',
      data:{labels,datasets},
      options:baseMiniChartOptions()
    });
  } else {
    tradeDetailChart.data.labels = labels;
    tradeDetailChart.data.datasets = datasets;
    tradeDetailChart.update('none');
  }
}

function renderLedger() {
  const el = document.getElementById('paper-ledger');
  if (!el) return;
  const selectAll = document.getElementById('ledger-select-all');
  if (selectAll) selectAll.checked = false;
  if (!paperLedger.length) {
    el.innerHTML = '<div class="scan-empty">Closed paper trades will appear here.</div>';
    return;
  }
  el.innerHTML = paperLedger.map((t, index)=>{
    const c = t.rMultiple >= 0 ? 'var(--accent)' : 'var(--accent2)';
    const id = t.tradeId || `ledger-${index}`;
    return `<div class="ledger-row paper-ledger-row">
      <label class="ledger-check"><input type="checkbox" class="ledger-delete-check" value="${id}"/></label>
      <strong>${t.symbol}</strong>
      <span>${t.side}</span>
      <span>${fmtPrice(t.entry)}</span>
      <span>${fmtPrice(t.exit)}</span>
      <span style="color:${c}">${t.rMultiple.toFixed(2)}R</span>
      <span class="ledger-note">Q ${t.entrySnapshot?.quality?.score ?? '—'} · EV ${t.entrySnapshot?.quality?.expectedValueR ?? '—'}R</span>
      <span class="ledger-note">${t.reason}</span>
    </div>`;
  }).join('');
}

function toggleLedgerSelection(checked) {
  document.querySelectorAll('.ledger-delete-check').forEach(input => { input.checked = checked; });
}

function deleteSelectedLedgerTrades() {
  const selected = [...document.querySelectorAll('.ledger-delete-check:checked')].map(input => input.value);
  if (!selected.length) {
    pushAlert('!', '#f5c842', 'Select closed paper trades before deleting.');
    return;
  }
  paperLedger = paperLedger.filter((trade, index) => !selected.includes(trade.tradeId || `ledger-${index}`));
  renderLedger();
  renderRiskDashboard();
  if (typeof runLiveReadiness === 'function') runLiveReadiness();
  persistAppStateSoon();
  pushAlert('■', '#ff4d6d', `Deleted ${selected.length} closed paper trade${selected.length === 1 ? '' : 's'} from ledger.`);
}

function renderRiskDashboard() {
  const el = document.getElementById('risk-dashboard');
  if (!el) return;
  const wins = paperLedger.filter(t=>t.rMultiple>0).length;
  const totalR = paperLedger.reduce((a,t)=>a+t.rMultiple,0);
  const winRate = paperLedger.length ? wins/paperLedger.length*100 : null;
  const openRisk = totalOpenRiskPct();
  const losingStreak = consecutiveLosses();
  el.innerHTML = `
    <div><span>Trades</span><strong>${paperLedger.length}</strong></div>
    <div><span>Open now</span><strong>${paperTrades.length}</strong></div>
    <div><span>Win rate</span><strong>${winRate===null?'—':winRate.toFixed(0)+'%'}</strong></div>
    <div><span>Total R</span><strong style="color:${totalR>=0?'var(--accent)':'var(--accent2)'}">${totalR.toFixed(2)}R</strong></div>
    <div><span>Open risk</span><strong>${openRisk.toFixed(2)}%</strong></div>
    <div><span>Losing streak</span><strong>${losingStreak}</strong></div>`;
}

function enableBrowserAlerts() {
  if (!('Notification' in window)) {
    document.getElementById('alert-state').textContent = 'Browser notifications are unavailable in this browser.';
    return;
  }
  Notification.requestPermission().then(permission=>{
    document.getElementById('browser-alerts').checked = permission === 'granted';
    document.getElementById('alert-state').textContent = permission === 'granted'
      ? 'Browser alerts enabled.'
      : 'Browser alerts were not enabled.';
  });
}

function playBeep() {
  if (!document.getElementById('sound-alerts')?.checked) return;
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.frequency.value = 720;
  gain.gain.value = .04;
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + .12);
}

function emitPlatformAlert(title, body) {
  playBeep();
  if (document.getElementById('browser-alerts')?.checked && 'Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body });
  }
}
