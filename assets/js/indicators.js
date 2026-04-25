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

function macdSeries(closes) {
  if (closes.length < 35) return [];
  const e12=ema(closes,12), e26=ema(closes,26);
  const macdLine=e12.map((v,i)=>v!==null&&e26[i]!==null?v-e26[i]:null);
  const compact=macdLine.filter(v=>v!==null);
  const sig=ema(compact,9);
  let sigIndex=0;
  return macdLine.map(v=>{
    if (v===null) return null;
    const s=sig[sigIndex++];
    return s===null?null:parseFloat((v-s).toFixed(4));
  });
}

function rsiSeries(closes, p=14) {
  return closes.map((_,i)=>i<p?null:rsi(closes.slice(0,i+1),p));
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
  const {rsi:r,macd:m,bb:b,stochRsi:sr,obv:ob,ema50above:e50,ema200above:e200,goldenCross:gc,adx:ax,candle,structure,volRatio,ema50Slope,risk} = ind;
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
  const bollinger = b&&b.pct<30&&r>42&&m&&m.bullish?'BUY':b&&b.pct>70&&r<58&&m&&!m.bullish?'SELL':'HOLD';
  const bulkowski = structure&&volRatio>=1.15&&structure.rangePct>78&&r>52?'BUY':structure&&volRatio>=1.15&&structure.rangePct<22&&r<48?'SELL':'HOLD';

  const list = [
    {name:'Trend + momentum',author:'Murphy',signal:murphy,strat:'Trend + momentum',weight:1.3},
    {name:'Discipline filter',author:'Douglas',signal:douglas,strat:'Discipline filter',weight:.8},
    {name:'Candle reversal',author:'Nison',signal:nison,strat:'Candle reversal',weight:1},
    {name:'Momentum retrace',author:'Miner',signal:miner,strat:'Momentum retrace',weight:1.2},
    {name:'Triple Screen',author:'Elder',signal:triple,strat:'Triple Screen',weight:1},
    {name:'Trend Follow',author:'Schwager',signal:trend,strat:'Trend Follow',weight:1.1},
    {name:'Band + momentum',author:'Bollinger',signal:bollinger,strat:'Band + momentum',weight:1},
    {name:'Pattern breakout',author:'Bulkowski',signal:bulkowski,strat:'Pattern breakout',weight:1}
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
