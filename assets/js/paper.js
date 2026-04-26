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
  const riskDollars = account * riskPct / 100;
  const stopDistance = Math.abs(entry-stop);
  const qty = stopDistance > 0 ? riskDollars / stopDistance : 0;
  const notional = qty * entry;
  return { accountSize: account, riskPct, feePct, riskDollars, qty, notional };
}

function tradeSizingFor(trade) {
  if (!trade) return null;
  if (Number.isFinite(trade.qty) && Number.isFinite(trade.notional)) return trade;
  return tradeSizingSnapshot(trade.entry, trade.stop);
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
    renderTradeStatus(null, null, 'Waiting', 'Open a paper long/short to track it');
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
  if (mode === 'auto' && paperTrades.some(trade => trade.symbol === symbol)) return false;
  const sr = options.signalSnapshot || strategies(ind);
  const entryPlan = { ...(plan || positionPlan(ind, sr)), side };
  const entrySnapshot = compactEntrySnapshot(ind, sr, entryPlan, options.source || mode);
  if (mode === 'auto' && !entrySnapshot.quality?.autoPass) {
    pushAlert('!', '#f5c842', `Auto skipped ${side} ${symbol}: ${(entrySnapshot.quality?.blockers || ['quality gate failed']).slice(0, 2).join(', ')}`);
    return false;
  }
  const newTrade = {
    tradeId: crypto.randomUUID ? crypto.randomUUID() : `trade-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    side,
    symbol,
    entry: current,
    stop: isLong ? ind.risk.longStop : ind.risk.shortStop,
    target: isLong ? ind.risk.longTarget : ind.risk.shortTarget,
    openedAt: new Date(),
    entrySignal: entryPlan?.side || 'NO TRADE',
    entrySnapshot,
    mode,
    lastExitStatus: null,
    lastPrice: current,
    ...tradeSizingSnapshot(current, isLong ? ind.risk.longStop : ind.risk.shortStop)
  };
  paperTrades.unshift(newTrade);
  if (activate || !activeTradeId) activeTradeId = newTrade.tradeId;
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
    renderTradeStatus(null, null, 'FLAT', 'Open a paper long/short to track it');
  }
  renderLedger();
  renderRiskDashboard();
  if (typeof runLiveReadiness === 'function') runLiveReadiness();
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
    if (price <= trade.stop) return {status:'SELL / STOP', rule:'Price hit long stop', exitPrice: trade.stop};
    if (price >= trade.target) return {status:'SELL / TARGET', rule:'Price hit long target', exitPrice: trade.target};
    if (sr && sr.cons === 'SELL' && sr.conf >= 58) return {status:'SELL / FLIP', rule:'Signal flipped against long', exitPrice: price};
  }
  if (trade.side === 'SHORT') {
    if (price >= trade.stop) return {status:'COVER / STOP', rule:'Price hit short stop', exitPrice: trade.stop};
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
    const exit = exitSignalForTrade(trade, price, sr);
    if (trade.tradeId === activeTradeId) {
      renderTradeStatus(trade, computeTradePnl(trade, price), exit.status, exit.rule);
      renderTradeDetail(false);
    }
    if (exit.status !== 'HOLD') {
      if (trade.lastExitStatus !== exit.status) {
        trade.lastExitStatus = exit.status;
        emitPlatformAlert(exit.status, `${trade.side} ${trade.symbol}: ${exit.rule}`);
      }
      if (autoPaper && trade.mode === 'auto') {
        toClose.push({ tradeId: trade.tradeId, reason: exit.status.toLowerCase(), exitPrice: exit.exitPrice });
      }
    }
  });
  if (!paperTrades.some(trade => trade.tradeId === activeTradeId)) {
    syncPaperTradeSelection();
  }
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
  if (!autoPaper) return;
  if (Date.now() - lastAutoActionAt < 10000) return;
  const ind = compute();
  const sr = ind ? strategies(ind) : null;
  const plan = ind && sr ? positionPlan(ind, sr) : null;
  if (!plan || (plan.side !== 'LONG' && plan.side !== 'SHORT')) return;
  const symbol = currentSymbol();
  if (paperTrades.some(trade => trade.symbol === symbol)) return;
  const current = parseFloat((document.getElementById('m-price').textContent||'').replace(/[$,]/g,'')) || ind.last;
  const quality = tradeQuality(ind, sr, plan.side);
  if (!quality?.autoPass) {
    lastAutoActionAt = Date.now();
    pushAlert('!', '#f5c842', `Auto skipped ${plan.side} ${symbol}: ${(quality?.blockers || ['quality gate failed']).slice(0, 2).join(', ')}`);
    return;
  }
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
  setTradeDetailText('td-stop', fmtPrice(trade.stop));
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
