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

function openPaperTradeFromPlan(side, current, ind, plan, mode='manual') {
  if (!ind || !ind.risk || !Number.isFinite(current)) return false;
  const isLong = side === 'LONG';
  paperTrade = {
    side,
    symbol: document.getElementById('ticker').value.toUpperCase().trim() || 'BTCUSDT',
    entry: current,
    stop: isLong ? ind.risk.longStop : ind.risk.shortStop,
    target: isLong ? ind.risk.longTarget : ind.risk.shortTarget,
    openedAt: new Date(),
    entrySignal: plan?.side || 'NO TRADE',
    mode,
    lastExitStatus: null
  };
  syncTradeChartLines();
  if (chart) chart.update('none');
  updatePaperTrade(current, lastSignalSnapshot);
  pushAlert(isLong?'▲':'▼', isLong?'#00e5a0':'#ff4d6d', `${mode === 'auto' ? 'Auto paper' : 'Paper'} ${side} opened at ${fmtPrice(current)}. Lines added to chart.`);
  renderRiskDashboard();
  persistAppStateSoon();
  return true;
}

function closePaperTrade(reason='manual') {
  if (!paperTrade) return;
  const current = parseFloat((document.getElementById('m-price').textContent||'').replace(/[$,]/g,'')) || K.c[K.c.length-1];
  const pnl = paperTrade.side === 'LONG'
    ? (current-paperTrade.entry)/paperTrade.entry*100
    : (paperTrade.entry-current)/paperTrade.entry*100;
  const riskPerUnit = Math.abs(paperTrade.entry-paperTrade.stop);
  const rMultiple = riskPerUnit ? (paperTrade.side === 'LONG' ? current-paperTrade.entry : paperTrade.entry-current) / riskPerUnit : 0;
  paperLedger.unshift({
    ...paperTrade,
    exit: current,
    closedAt: new Date(),
    reason,
    pnl,
    rMultiple,
  });
  if (paperLedger.length > 50) paperLedger.pop();
  pushAlert('■', pnl>=0?'#00e5a0':'#ff4d6d', `Paper ${paperTrade.side} closed: ${reason}, P/L ${pnl.toFixed(2)}%`);
  paperTrade = null;
  syncTradeChartLines();
  if (chart) chart.update('none');
  renderTradeStatus(null, 'FLAT', 'Open a paper long/short to track it');
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

function exitSignalForTrade(price, sr) {
  if (!paperTrade) return {status:'Waiting', rule:'No open paper position'};
  if (paperTrade.side === 'LONG') {
    if (price <= paperTrade.stop) return {status:'SELL / STOP', rule:'Price hit long stop'};
    if (price >= paperTrade.target) return {status:'SELL / TARGET', rule:'Price hit long target'};
    if (sr && sr.cons === 'SELL' && sr.conf >= 58) return {status:'SELL / FLIP', rule:'Signal flipped against long'};
  }
  if (paperTrade.side === 'SHORT') {
    if (price >= paperTrade.stop) return {status:'COVER / STOP', rule:'Price hit short stop'};
    if (price <= paperTrade.target) return {status:'COVER / TARGET', rule:'Price hit short target'};
    if (sr && sr.cons === 'BUY' && sr.conf >= 58) return {status:'COVER / FLIP', rule:'Signal flipped against short'};
  }
  return {status:'HOLD', rule:'No exit trigger yet'};
}

function updatePaperTrade(price, sr=null) {
  if (!paperTrade || !Number.isFinite(price)) return;
  const pnl = paperTrade.side === 'LONG'
    ? (price-paperTrade.entry)/paperTrade.entry*100
    : (paperTrade.entry-price)/paperTrade.entry*100;
  const exit = exitSignalForTrade(price, sr);
  renderTradeStatus(pnl, exit.status, exit.rule);
  if (exit.status !== 'HOLD' && paperTrade.lastExitStatus !== exit.status) {
    paperTrade.lastExitStatus = exit.status;
    emitPlatformAlert(exit.status, `${paperTrade.side} ${paperTrade.symbol}: ${exit.rule}`);
    if (autoPaper && paperTrade.mode === 'auto') {
      closePaperTrade(exit.status.toLowerCase());
      lastAutoActionAt = Date.now();
    }
  }
  renderRiskDashboard();
}

function renderTradeStatus(pnl, exitStatus, rule) {
  const el = document.getElementById('trade-status');
  if (!el) return;
  if (!paperTrade) {
    el.innerHTML = `
      <div><span>Position</span><strong>FLAT</strong></div>
      <div><span>P/L</span><strong>—</strong></div>
      <div><span>Exit signal</span><strong>${exitStatus}</strong></div>
      <div><span>Rule</span><strong>${rule}</strong></div>`;
    return;
  }
  const pnlColor = pnl>=0?'var(--accent)':'var(--accent2)';
  el.innerHTML = `
    <div><span>Position</span><strong>${paperTrade.side} ${paperTrade.symbol}</strong></div>
    <div><span>P/L</span><strong style="color:${pnlColor}">${pnl.toFixed(2)}%</strong></div>
    <div><span>Exit signal</span><strong>${exitStatus}</strong></div>
    <div><span>Rule</span><strong>${rule}</strong></div>`;
}

function maybeAutoPaper() {
  if (!autoPaper || paperTrade) return;
  if (Date.now() - lastAutoActionAt < 10000) return;
  const ind = compute();
  const sr = ind ? strategies(ind) : null;
  const plan = ind && sr ? positionPlan(ind, sr) : null;
  if (!plan || (plan.side !== 'LONG' && plan.side !== 'SHORT')) return;
  const current = parseFloat((document.getElementById('m-price').textContent||'').replace(/[$,]/g,'')) || ind.last;
  const opened = openPaperTradeFromPlan(plan.side, current, ind, plan, 'auto');
  if (opened) lastAutoActionAt = Date.now();
}

function renderLedger() {
  const el = document.getElementById('paper-ledger');
  if (!el) return;
  if (!paperLedger.length) {
    el.innerHTML = '<div class="scan-empty">Closed paper trades will appear here.</div>';
    return;
  }
  el.innerHTML = paperLedger.map(t=>{
    const c = t.rMultiple >= 0 ? 'var(--accent)' : 'var(--accent2)';
    return `<div class="ledger-row">
      <strong>${t.symbol}</strong>
      <span>${t.side}</span>
      <span>${fmtPrice(t.entry)}</span>
      <span>${fmtPrice(t.exit)}</span>
      <span style="color:${c}">${t.rMultiple.toFixed(2)}R</span>
      <span class="ledger-note">${t.reason}</span>
    </div>`;
  }).join('');
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
