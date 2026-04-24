let lev = 1;
let chart = null;
let alertLog = [];
let lastRSI = null, lastCons = null;
let fundingTimer = null;
let scanTimer = null;
let paperTrade = null;

const K = { o:[], h:[], l:[], c:[], v:[], t:[], labels:[] };
const MAX = 200;
const SCAN_SYMBOLS = ['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','ADAUSDT','DOGEUSDT','LINKUSDT','AVAXUSDT','LTCUSDT'];

const BOOKS = [
  {title:'Technical Analysis of the Financial Markets', author:'J. Murphy', strat:'Trend + momentum', color:'#00e5a0'},
  {title:'Trading in the Zone', author:'M. Douglas', strat:'Discipline filter', color:'#7b6fff'},
  {title:'Japanese Candlestick Charting Techniques', author:'S. Nison', strat:'Candle reversal', color:'#f5c842'},
  {title:'High Probability Trading Strategies', author:'R. Miner', strat:'Momentum retrace', color:'#ff4d6d'},
  {title:'Trading for a Living', author:'A. Elder', strat:'Triple Screen', color:'#00c2ff'},
  {title:'Market Wizards', author:'J. Schwager', strat:'Trend Follow', color:'#ff9f40'}
];

function initTheme() {
  const saved = localStorage.getItem('signalos-theme');
  const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  setTheme(saved || (prefersLight ? 'light' : 'dark'));
}

function setTheme(theme) {
  const light = theme === 'light';
  document.body.classList.toggle('light', light);
  localStorage.setItem('signalos-theme', light ? 'light' : 'dark');
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = light ? 'Dark' : 'Light';
  updateChartTheme();
}

function toggleTheme() {
  setTheme(document.body.classList.contains('light') ? 'dark' : 'light');
}

function cssVar(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function fmtPrice(n) {
  if (!Number.isFinite(n)) return '—';
  return '$'+n.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:4});
}

function ema(arr, p) {
  if (arr.length < p) return [];
  const k = 2/(p+1), out = new Array(arr.length).fill(null);
  let s = 0; for (let i=0;i<p;i++) s+=arr[i];
  out[p-1] = s/p;
  for (let i=p;i<arr.length;i++) out[i] = arr[i]*k + out[i-1]*(1-k);
  return out;
}

function sma(arr, p) {
  if (arr.length < p) return null;
  return arr.slice(-p).reduce((a,b)=>a+b,0)/p;
}

function rsi(closes, p=14) {
  if (closes.length < p+1) return null;
  let g=0, l=0;
  for (let i=1;i<=p;i++) { const d=closes[i]-closes[i-1]; d>=0?g+=d:l-=d; }
  let ag=g/p, al=l/p;
  for (let i=p+1;i<closes.length;i++) {
    const d=closes[i]-closes[i-1];
    ag=(ag*(p-1)+(d>=0?d:0))/p;
    al=(al*(p-1)+(d<0?-d:0))/p;
  }
  if (al===0) return 100;
  return parseFloat((100-100/(1+ag/al)).toFixed(2));
}

function macd(closes) {
  if (closes.length < 35) return null;
  const e12=ema(closes,12), e26=ema(closes,26);
  const ml=e12.map((v,i)=>v!==null&&e26[i]!==null?v-e26[i]:null).filter(v=>v!==null);
  if (ml.length < 9) return null;
  const sig=ema(ml,9);
  const lm=ml[ml.length-1], ls=sig[sig.length-1];
  const pm=ml[ml.length-2], ps=sig[sig.length-2];
  const h=lm-ls, ph=pm-ps;
  return { hist:parseFloat(h.toFixed(4)), bullish:h>0, bullCross:ph<0&&h>0, bearCross:ph>0&&h<0 };
}

function bb(closes, p=20, m=2) {
  if (closes.length < p) return null;
  const sl=closes.slice(-p), mn=sl.reduce((a,b)=>a+b,0)/p;
  const std=Math.sqrt(sl.reduce((a,b)=>a+Math.pow(b-mn,2),0)/p);
  const last=closes[closes.length-1];
  return { upper:mn+m*std, lower:mn-m*std, pct:parseFloat(((last-(mn-m*std))/(m*std*2)*100).toFixed(1)) };
}

function stochRsi(closes, rp=14, sp=14) {
  if (closes.length < rp+sp+1) return null;
  const series=[];
  for (let i=rp;i<closes.length;i++) series.push(rsi(closes.slice(0,i+1),rp));
  if (series.length < sp) return null;
  const rc=series.slice(-sp), mn=Math.min(...rc), mx=Math.max(...rc);
  if (mx===mn) return 50;
  return parseFloat(((rc[rc.length-1]-mn)/(mx-mn)*100).toFixed(2));
}

function obv(closes, vols) {
  let o=0, prev=0;
  for (let i=1;i<closes.length;i++) {
    if (closes[i]>closes[i-1]) o+=vols[i];
    else if (closes[i]<closes[i-1]) o-=vols[i];
    if (i===closes.length-2) prev=o;
  }
  return { rising: o>prev };
}

function atr(h,l,c,p=14) {
  if (c.length < p+1) return null;
  const trs=[];
  for (let i=1;i<c.length;i++) trs.push(Math.max(h[i]-l[i],Math.abs(h[i]-c[i-1]),Math.abs(l[i]-c[i-1])));
  const s=trs.slice(-p).reduce((a,b)=>a+b,0)/p;
  return parseFloat((s/c[c.length-1]*100).toFixed(3));
}

function atrValue(h,l,c,p=14) {
  if (c.length < p+1) return null;
  const trs=[];
  for (let i=1;i<c.length;i++) trs.push(Math.max(h[i]-l[i],Math.abs(h[i]-c[i-1]),Math.abs(l[i]-c[i-1])));
  return trs.slice(-p).reduce((a,b)=>a+b,0)/p;
}

function adx(h,l,c,p=14) {
  if (c.length < p*2+1) return null;
  const tr=[], plusDM=[], minusDM=[];
  for (let i=1;i<c.length;i++) {
    const up=h[i]-h[i-1], down=l[i-1]-l[i];
    tr.push(Math.max(h[i]-l[i],Math.abs(h[i]-c[i-1]),Math.abs(l[i]-c[i-1])));
    plusDM.push(up>down&&up>0?up:0);
    minusDM.push(down>up&&down>0?down:0);
  }
  const dx=[];
  for (let i=p-1;i<tr.length;i++) {
    const trSum=tr.slice(i-p+1,i+1).reduce((a,b)=>a+b,0);
    if (trSum===0) continue;
    const pdi=100*plusDM.slice(i-p+1,i+1).reduce((a,b)=>a+b,0)/trSum;
    const mdi=100*minusDM.slice(i-p+1,i+1).reduce((a,b)=>a+b,0)/trSum;
    const den=pdi+mdi;
    dx.push(den===0?0:100*Math.abs(pdi-mdi)/den);
  }
  if (dx.length < p) return null;
  const value=dx.slice(-p).reduce((a,b)=>a+b,0)/p;
  return parseFloat(value.toFixed(2));
}

function candleSignal(o,h,l,c) {
  if (c.length < 3) return {bias:'NEUTRAL', pattern:'No pattern'};
  const i=c.length-1, p=i-1;
  const body=Math.abs(c[i]-o[i]);
  const range=Math.max(h[i]-l[i], Number.EPSILON);
  const prevBody=Math.abs(c[p]-o[p]);
  const upper=h[i]-Math.max(o[i],c[i]);
  const lower=Math.min(o[i],c[i])-l[i];
  const bullEngulf=c[i]>o[i]&&c[p]<o[p]&&c[i]>=o[p]&&o[i]<=c[p]&&body>prevBody*.8;
  const bearEngulf=c[i]<o[i]&&c[p]>o[p]&&o[i]>=c[p]&&c[i]<=o[p]&&body>prevBody*.8;
  const hammer=lower>body*2&&upper<body*.8&&body/range<.45;
  const shooting=upper>body*2&&lower<body*.8&&body/range<.45;
  if (bullEngulf) return {bias:'BUY', pattern:'Bullish engulfing'};
  if (bearEngulf) return {bias:'SELL', pattern:'Bearish engulfing'};
  if (hammer) return {bias:'BUY', pattern:'Hammer'};
  if (shooting) return {bias:'SELL', pattern:'Shooting star'};
  return {bias:'NEUTRAL', pattern:'No pattern'};
}

function marketStructure(h,l,c,p=50) {
  if (c.length < 10) return null;
  const lookback=Math.min(p,c.length);
  const highs=h.slice(-lookback), lows=l.slice(-lookback);
  const support=Math.min(...lows);
  const resistance=Math.max(...highs);
  const last=c[c.length-1];
  const range=Math.max(resistance-support, Number.EPSILON);
  return {
    support,
    resistance,
    rangePct: parseFloat(((last-support)/range*100).toFixed(1)),
    nearSupport: (last-support)/range < .25,
    nearResistance: (resistance-last)/range < .25
  };
}

function riskPlan(ind) {
  if (!ind || !ind.atrValue || !ind.last) return null;
  const stopDist=ind.atrValue*1.5;
  const targetDist=ind.atrValue*2.4;
  return {
    longStop: ind.last-stopDist,
    longTarget: ind.last+targetDist,
    shortStop: ind.last+stopDist,
    shortTarget: ind.last-targetDist,
    rr: parseFloat((targetDist/stopDist).toFixed(2)),
    riskPct: parseFloat((stopDist/ind.last*100).toFixed(2))
  };
}

function positionPlan(ind, sr) {
  if (!ind || !sr || !ind.risk) {
    return { side:'NO TRADE', cls:'none', entry:null, stop:null, target:null, reason:'Waiting for full signal stack' };
  }
  if (sr.cons === 'BUY' && sr.conf >= 58 && sr.riskOk) {
    return {
      side:'LONG',
      cls:'long',
      entry:ind.last,
      stop:ind.risk.longStop,
      target:ind.risk.longTarget,
      reason:`Long bias: ${sr.conf}% confidence, ${sr.trending?'trend':'range'} regime`
    };
  }
  if (sr.cons === 'SELL' && sr.conf >= 58 && sr.riskOk) {
    return {
      side:'SHORT',
      cls:'short',
      entry:ind.last,
      stop:ind.risk.shortStop,
      target:ind.risk.shortTarget,
      reason:`Short bias: ${sr.conf}% confidence, ${sr.trending?'trend':'range'} regime`
    };
  }
  return {
    side:'NO TRADE',
    cls:'none',
    entry:ind.last,
    stop:null,
    target:null,
    reason:`No clean edge: ${sr.cons} ${sr.conf}%`
  };
}

function computeSeries(o,h,l,c,v) {
  if (c.length < 30) return null;
  const r=rsi(c), m=macd(c), b=bb(c), sr=stochRsi(c), ob=obv(c,v), at=atr(h,l,c);
  const atrAbs=atrValue(h,l,c), ax=adx(h,l,c), candle=candleSignal(o,h,l,c), structure=marketStructure(h,l,c);
  const volAvg=sma(v,20), volRatio=volAvg?parseFloat((v[v.length-1]/volAvg).toFixed(2)):null;
  const e50=ema(c,Math.min(50,c.length)), e200=ema(c,Math.min(200,c.length));
  const le50=e50[e50.length-1], le200=e200[e200.length-1];
  const prev50=e50[Math.max(0,e50.length-6)];
  const last=c[c.length-1];
  const ind = {
    rsi:r, macd:m, bb:b, stochRsi:sr, obv:ob, atr:at,
    atrValue:atrAbs, adx:ax, candle, structure, volRatio,
    ema50above: le50!==null?last>le50:null,
    ema200above: le200!==null?last>le200:null,
    ema50Slope: le50&&prev50?parseFloat(((le50-prev50)/prev50*100).toFixed(3)):0,
    goldenCross: le50!==null&&le200!==null?le50>le200:null,
    last
  };
  ind.risk = riskPlan(ind);
  return ind;
}

function compute() {
  return computeSeries(K.o,K.h,K.l,K.c,K.v);
}

function strategies(ind) {
  if (!ind) return null;
  const {rsi:r,macd:m,stochRsi:sr,obv:ob,ema50above:e50,ema200above:e200,goldenCross:gc,adx:ax,candle,structure,volRatio,ema50Slope,risk} = ind;
  const trending=ax!==null&&ax>=22;
  const strongTrend=ax!==null&&ax>=28;
  const volumeOk=volRatio===null||volRatio>=.85;
  const riskOk=risk&&risk.riskPct<=2.2;
  const nearSupport=structure&&structure.nearSupport;
  const nearResistance=structure&&structure.nearResistance;

  const murphy = trending&&e50&&e200&&m&&m.bullish&&r>50?'BUY':trending&&!e50&&!e200&&m&&!m.bullish&&r<50?'SELL':'HOLD';
  const douglas = riskOk&&volumeOk&&ema50Slope>=.015?'BUY':riskOk&&volumeOk&&ema50Slope<=-.015?'SELL':'HOLD';
  const nison = candle.bias==='BUY'&&nearSupport?'BUY':candle.bias==='SELL'&&nearResistance?'SELL':'HOLD';
  const miner = e50&&sr!==null&&sr<35&&r>42&&m&&m.bullish?'BUY':!e50&&sr!==null&&sr>65&&r<58&&m&&!m.bullish?'SELL':'HOLD';
  const triple = e200&&m&&m.bullish&&r>48?'BUY':(!e200&&m&&!m.bullish&&r<52)?'SELL':'HOLD';
  const trend = gc&&strongTrend&&ob.rising?'BUY':gc===false&&strongTrend&&!ob.rising?'SELL':'HOLD';

  const list = [
    {name:'Trend + momentum',author:'Murphy',signal:murphy,strat:'Trend + momentum',weight:1.3},
    {name:'Discipline filter',author:'Douglas',signal:douglas,strat:'Discipline filter',weight:.8},
    {name:'Candle reversal',author:'Nison',signal:nison,strat:'Candle reversal',weight:1},
    {name:'Momentum retrace',author:'Miner',signal:miner,strat:'Momentum retrace',weight:1.2},
    {name:'Triple Screen',author:'Elder',signal:triple,strat:'Triple Screen',weight:1},
    {name:'Trend Follow',author:'Schwager',signal:trend,strat:'Trend Follow',weight:1.1}
  ];

  const buys=list.filter(s=>s.signal==='BUY').reduce((a,s)=>a+s.weight,0);
  const sells=list.filter(s=>s.signal==='SELL'||s.signal==='SHORT').reduce((a,s)=>a+s.weight,0);
  const total=list.reduce((a,s)=>a+s.weight,0);
  const edge=Math.abs(buys-sells)/total;
  let cons,conf;
  if(edge<.18){cons='HOLD';conf=50;}
  else if(buys>sells){cons='BUY';conf=Math.round(55+edge*40);}
  else{cons='SELL';conf=Math.round(55+edge*40);}
  if(!riskOk&&cons!=='HOLD'){conf=Math.max(50,conf-15);}
  return {list,cons,conf,edge:parseFloat((edge*100).toFixed(1)),riskOk,trending,buyScore:buys,sellScore:sells,totalScore:total};
}

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
  const bs=document.getElementById('big-signal');
  const sw=document.getElementById('sig-word');
  bs.className='big-signal '+(cons==='BUY'?'buy':cons==='SELL'?'sell':'hold');
  sw.style.color=cons==='BUY'?'var(--accent)':cons==='SELL'?'var(--accent2)':'var(--gold)';
  sw.textContent=cons;
  document.getElementById('sig-conf').textContent=`Confidence: ${conf}% · edge ${sr.edge}% · ${sr.trending?'trend regime':'range regime'} · ${sr.riskOk?'risk ok':'risk elevated'}`;
  renderPositionPlan(plan);
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

function seriesFromKlines(data) {
  return data.reduce((acc,k)=>{
    acc.t.push(k[0]);acc.o.push(+k[1]);acc.h.push(+k[2]);acc.l.push(+k[3]);acc.c.push(+k[4]);acc.v.push(+k[5]);
    return acc;
  }, { o:[], h:[], l:[], c:[], v:[], t:[] });
}

async function fetchKlineData(sym,tf,limit=200) {
  const url=`${restBase()}/fapi/v1/klines?symbol=${sym}&interval=${tf}&limit=${limit}`;
  const r=await fetch(url);
  const data=await r.json();
  if(!Array.isArray(data))throw new Error('not array');
  return data;
}

async function scanMarkets() {
  const tf=document.getElementById('timeframe').value;
  const rows = await Promise.all(SCAN_SYMBOLS.map(async sym=>{
    try {
      const data=await fetchKlineData(sym,tf,200);
      const s=seriesFromKlines(data);
      const ind=computeSeries(s.o,s.h,s.l,s.c,s.v);
      const sr=strategies(ind);
      const plan=positionPlan(ind, sr);
      const longScore=sr.buyScore-sr.sellScore;
      const shortScore=sr.sellScore-sr.buyScore;
      return {
        symbol:sym,
        signal:sr.cons,
        side:plan.side,
        conf:sr.conf,
        edge:sr.edge,
        longScore,
        shortScore,
        adx:ind.adx??'—',
        regime:sr.trending?'trend':'range',
        risk:ind.risk?`risk ${ind.risk.riskPct}%`:'risk —',
        price:ind.last
      };
    } catch(e) {
      return {symbol:sym,error:e.message};
    }
  }));
  renderScanner(rows);
}

function selectSymbol(sym) {
  document.getElementById('ticker').value=sym;
  if (connected) {
    closeAll();
    connected=false;
  }
  setTimeout(()=>toggleConnect(),150);
}

function pushAlert(icon,color,text) {
  const t=new Date();
  const ts=t.getHours()+':'+(t.getMinutes()+'').padStart(2,'0')+':'+(t.getSeconds()+'').padStart(2,'0');
  alertLog.unshift({icon,color,text,ts});
  if(alertLog.length>30)alertLog.pop();
  document.getElementById('alerts').innerHTML=alertLog.map(a=>`
    <div class="ai"><div class="aico" style="color:${a.color}">${a.icon}</div><div class="atx">${a.text}</div><div class="atm">${a.ts}</div></div>`).join('');
}

function renderChart() {
  const labels=K.labels.slice(-80), prices=K.c.slice(-80);
  if(chart){
    chart.data.labels=labels;
    chart.data.datasets[0].data=prices;
    syncTradeChartLines();
    chart.update('none');
    return;
  }
  chart=new Chart(document.getElementById('priceChart'),{
    type:'line',
    data:{labels,datasets:[
      {label:'Close',data:prices,borderColor:'#7b6fff',borderWidth:1.5,pointRadius:0,tension:0.2,fill:true,backgroundColor:'rgba(123,111,255,.07)'},
      {label:'Entry',data:[],borderColor:'#f5c842',borderWidth:1,borderDash:[5,5],pointRadius:0},
      {label:'Stop',data:[],borderColor:'#ff4d6d',borderWidth:1,borderDash:[4,4],pointRadius:0},
      {label:'Target',data:[],borderColor:'#00e5a0',borderWidth:1,borderDash:[4,4],pointRadius:0}
    ]},
    options:{
      responsive:true,maintainAspectRatio:false,animation:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:(c)=>'$'+c.parsed.y.toLocaleString(undefined,{maximumFractionDigits:4})},backgroundColor:'#1c1c2a',borderColor:'#2a2a3d',borderWidth:1}},
      scales:{
        x:{ticks:{color:'#7a7a9a',font:{size:9},maxTicksLimit:10},grid:{color:'rgba(255,255,255,.04)'}},
        y:{ticks:{color:'#7a7a9a',font:{size:9},callback:(v)=>'$'+v.toLocaleString(undefined,{maximumFractionDigits:2})},grid:{color:'rgba(255,255,255,.04)'}}
      }
    }
  });
  syncTradeChartLines();
}

function updateChartTheme() {
  if (!chart) return;
  const grid = cssVar('--chart-grid');
  const muted = cssVar('--muted');
  const accent3 = cssVar('--accent3');
  const surface2 = cssVar('--surface2');
  const border = cssVar('--border');
  chart.data.datasets[0].borderColor = accent3;
  chart.data.datasets[0].backgroundColor = document.body.classList.contains('light') ? 'rgba(79,70,229,.08)' : 'rgba(123,111,255,.07)';
  chart.options.plugins.tooltip.backgroundColor = surface2;
  chart.options.plugins.tooltip.borderColor = border;
  chart.options.scales.x.ticks.color = muted;
  chart.options.scales.x.grid.color = grid;
  chart.options.scales.y.ticks.color = muted;
  chart.options.scales.y.grid.color = grid;
  chart.update('none');
}

function syncTradeChartLines() {
  if (!chart) return;
  const len = chart.data.labels.length;
  const empty = new Array(len).fill(null);
  chart.data.datasets[1].data = paperTrade ? new Array(len).fill(paperTrade.entry) : empty;
  chart.data.datasets[2].data = paperTrade ? new Array(len).fill(paperTrade.stop) : empty;
  chart.data.datasets[3].data = paperTrade ? new Array(len).fill(paperTrade.target) : empty;
}

function openPaperTrade(side) {
  const ind = compute();
  const sr = ind ? strategies(ind) : null;
  const plan = ind && sr ? positionPlan(ind, sr) : null;
  const current = parseFloat((document.getElementById('m-price').textContent||'').replace(/[$,]/g,'')) || ind?.last;
  if (!ind || !ind.risk || !Number.isFinite(current)) {
    pushAlert('!', '#f5c842', 'No paper trade opened: waiting for enough price and ATR data');
    return;
  }
  const isLong = side === 'LONG';
  paperTrade = {
    side,
    symbol: document.getElementById('ticker').value.toUpperCase().trim() || 'BTCUSDT',
    entry: current,
    stop: isLong ? ind.risk.longStop : ind.risk.shortStop,
    target: isLong ? ind.risk.longTarget : ind.risk.shortTarget,
    openedAt: new Date(),
    entrySignal: plan?.side || 'NO TRADE'
  };
  syncTradeChartLines();
  if (chart) chart.update('none');
  updatePaperTrade(current, sr);
  pushAlert(isLong?'▲':'▼', isLong?'#00e5a0':'#ff4d6d', `Paper ${side} opened at ${fmtPrice(current)}. Lines added to chart.`);
}

function closePaperTrade(reason='manual') {
  if (!paperTrade) return;
  const current = parseFloat((document.getElementById('m-price').textContent||'').replace(/[$,]/g,'')) || K.c[K.c.length-1];
  const pnl = paperTrade.side === 'LONG'
    ? (current-paperTrade.entry)/paperTrade.entry*100
    : (paperTrade.entry-current)/paperTrade.entry*100;
  pushAlert('■', pnl>=0?'#00e5a0':'#ff4d6d', `Paper ${paperTrade.side} closed: ${reason}, P/L ${pnl.toFixed(2)}%`);
  paperTrade = null;
  syncTradeChartLines();
  if (chart) chart.update('none');
  renderTradeStatus(null, 'FLAT', 'Open a paper long/short to track it');
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

function renderOB(asks,bids) {
  const top=8;
  const ta=asks.slice(0,top), tb=bids.slice(0,top);
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

function runAnalysis() {
  const ind=compute();
  if(!ind)return;
  renderIndic(ind);
  const sr=strategies(ind);
  if(sr) sr.plan = positionPlan(ind, sr);
  renderSignals(sr);
  updatePaperTrade(ind.last, sr);
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
  return document.getElementById('testnet').checked
    ? 'https://testnet.binancefuture.com'
    : '/api/binance';
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
    const [fr,oi]=await Promise.all([
      fetch(`${restBase()}/fapi/v1/premiumIndex?symbol=${sym}`).then(r=>r.json()),
      fetch(`${restBase()}/fapi/v1/openInterest?symbol=${sym}`).then(r=>r.json())
    ]);
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
  toggleConnect();
});
