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

async function fetchMeta(sym) {
  try {
    const {funding:fr, openInterest:oi}=await Exchange.meta(sym);
    if (fr.unavailable || oi.unavailable) {
      document.getElementById('m-fund').textContent='N/A';
      document.getElementById('m-oi').textContent='N/A';
      return;
    }
    const fund=parseFloat(fr.lastFundingRate)*100;
    document.getElementById('m-fund').textContent=(fund>=0?'+':'')+fund.toFixed(4)+'%';
    document.getElementById('m-fund').style.color=fund>=0?'var(--gold)':'var(--accent2)';
    const oiVal=parseFloat(oi.openInterest);
    document.getElementById('m-oi').textContent=oiVal>=1000?(oiVal/1000).toFixed(2)+'K':oiVal.toFixed(2);
  } catch(e){}
}

async function toggleConnect(){
  if(connected){closeAll();return;}
  const sym=document.getElementById('ticker').value.toUpperCase().trim()||'BTCUSDT';
  const tf=document.getElementById('timeframe').value;
  showOverlay(`Fetching ${sym} historical klines...`);
  const ok=await fetchKlines(sym,tf);
  if(ok){renderChart();runAnalysis();}
  document.getElementById('ovtxt').textContent='Opening WebSocket...';
  openWS(sym,tf);
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
  document.getElementById('timeframe')?.addEventListener('change',persistAppStateSoon);
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
    toggleConnect();
  })();
});
