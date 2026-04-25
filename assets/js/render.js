function renderIndic(ind) {
  if (!ind) return;
  const {rsi:r,macd:m,bb:b,stochRsi:sr,obv:ob,atr:at,adx:ax,candle,structure,risk,volRatio,ema50above:e50,ema200above:e200,goldenCross:gc}=ind;
  const rc=r>70?'#ff4d6d':r<30?'#00e5a0':'#f5c842';
  const mc=m&&m.bullish?'#00e5a0':'#ff4d6d';
  const e50c=e50?'#00e5a0':'#ff4d6d';
  const e200c=e200?'#00e5a0':'#ff4d6d';
  const src=sr>80?'#ff4d6d':sr<20?'#00e5a0':'#f5c842';
  const obc=ob.rising?'#00e5a0':'#ff4d6d';
  const atrc=at>2?'#ff4d6d':'#7b6fff';
  const bbc=b&&b.pct>80?'#ff4d6d':b&&b.pct<20?'#00e5a0':'#f5c842';
  const axc=ax>=28?'#00e5a0':ax>=20?'#f5c842':'#7a7a9a';
  const cc=candle.bias==='BUY'?'#00e5a0':candle.bias==='SELL'?'#ff4d6d':'#f5c842';
  const sc=structure&&structure.nearSupport?'#00e5a0':structure&&structure.nearResistance?'#ff4d6d':'#f5c842';
  const riskc=risk&&risk.riskPct<=2.2?'#00e5a0':'#ff4d6d';
  const vc=volRatio>=1.15?'#00e5a0':volRatio<.75?'#ff4d6d':'#f5c842';

  document.getElementById('indic-grid').innerHTML=`
<div class="ind"><div class="in">RSI (14)</div><div class="iv" style="color:${rc}">${r!==null?r:'—'}</div><div class="is" style="color:${rc}">${r>70?'OVERBOUGHT':r<30?'OVERSOLD':'NEUTRAL'}</div><div class="bw"><div class="bf" style="width:${Math.min(100,r||0)}%;background:${rc}"></div></div></div>
<div class="ind"><div class="in">MACD (12,26,9)</div><div class="iv" style="color:${mc}">${m?m.hist.toFixed(3):'—'}</div><div class="is" style="color:${mc}">${m?(m.bullCross?'BULL CROSS ↑':m.bearCross?'BEAR CROSS ↓':m.bullish?'BULLISH':'BEARISH'):'—'}</div><div class="bw"><div class="bf" style="width:${m&&m.bullish?72:30}%;background:${mc}"></div></div></div>
<div class="ind"><div class="in">EMA 50</div><div class="iv" style="color:${e50c}">${e50!==null?(e50?'ABOVE':'BELOW'):'—'}</div><div class="is" style="color:${e50c}">${e50?'Bullish bias':'Bearish bias'}</div><div class="bw"><div class="bf" style="width:${e50?72:30}%;background:${e50c}"></div></div></div>
<div class="ind"><div class="in">EMA 200</div><div class="iv" style="color:${e200c}">${e200!==null?(e200?'ABOVE':'BELOW'):'—'}</div><div class="is" style="color:${e200c}">${gc?'Golden cross':'Death cross'}</div><div class="bw"><div class="bf" style="width:${e200?75:28}%;background:${e200c}"></div></div></div>
<div class="ind"><div class="in">Stoch RSI</div><div class="iv" style="color:${src}">${sr!==null?sr.toFixed(1):'—'}</div><div class="is" style="color:${src}">${sr>80?'OVERBOUGHT':sr<20?'OVERSOLD':'NEUTRAL'}</div><div class="bw"><div class="bf" style="width:${sr||0}%;background:${src}"></div></div></div>
<div class="ind"><div class="in">OBV</div><div class="iv" style="color:${obc}">${ob.rising?'RISING':'FALLING'}</div><div class="is" style="color:${obc}">On-balance volume</div><div class="bw"><div class="bf" style="width:${ob.rising?68:35}%;background:${obc}"></div></div></div>
<div class="ind"><div class="in">Bollinger %B</div><div class="iv" style="color:${bbc}">${b?b.pct.toFixed(1)+'%':'—'}</div><div class="is" style="color:${bbc}">${b?(b.pct>80?'Near upper band':b.pct<20?'Near lower band':'Mid-band'):'—'}</div><div class="bw"><div class="bf" style="width:${b?Math.min(100,Math.max(0,b.pct)):50}%;background:${bbc}"></div></div></div>
<div class="ind"><div class="in">ATR %</div><div class="iv" style="color:${atrc}">${at!==null?at+'%':'—'}</div><div class="is" style="color:${atrc}">${at>2?'HIGH VOLATILITY':at>1?'MODERATE':'LOW VOL'}</div><div class="bw"><div class="bf" style="width:${at?Math.min(100,at*15):0}%;background:${atrc}"></div></div></div>
<div class="ind"><div class="in">ADX Regime</div><div class="iv" style="color:${axc}">${ax!==null?ax:'—'}</div><div class="is" style="color:${axc}">${ax>=28?'STRONG TREND':ax>=20?'DEVELOPING':'RANGE / CHOP'}</div><div class="bw"><div class="bf" style="width:${ax?Math.min(100,ax):0}%;background:${axc}"></div></div></div>
<div class="ind"><div class="in">Candlestick</div><div class="iv" style="color:${cc}">${candle.bias}</div><div class="is" style="color:${cc}">${candle.pattern}</div><div class="bw"><div class="bf" style="width:${candle.bias==='NEUTRAL'?45:78}%;background:${cc}"></div></div></div>
<div class="ind"><div class="in">S/R Location</div><div class="iv" style="color:${sc}">${structure?structure.rangePct+'%':'—'}</div><div class="is" style="color:${sc}">${structure&&structure.nearSupport?'Near support':structure&&structure.nearResistance?'Near resistance':'Mid-range'}</div><div class="bw"><div class="bf" style="width:${structure?structure.rangePct:0}%;background:${sc}"></div></div></div>
<div class="ind"><div class="in">ATR Risk Plan</div><div class="iv" style="color:${riskc}">${risk?risk.rr+'R':'—'}</div><div class="is" style="color:${riskc}">${risk?'SL '+risk.riskPct+'% | T '+fmtPrice(risk.longTarget):'Waiting'}</div><div class="bw"><div class="bf" style="width:${risk?clamp(100-risk.riskPct*25,5,95):0}%;background:${riskc}"></div></div></div>
<div class="ind"><div class="in">Volume vs 20</div><div class="iv" style="color:${vc}">${volRatio?volRatio+'x':'—'}</div><div class="is" style="color:${vc}">${volRatio>=1.15?'Participation rising':volRatio<.75?'Thin volume':'Normal volume'}</div><div class="bw"><div class="bf" style="width:${volRatio?clamp(volRatio*50,5,100):0}%;background:${vc}"></div></div></div>`;
}

function renderSignals(sr) {
  if (!sr) return;
  const {list,cons,conf,plan}=sr;
  lastSignalSnapshot = sr;
  const bs=document.getElementById('big-signal');
  const sw=document.getElementById('sig-word');
  bs.className='big-signal '+(cons==='BUY'?'buy':cons==='SELL'?'sell':'hold');
  sw.style.color=cons==='BUY'?'var(--accent)':cons==='SELL'?'var(--accent2)':'var(--gold)';
  sw.innerHTML=`<span>FINAL DECISION: </span><strong>${cons}</strong>`;
  document.getElementById('sig-conf').textContent=`Confidence: ${conf}% · edge ${sr.edge}% · ${sr.trending?'trend regime':'range regime'} · ${sr.riskOk?'risk ok':'risk elevated'}`;
  renderPositionPlan(plan);
  renderPositionSizing(plan);
  document.getElementById('strat-list').innerHTML=list.map(s=>`
    <div class="si"><div><div class="sn">${s.name}</div><div class="sa">${s.author}</div></div>
    <span class="badge ${s.signal==='BUY'?'b-buy':s.signal==='HOLD'?'b-hold':s.signal==='SHORT'?'b-short':'b-sell'}">${s.signal}</span></div>`).join('');
  document.getElementById('books').innerHTML=BOOKS.map(b=>{
    const m=list.find(s=>s.strat===b.strat)||{signal:'—'};
    const sc=m.signal==='BUY'?'#00e5a0':m.signal==='SELL'||m.signal==='SHORT'?'#ff4d6d':m.signal==='HOLD'?'#f5c842':'var(--muted)';
    return`<div class="bc" style="border-left-color:${b.color}"><div class="bt">${b.title}</div><div class="bau">${b.author}</div><div class="bs" style="color:${b.color}">${b.strat}: <strong style="color:${sc}">${m.signal}</strong></div></div>`;
  }).join('');
}

function renderPositionPlan(plan) {
  const el = document.getElementById('position-plan');
  if (!el || !plan) return;
  el.className = `position-plan ${plan.cls}`;
  el.innerHTML = `
    <div class="plan-side">${plan.side}</div>
    <div class="plan-grid">
      <span>Entry</span><strong>${fmtPrice(plan.entry)}</strong>
      <span>Stop</span><strong>${fmtPrice(plan.stop)}</strong>
      <span>Target</span><strong>${fmtPrice(plan.target)}</strong>
      <span>Why</span><strong>${plan.reason}</strong>
    </div>
  `;
}

function accountInputs() {
  return {
    account: Math.max(0, Number(document.getElementById('acct-size')?.value || 0)),
    riskPct: Math.max(0, Number(document.getElementById('risk-pct')?.value || 0)),
    feePct: Math.max(0, Number(document.getElementById('fee-pct')?.value || 0)),
  };
}

function renderPositionSizing(plan = lastSignalSnapshot?.plan) {
  const el = document.getElementById('position-size-result');
  if (!el) return;
  if (!plan || !Number.isFinite(plan.entry) || !Number.isFinite(plan.stop)) {
    el.textContent = 'No valid stop distance yet. Wait for a LONG/SHORT plan or open a paper trade.';
    return;
  }
  const {account, riskPct, feePct} = accountInputs();
  const riskDollars = account * riskPct / 100;
  const stopDistance = Math.abs(plan.entry-plan.stop);
  const qty = stopDistance > 0 ? riskDollars / stopDistance : 0;
  const notional = qty * plan.entry;
  const fees = notional * feePct / 100 * 2;
  el.innerHTML = `Risk $${riskDollars.toFixed(2)} · Qty ${qty.toFixed(5)} · Notional $${notional.toFixed(2)} · est. round-trip fees $${fees.toFixed(2)}`;
}

function renderScanner(rows) {
  const valid = rows.filter(r=>!r.error);
  const table = document.getElementById('scanner-table');
  if (!table) return;
  if (!valid.length) {
    table.innerHTML = '<div class="scan-empty">No scanner data available yet.</div>';
    return;
  }

  const bestBuy = [...valid].sort((a,b)=>b.longScore-a.longScore)[0];
  const bestSell = [...valid].sort((a,b)=>b.shortScore-a.shortScore)[0];
  renderPick('best-buy', bestBuy, 'LONG');
  renderPick('best-sell', bestSell, 'SHORT');

  table.innerHTML = valid
    .sort((a,b)=>Math.max(b.longScore,b.shortScore)-Math.max(a.longScore,a.shortScore))
    .map(r=>{
      const color=r.side==='LONG'?'var(--accent)':r.side==='SHORT'?'var(--accent2)':'var(--gold)';
      const bar=clamp(Math.max(r.longScore,r.shortScore)*12,5,100);
      return `<div class="scan-row" onclick="selectSymbol('${r.symbol}')">
        <div class="scan-symbol">${r.symbol}</div>
        <div class="scan-signal ${r.side==='LONG'?'buy':r.side==='SHORT'?'sell':'hold'}">${r.side}</div>
        <div class="scan-bars scan-hide"><div class="scan-fill" style="width:${bar}%;background:${color}"></div></div>
        <div>${r.conf}%</div>
        <div class="scan-hide">ADX ${r.adx}</div>
        <div class="scan-hide">${r.risk}</div>
      </div>`;
    }).join('');
}

function renderPick(id, row, side) {
  const el = document.getElementById(id);
  if (!el || !row) return;
  const score = side === 'LONG' ? row.longScore : row.shortScore;
  const actionable = score > 0;
  el.onclick = () => selectSymbol(row.symbol);
  el.innerHTML = `
    <span class="pick-label">${side === 'LONG' ? 'Best long watch' : 'Best short watch'}</span>
    <strong>${actionable ? row.symbol : 'No clean setup'}</strong>
    <small>${side} · ${row.signal} · confidence ${row.conf}% · ${row.regime} · ${row.risk}</small>
  `;
}

function pushAlert(icon,color,text, meta={}) {
  const t=new Date();
  const ts=t.getHours()+':'+(t.getMinutes()+'').padStart(2,'0')+':'+(t.getSeconds()+'').padStart(2,'0');
  const alert = {icon,color,text,ts,...meta};
  alertLog.unshift(alert);
  if(alertLog.length>30)alertLog.pop();
  renderAlerts();
  if (meta.persist && window.Persistence) {
    Persistence.saveAlert(alert).catch(err => Persistence.setStatus(`Alert save failed: ${err.message}`));
  }
}

function renderAlerts() {
  const el = document.getElementById('alerts');
  if (!el) return;
  el.innerHTML=alertLog.map(a=>`
    <div class="ai"><div class="aico" style="color:${a.color}">${a.icon}</div><div class="atx">${a.text}</div><div class="atm">${a.ts}</div></div>`).join('');
}

function renderOB(asks,bids) {
  const top=8;
  const ta=asks.slice(0,top), tb=bids.slice(0,top);
  if (!ta.length || !tb.length) {
    document.getElementById('ob-asks').innerHTML='<div style="font-size:11px;color:var(--muted);font-family:\'Space Mono\',monospace">Waiting for order book...</div>';
    document.getElementById('ob-bids').innerHTML='<div style="font-size:11px;color:var(--muted);font-family:\'Space Mono\',monospace">Waiting for order book...</div>';
    return;
  }
  const ma=Math.max(...ta.map(r=>parseFloat(r[1])));
  const mb=Math.max(...tb.map(r=>parseFloat(r[1])));
  document.getElementById('ob-asks').innerHTML=ta.map(r=>{
    const pct=(parseFloat(r[1])/ma*100).toFixed(0);
    return`<div class="ob-row"><div class="ob-bg" style="background:#ff4d6d;width:${pct}%"></div><div class="obp red">${parseFloat(r[0]).toLocaleString(undefined,{maximumFractionDigits:2})}</div><div class="obq">${parseFloat(r[1]).toFixed(3)}</div></div>`;
  }).join('');
  document.getElementById('ob-bids').innerHTML=tb.map(r=>{
    const pct=(parseFloat(r[1])/mb*100).toFixed(0);
    return`<div class="ob-row"><div class="ob-bg" style="background:#00e5a0;width:${pct}%"></div><div class="obp green">${parseFloat(r[0]).toLocaleString(undefined,{maximumFractionDigits:2})}</div><div class="obq">${parseFloat(r[1]).toFixed(3)}</div></div>`;
  }).join('');
}

function renderChartInsights(ind) {
  const el=document.getElementById('chart-insights');
  if(!el || !ind) return;
  const sr=strategies(ind);
  const beginner = sr.cons==='BUY'
    ? 'Bullish pressure is stronger. Prefer LONG only if stop distance fits your risk.'
    : sr.cons==='SELL'
      ? 'Bearish pressure is stronger. Prefer SHORT only if stop distance fits your risk.'
      : 'No clean edge. For learning, this is a wait-and-observe state.';
  const expert = `ADX ${ind.adx??'—'} (${sr.trending?'trend':'range'}), RSI ${ind.rsi??'—'}, MACD ${ind.macd?ind.macd.hist.toFixed(3):'—'}, ATR ${ind.atr??'—'}%, volume ${ind.volRatio??'—'}x, candle ${ind.candle.pattern}.`;
  el.innerHTML=`
    <div><span>Beginner read</span><strong>${beginner}</strong></div>
    <div><span>Expert read</span><strong>${expert}</strong></div>`;
}

function setStatus(s){
  const el=document.getElementById('ws-status');
  el.className='ws-status '+s;
  document.getElementById('ws-label').textContent=s.toUpperCase();
}

function hideOverlay(){document.getElementById('overlay').classList.add('hidden');}

function showOverlay(msg){
  document.getElementById('overlay').classList.remove('hidden');
  document.getElementById('ovtxt').textContent=msg;
}

function setLev(btn,l){
  lev=l;
  document.querySelectorAll('.lev-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('liq-warn').textContent=l>=5?`⚠ ${(100/l).toFixed(1)}% move = liq`:'';
}
