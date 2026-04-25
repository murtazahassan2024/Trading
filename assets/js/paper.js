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
  syncTradeChartLines();
  if (chart) chart.update('none');
  renderOpenTrades();
  if (trade) {
    const price = tradeClosePrice(trade);
    const exit = exitSignalForTrade(trade, price, lastSignalSnapshot);
    renderTradeStatus(trade, computeTradePnl(trade, price), exit.status, exit.rule);
  } else {
    renderTradeStatus(null, null, 'Waiting', 'Open a paper long/short to track it');
  }
  renderRiskDashboard();
  persistAppStateSoon();
}

function openPaperTradeFromPlan(side, current, ind, plan, mode='manual') {
  if (!ind || !ind.risk || !Number.isFinite(current)) return false;
  const symbol = currentSymbol();
  const isLong = side === 'LONG';
  if (mode === 'auto' && paperTrades.some(trade => trade.symbol === symbol)) return false;
  const newTrade = {
    tradeId: crypto.randomUUID ? crypto.randomUUID() : `trade-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    side,
    symbol,
    entry: current,
    stop: isLong ? ind.risk.longStop : ind.risk.shortStop,
    target: isLong ? ind.risk.longTarget : ind.risk.shortTarget,
    openedAt: new Date(),
    entrySignal: plan?.side || 'NO TRADE',
    mode,
    lastExitStatus: null,
    lastPrice: current
  };
  paperTrades.unshift(newTrade);
  activeTradeId = newTrade.tradeId;
  paperTrade = syncPaperTradeSelection();
  syncTradeChartLines();
  if (chart) chart.update('none');
  pushAlert(isLong?'▲':'▼', isLong?'#00e5a0':'#ff4d6d', `${mode === 'auto' ? 'Auto paper' : 'Paper'} ${side} opened at ${fmtPrice(current)}. Lines added to chart.`, {
    persist:true,
    tradeId:newTrade.tradeId,
    symbol:newTrade.symbol,
    side:newTrade.side,
    kind:'trade',
    status:'open'
  });
  renderOpenTrades();
  updatePaperTrades(current, lastSignalSnapshot);
  renderRiskDashboard();
  persistAppStateSoon();
  return true;
}

function closePaperTrade(reason='manual', tradeId = activeTradeId) {
  const trade = paperTrades.find(item => item.tradeId === tradeId) || null;
  if (!trade) return;
  const current = tradeClosePrice(trade);
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
  if (paperTrade) {
    const price = tradeClosePrice(paperTrade);
    const exit = exitSignalForTrade(paperTrade, price, lastSignalSnapshot);
    renderTradeStatus(paperTrade, computeTradePnl(paperTrade, price), exit.status, exit.rule);
  } else {
    renderTradeStatus(null, null, 'FLAT', 'Open a paper long/short to track it');
  }
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
  persistAppStateSoon();
  maybeAutoPaper();
}

function exitSignalForTrade(trade, price, sr) {
  if (!trade) return {status:'Waiting', rule:'No open paper position'};
  if (trade.side === 'LONG') {
    if (price <= trade.stop) return {status:'SELL / STOP', rule:'Price hit long stop'};
    if (price >= trade.target) return {status:'SELL / TARGET', rule:'Price hit long target'};
    if (sr && sr.cons === 'SELL' && sr.conf >= 58) return {status:'SELL / FLIP', rule:'Signal flipped against long'};
  }
  if (trade.side === 'SHORT') {
    if (price >= trade.stop) return {status:'COVER / STOP', rule:'Price hit short stop'};
    if (price <= trade.target) return {status:'COVER / TARGET', rule:'Price hit short target'};
    if (sr && sr.cons === 'BUY' && sr.conf >= 58) return {status:'COVER / FLIP', rule:'Signal flipped against short'};
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
    const exit = exitSignalForTrade(trade, price, sr);
    if (trade.tradeId === activeTradeId) {
      renderTradeStatus(trade, computeTradePnl(trade, price), exit.status, exit.rule);
    }
    if (exit.status !== 'HOLD') {
      if (trade.lastExitStatus !== exit.status) {
        trade.lastExitStatus = exit.status;
        emitPlatformAlert(exit.status, `${trade.side} ${trade.symbol}: ${exit.rule}`);
      }
      if (autoPaper && trade.mode === 'auto') {
        toClose.push({ tradeId: trade.tradeId, reason: exit.status.toLowerCase() });
      }
    }
  });
  if (!paperTrades.some(trade => trade.tradeId === activeTradeId)) {
    syncPaperTradeSelection();
  }
  renderOpenTrades();
  toClose.forEach(item => {
    closePaperTrade(item.reason, item.tradeId);
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
  if (!autoPaper) return;
  if (Date.now() - lastAutoActionAt < 10000) return;
  const ind = compute();
  const sr = ind ? strategies(ind) : null;
  const plan = ind && sr ? positionPlan(ind, sr) : null;
  if (!plan || (plan.side !== 'LONG' && plan.side !== 'SHORT')) return;
  const symbol = currentSymbol();
  if (paperTrades.some(trade => trade.symbol === symbol)) return;
  const current = parseFloat((document.getElementById('m-price').textContent||'').replace(/[$,]/g,'')) || ind.last;
  const opened = openPaperTradeFromPlan(plan.side, current, ind, plan, 'auto');
  if (opened) lastAutoActionAt = Date.now();
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
      <span class="ledger-note">${exit.status}</span>
      <button class="mini-close-btn" type="button" onclick="event.stopPropagation(); closePaperTrade('manual','${trade.tradeId}')">Close</button>
    </div>`;
  }).join('');
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
    return `<div class="ledger-row">
      <label class="ledger-check"><input type="checkbox" class="ledger-delete-check" value="${id}"/></label>
      <strong>${t.symbol}</strong>
      <span>${t.side}</span>
      <span>${fmtPrice(t.entry)}</span>
      <span>${fmtPrice(t.exit)}</span>
      <span style="color:${c}">${t.rMultiple.toFixed(2)}R</span>
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
  persistAppStateSoon();
  pushAlert('■', '#ff4d6d', `Deleted ${selected.length} closed paper trade${selected.length === 1 ? '' : 's'} from ledger.`);
}

function renderRiskDashboard() {
  const el = document.getElementById('risk-dashboard');
  if (!el) return;
  const wins = paperLedger.filter(t=>t.rMultiple>0).length;
  const totalR = paperLedger.reduce((a,t)=>a+t.rMultiple,0);
  const winRate = paperLedger.length ? wins/paperLedger.length*100 : null;
  const openRisk = paperTrade ? Math.abs(paperTrade.entry-paperTrade.stop) / paperTrade.entry * 100 : null;
  const losingStreak = paperLedger.reduce((streak,t)=>t.rMultiple<0?streak+1:0,0);
  el.innerHTML = `
    <div><span>Trades</span><strong>${paperLedger.length}</strong></div>
    <div><span>Open now</span><strong>${paperTrades.length}</strong></div>
    <div><span>Win rate</span><strong>${winRate===null?'—':winRate.toFixed(0)+'%'}</strong></div>
    <div><span>Total R</span><strong style="color:${totalR>=0?'var(--accent)':'var(--accent2)'}">${totalR.toFixed(2)}R</strong></div>
    <div><span>Open risk</span><strong>${openRisk===null?'—':openRisk.toFixed(2)+'%'}</strong></div>
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
