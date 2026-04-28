function runAnalysis() {
  const ind=compute();
  if(!ind)return;
  renderIndic(ind);
  renderChartInsights(ind);
  const sr=strategies(ind);
  if(sr) sr.plan = positionPlan(ind, sr);
  renderSignals(sr);
  updatePaperTrades(ind.last, sr);
  maybeAutoPaper();
  if(!sr)return;
  const {rsi:r}=ind, {cons}=sr;
  if(lastCons&&lastCons!==cons){
    const c=cons==='BUY'?'#00e5a0':cons==='SELL'?'#ff4d6d':'#f5c842';
    pushAlert('◆',c,`Signal flipped to ${cons} (was ${lastCons}) — review all indicators`);
  }
  if(lastRSI!==null){
    if(lastRSI<70&&r>=70) pushAlert('⚡','#ff4d6d',`RSI entered overbought (${r}) — potential reversal zone`);
    if(lastRSI>30&&r<=30) pushAlert('⚡','#00e5a0',`RSI entered oversold (${r}) — watch for bounce`);
  }
  if(ind.macd&&ind.macd.bullCross) pushAlert('▲','#00e5a0','MACD bullish crossover — momentum turning up');
  if(ind.macd&&ind.macd.bearCross) pushAlert('▼','#ff4d6d','MACD bearish crossover — momentum turning down');
  lastRSI=r; lastCons=cons;
}

function restBase() {
  return Exchange.restBase();
}

async function fetchKlines(sym,tf) {
  try {
    const data=await fetchKlineData(sym,tf,200);
    K.o.length=K.h.length=K.l.length=K.c.length=K.v.length=K.t.length=K.labels.length=0;
    data.forEach(k=>{
      K.t.push(k[0]);K.o.push(+k[1]);K.h.push(+k[2]);K.l.push(+k[3]);K.c.push(+k[4]);K.v.push(+k[5]);
      const d=new Date(k[0]);
      K.labels.push(d.getHours()+':'+(d.getMinutes()+'').padStart(2,'0'));
    });
    return true;
  } catch(e){ console.warn('kline REST fail',e); return false; }
}

async function fetchMTFKlines(sym) {
  resetMTFCandles();
  const targets = [
    ['4h', candles4h],
    ['1h', candles1h],
    ['15m', candles15m],
  ];
  await Promise.all(targets.map(async ([interval, store]) => {
    const data = await fetchKlineData(sym, interval, MTF_MAX);
    data.forEach(k => store.push({
      time: k[0],
      open: +k[1],
      high: +k[2],
      low: +k[3],
      close: +k[4],
      volume: +k[5],
    }));
  }));
}

async function fetchMeta(sym) {
  try {
    const {funding:fr, openInterest:oi, longShort}=await Exchange.meta(sym);
    if (fr.unavailable || oi.unavailable) {
      currentFundingRate = null;
      document.getElementById('m-fund').textContent='N/A';
      document.getElementById('m-oi').textContent='N/A';
      if (typeof renderFundingAdjustment === 'function') renderFundingAdjustment();
      return;
    }
    const fund=parseFloat(fr.lastFundingRate)*100;
    currentFundingRate = parseFloat(fr.lastFundingRate);
    document.getElementById('m-fund').textContent=(fund>=0?'+':'')+fund.toFixed(4)+'%';
    document.getElementById('m-fund').style.color=fund>=0?'var(--gold)':'var(--accent2)';
    if (typeof renderFundingAdjustment === 'function') renderFundingAdjustment();
    if (K.c.length) runAnalysis();
    const oiVal=parseFloat(oi.openInterest);
    if (Number.isFinite(oiVal)) {
      previousOpenInterest = Number.isFinite(currentOpenInterest) ? currentOpenInterest : oiVal;
      currentOpenInterest = oiVal;
    }
    const ratioRow = Array.isArray(longShort) ? longShort[0] : null;
    const ratio = parseFloat(ratioRow?.longShortRatio);
    currentLongShortRatio = Number.isFinite(ratio) ? ratio : null;
    document.getElementById('m-oi').textContent=oiVal>=1000?(oiVal/1000).toFixed(2)+'K':oiVal.toFixed(2);
  } catch(e){}
}

async function handleTimeframeChange() {
  persistAppStateSoon();
  const sym=document.getElementById('ticker').value.toUpperCase().trim()||'BTCUSDT';
  const tf=document.getElementById('timeframe').value;
  if (!connected) return;
  showOverlay(`Rebuilding ${sym} ${tf} candles...`);
  const ok = await fetchKlines(sym, tf);
  try { await fetchMTFKlines(sym); } catch(e) { console.warn('MTF kline REST fail', e); }
  if (ok) {
    renderChart();
    runAnalysis();
  }
  closeAll();
  openWS(sym, tf);
  fetchMeta(sym);
  scanMarkets();
  if(fundingTimer)clearInterval(fundingTimer);
  fundingTimer=setInterval(()=>fetchMeta(sym),30000);
  if(scanTimer)clearInterval(scanTimer);
  scanTimer=setInterval(scanMarkets,60000);
}

async function toggleConnect(){
  if(connected){closeAll();return;}
  const sym=document.getElementById('ticker').value.toUpperCase().trim()||'BTCUSDT';
  const tf=document.getElementById('timeframe').value;
  showOverlay(`Fetching ${sym} historical klines...`);
  const ok=await fetchKlines(sym,tf);
  try { await fetchMTFKlines(sym); }
  catch(e) { console.warn('MTF kline REST fail', e); }
  if(ok){renderChart();runAnalysis();}
  document.getElementById('ovtxt').textContent='Opening WebSocket...';
  openWS(sym,tf);
  if (typeof fetchCryptoNews === 'function') fetchCryptoNews([sym]);
  if (typeof startNewsAgeTicker === 'function') startNewsAgeTicker();
  fetchMeta(sym);
  scanMarkets();
  if(fundingTimer)clearInterval(fundingTimer);
  fundingTimer=setInterval(()=>fetchMeta(sym),30000);
  if(scanTimer)clearInterval(scanTimer);
  scanTimer=setInterval(scanMarkets,60000);
}

window.addEventListener('load',()=>{
  initTheme();
  if (window.Persistence) {
    Persistence.fillInputs();
    Persistence.setup();
  }
  ['acct-size','risk-pct','fee-pct'].forEach(id=>{
    document.getElementById(id)?.addEventListener('input',()=>{
      renderPositionSizing();
      persistAppStateSoon();
    });
  });
  document.getElementById('timeframe')?.addEventListener('change',handleTimeframeChange);
  (async()=>{
    try {
      const state = window.Persistence ? await Persistence.load() : null;
      if (state) {
        applyPersistedState(state);
        Persistence.setStatus('Loaded shared Supabase profile.');
      } else if (window.Persistence && Persistence.config().url) {
        Persistence.setStatus('Connected to shared Supabase profile. No saved state yet.');
      }
      if (window.Persistence) {
        alertLog = await Persistence.loadAlerts();
        renderAlerts();
      }
    } catch (err) {
      if (window.Persistence) Persistence.setStatus(`Load failed: ${err.message}`);
    }
    renderLedger();
    renderRiskDashboard();
    if (typeof runLiveReadiness === 'function') runLiveReadiness();
    toggleConnect();
  })();
});
