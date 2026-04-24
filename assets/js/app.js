let lev = 1;
let chart = null;
let alertLog = [];
let lastRSI = null, lastCons = null;
let fundingTimer = null;

const K = { o:[], h:[], l:[], c:[], v:[], t:[], labels:[] };
const MAX = 200;

const BOOKS = [
  {title:'How to Make Money in Stocks', author:"W. O'Neil", strat:'CAN SLIM', color:'#00e5a0'},
  {title:'Trading for a Living', author:'A. Elder', strat:'Triple Screen', color:'#7b6fff'},
  {title:'Reminiscences of a Stock Operator', author:'E. Lefèvre', strat:'Tape Reading', color:'#f5c842'},
  {title:'The New Trading for a Living', author:'A. Elder', strat:'Force Index', color:'#ff4d6d'},
  {title:'Market Wizards', author:'J. Schwager', strat:'Trend Follow', color:'#00c2ff'},
  {title:'Technical Analysis of Fin. Markets', author:'J. Murphy', strat:'RSI+MACD', color:'#ff9f40'}
];

function ema(arr, p) {
  if (arr.length < p) return [];
  const k = 2/(p+1), out = new Array(arr.length).fill(null);
  let s = 0; for (let i=0;i<p;i++) s+=arr[i];
  out[p-1] = s/p;
  for (let i=p;i<arr.length;i++) out[i] = arr[i]*k + out[i-1]*(1-k);
  return out;
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

function compute() {
  if (K.c.length < 30) return null;
  const c=K.c, h=K.h, l=K.l, v=K.v;
  const r=rsi(c), m=macd(c), b=bb(c), sr=stochRsi(c), ob=obv(c,v), at=atr(h,l,c);
  const e50=ema(c,Math.min(50,c.length)), e200=ema(c,Math.min(200,c.length));
  const le50=e50[e50.length-1], le200=e200[e200.length-1];
  const last=c[c.length-1];
  return {
    rsi:r, macd:m, bb:b, stochRsi:sr, obv:ob, atr:at,
    ema50above: le50!==null?last>le50:null,
    ema200above: le200!==null?last>le200:null,
    goldenCross: le50!==null&&le200!==null?le50>le200:null,
    last
  };
}

function strategies(ind) {
  if (!ind) return null;
  const {rsi:r,macd:m,stochRsi:sr,obv:ob,ema50above:e50,ema200above:e200,goldenCross:gc} = ind;

  const canSlim = e50&&r>50&&r<75&&ob.rising&&gc?'BUY':(!e50&&r<45)?'SELL':'HOLD';
  const triple = e200&&m&&m.bullish?'BUY':(!e200&&m&&!m.bullish)?'SELL':'HOLD';
  const tape = ob.rising&&e50?'BUY':(!ob.rising&&!e50)?'SELL':'HOLD';
  const force = m&&m.bullCross?'BUY':m&&m.bearCross?'SHORT':'HOLD';
  const trend = gc?'BUY':gc===false?'SELL':'HOLD';
  const rsiMacd = r<35&&m&&m.bullish?'BUY':r>68&&m&&!m.bullish?'SELL':sr!==null&&sr<20?'BUY':'HOLD';

  const list = [
    {name:'CAN SLIM',author:"O'Neil",signal:canSlim,strat:'CAN SLIM'},
    {name:'Triple Screen',author:'Elder',signal:triple,strat:'Triple Screen'},
    {name:'Tape Reading',author:'Livermore',signal:tape,strat:'Tape Reading'},
    {name:'Force Index',author:'Elder',signal:force,strat:'Force Index'},
    {name:'Trend Follow',author:'Schwager',signal:trend,strat:'Trend Follow'},
    {name:'RSI + MACD',author:'Murphy',signal:rsiMacd,strat:'RSI+MACD'}
  ];

  const buys=list.filter(s=>s.signal==='BUY').length;
  const sells=list.filter(s=>s.signal==='SELL'||s.signal==='SHORT').length;
  let cons,conf;
  if(buys>sells){cons='BUY';conf=Math.round(buys/list.length*100);}
  else if(sells>buys){cons='SELL';conf=Math.round(sells/list.length*100);}
  else{cons='HOLD';conf=50;}
  return {list,cons,conf};
}

function renderIndic(ind) {
  if (!ind) return;
  const {rsi:r,macd:m,bb:b,stochRsi:sr,obv:ob,atr:at,ema50above:e50,ema200above:e200,goldenCross:gc}=ind;
  const rc=r>70?'#ff4d6d':r<30?'#00e5a0':'#f5c842';
  const mc=m&&m.bullish?'#00e5a0':'#ff4d6d';
  const e50c=e50?'#00e5a0':'#ff4d6d';
  const e200c=e200?'#00e5a0':'#ff4d6d';
  const src=sr>80?'#ff4d6d':sr<20?'#00e5a0':'#f5c842';
  const obc=ob.rising?'#00e5a0':'#ff4d6d';
  const atrc=at>2?'#ff4d6d':'#7b6fff';
  const bbc=b&&b.pct>80?'#ff4d6d':b&&b.pct<20?'#00e5a0':'#f5c842';

  document.getElementById('indic-grid').innerHTML=`
<div class="ind"><div class="in">RSI (14)</div><div class="iv" style="color:${rc}">${r!==null?r:'—'}</div><div class="is" style="color:${rc}">${r>70?'OVERBOUGHT':r<30?'OVERSOLD':'NEUTRAL'}</div><div class="bw"><div class="bf" style="width:${Math.min(100,r||0)}%;background:${rc}"></div></div></div>
<div class="ind"><div class="in">MACD (12,26,9)</div><div class="iv" style="color:${mc}">${m?m.hist.toFixed(3):'—'}</div><div class="is" style="color:${mc}">${m?(m.bullCross?'BULL CROSS ↑':m.bearCross?'BEAR CROSS ↓':m.bullish?'BULLISH':'BEARISH'):'—'}</div><div class="bw"><div class="bf" style="width:${m&&m.bullish?72:30}%;background:${mc}"></div></div></div>
<div class="ind"><div class="in">EMA 50</div><div class="iv" style="color:${e50c}">${e50!==null?(e50?'ABOVE':'BELOW'):'—'}</div><div class="is" style="color:${e50c}">${e50?'Bullish bias':'Bearish bias'}</div><div class="bw"><div class="bf" style="width:${e50?72:30}%;background:${e50c}"></div></div></div>
<div class="ind"><div class="in">EMA 200</div><div class="iv" style="color:${e200c}">${e200!==null?(e200?'ABOVE':'BELOW'):'—'}</div><div class="is" style="color:${e200c}">${gc?'Golden cross':'Death cross'}</div><div class="bw"><div class="bf" style="width:${e200?75:28}%;background:${e200c}"></div></div></div>
<div class="ind"><div class="in">Stoch RSI</div><div class="iv" style="color:${src}">${sr!==null?sr.toFixed(1):'—'}</div><div class="is" style="color:${src}">${sr>80?'OVERBOUGHT':sr<20?'OVERSOLD':'NEUTRAL'}</div><div class="bw"><div class="bf" style="width:${sr||0}%;background:${src}"></div></div></div>
<div class="ind"><div class="in">OBV</div><div class="iv" style="color:${obc}">${ob.rising?'RISING':'FALLING'}</div><div class="is" style="color:${obc}">On-balance volume</div><div class="bw"><div class="bf" style="width:${ob.rising?68:35}%;background:${obc}"></div></div></div>
<div class="ind"><div class="in">Bollinger %B</div><div class="iv" style="color:${bbc}">${b?b.pct.toFixed(1)+'%':'—'}</div><div class="is" style="color:${bbc}">${b?(b.pct>80?'Near upper band':b.pct<20?'Near lower band':'Mid-band'):'—'}</div><div class="bw"><div class="bf" style="width:${b?Math.min(100,Math.max(0,b.pct)):50}%;background:${bbc}"></div></div></div>
<div class="ind"><div class="in">ATR %</div><div class="iv" style="color:${atrc}">${at!==null?at+'%':'—'}</div><div class="is" style="color:${atrc}">${at>2?'HIGH VOLATILITY':at>1?'MODERATE':'LOW VOL'}</div><div class="bw"><div class="bf" style="width:${at?Math.min(100,at*15):0}%;background:${atrc}"></div></div></div>`;
}

function renderSignals(sr) {
  if (!sr) return;
  const {list,cons,conf}=sr;
  const bs=document.getElementById('big-signal');
  const sw=document.getElementById('sig-word');
  bs.className='big-signal '+(cons==='BUY'?'buy':cons==='SELL'?'sell':'hold');
  sw.style.color=cons==='BUY'?'var(--accent)':cons==='SELL'?'var(--accent2)':'var(--gold)';
  sw.textContent=cons;
  document.getElementById('sig-conf').textContent=`Confidence: ${conf}% (${list.filter(s=>s.signal===cons).length}/${list.length} strategies)`;
  document.getElementById('strat-list').innerHTML=list.map(s=>`
    <div class="si"><div><div class="sn">${s.name}</div><div class="sa">${s.author}</div></div>
    <span class="badge ${s.signal==='BUY'?'b-buy':s.signal==='HOLD'?'b-hold':s.signal==='SHORT'?'b-short':'b-sell'}">${s.signal}</span></div>`).join('');
  document.getElementById('books').innerHTML=BOOKS.map(b=>{
    const m=list.find(s=>s.strat===b.strat)||{signal:'—'};
    const sc=m.signal==='BUY'?'#00e5a0':m.signal==='SELL'||m.signal==='SHORT'?'#ff4d6d':m.signal==='HOLD'?'#f5c842':'var(--muted)';
    return`<div class="bc" style="border-left-color:${b.color}"><div class="bt">${b.title}</div><div class="bau">${b.author}</div><div class="bs" style="color:${b.color}">${b.strat}: <strong style="color:${sc}">${m.signal}</strong></div></div>`;
  }).join('');
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
  if(chart){chart.data.labels=labels;chart.data.datasets[0].data=prices;chart.update('none');return;}
  chart=new Chart(document.getElementById('priceChart'),{
    type:'line',
    data:{labels,datasets:[{label:'Close',data:prices,borderColor:'#7b6fff',borderWidth:1.5,pointRadius:0,tension:0.2,fill:true,backgroundColor:'rgba(123,111,255,.07)'}]},
    options:{
      responsive:true,maintainAspectRatio:false,animation:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:(c)=>'$'+c.parsed.y.toLocaleString(undefined,{maximumFractionDigits:4})},backgroundColor:'#1c1c2a',borderColor:'#2a2a3d',borderWidth:1}},
      scales:{
        x:{ticks:{color:'#7a7a9a',font:{size:9},maxTicksLimit:10},grid:{color:'rgba(255,255,255,.04)'}},
        y:{ticks:{color:'#7a7a9a',font:{size:9},callback:(v)=>'$'+v.toLocaleString(undefined,{maximumFractionDigits:2})},grid:{color:'rgba(255,255,255,.04)'}}
      }
    }
  });
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
  renderSignals(sr);
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
    : 'https://fapi.binance.com';
}

async function fetchKlines(sym,tf) {
  const url=`${restBase()}/fapi/v1/klines?symbol=${sym}&interval=${tf}&limit=200`;
  try {
    const r=await fetch(url);
    const data=await r.json();
    if(!Array.isArray(data))throw new Error('not array');
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
  if(fundingTimer)clearInterval(fundingTimer);
  fundingTimer=setInterval(()=>fetchMeta(sym),30000);
}

window.addEventListener('load',()=>toggleConnect());
