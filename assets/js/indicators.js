const ATR_STOP_MULTIPLIER = 2.0;
const CHANDELIER_PERIOD = 22;
const CHANDELIER_MULTIPLIER = 3.0;
const FUNDING_EXTREME_THRESHOLD = 0.001;
const FUNDING_HIGH_THRESHOLD = 0.0005;
const MIN_CONFIDENCE_THRESHOLD = 60;
const FUNDING_MODIFIERS = {
  EXTREME_POSITIVE: { longMod: 0.60, shortMod: 1.20 },
  HIGH_POSITIVE:    { longMod: 0.80, shortMod: 1.10 },
  NEUTRAL:          { longMod: 1.00, shortMod: 1.00 },
  HIGH_NEGATIVE:    { longMod: 1.10, shortMod: 0.80 },
  EXTREME_NEGATIVE: { longMod: 1.20, shortMod: 0.60 }
};
const NEWS_MODIFIERS = {
  STRONG_BULL: { longMod: 1.15, shortMod: 0.85 },
  MILD_BULL:   { longMod: 1.07, shortMod: 0.93 },
  NEUTRAL:     { longMod: 1.00, shortMod: 1.00 },
  MILD_BEAR:   { longMod: 0.93, shortMod: 1.07 },
  STRONG_BEAR: { longMod: 0.85, shortMod: 1.15 }
};
const NEWS_MIN_CONFIDENCE = 60;

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

function calcATR(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const candle = candles[i];
    const prevClose = candles[i - 1].close;
    if (![candle.high, candle.low, candle.close, prevClose].every(Number.isFinite)) return null;
    trs.push(Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - prevClose),
      Math.abs(candle.low - prevClose)
    ));
  }
  let atr = trs.slice(0, period).reduce((sum, tr) => sum + tr, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}

function calcDynamicStop(entryPrice, atr, direction, multiplier = ATR_STOP_MULTIPLIER) {
  if (!Number.isFinite(entryPrice) || !Number.isFinite(atr)) return null;
  return direction === 'LONG'
    ? entryPrice - (multiplier * atr)
    : entryPrice + (multiplier * atr);
}

function calcChandelierExit(candles, atr, direction, period = CHANDELIER_PERIOD, multiplier = CHANDELIER_MULTIPLIER, previousStop = null) {
  if (!Array.isArray(candles) || candles.length < 1 || !Number.isFinite(atr)) return null;
  const lookback = candles.slice(-period);
  const rawStop = direction === 'LONG'
    ? Math.max(...lookback.map(candle => candle.high)) - (multiplier * atr)
    : Math.min(...lookback.map(candle => candle.low)) + (multiplier * atr);
  if (!Number.isFinite(rawStop)) return null;
  if (!Number.isFinite(previousStop)) return rawStop;
  return direction === 'LONG'
    ? Math.max(previousStop, rawStop)
    : Math.min(previousStop, rawStop);
}

function emaValue(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  const k = 2 / (period + 1);
  let value = values.slice(0, period).reduce((sum, item) => sum + item, 0) / period;
  for (let i = period; i < values.length; i++) value = values[i] * k + value * (1 - k);
  return value;
}

function rsiValue(values, period = 14) {
  if (!Array.isArray(values) || values.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const delta = values[i] - values[i - 1];
    if (delta >= 0) gains += delta;
    else losses -= delta;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return parseFloat((100 - 100 / (1 + avgGain / avgLoss)).toFixed(2));
}

function calcTimeframeBias(candles) {
  if (!Array.isArray(candles) || candles.length < 50) {
    return { bias: 'NEUTRAL', ema20: null, ema50: null, rsi14: null };
  }
  const closes = candles.map(candle => candle.close);
  const close = closes[closes.length - 1];
  const ema20 = emaValue(closes, 20);
  const ema50 = emaValue(closes, 50);
  const rsi14 = rsiValue(closes, 14);
  let bias = 'NEUTRAL';
  if (close > ema20 && ema20 > ema50) bias = 'BULL';
  else if (close < ema20 && ema20 < ema50) bias = 'BEAR';
  return { bias, ema20, ema50, rsi14 };
}

function calcMTFConfluence(bias4h, bias1h, signal15m) {
  const direction = signal15m === 'LONG' || signal15m === 'SHORT' ? signal15m : 'NO TRADE';
  if (direction === 'NO TRADE') {
    return {
      confluenceScore: 0,
      confluenceDirection: 'NO TRADE',
      confluenceReason: '15m entry signal is not directional'
    };
  }
  const long = direction === 'LONG';
  const requiredBias = long ? 'BULL' : 'BEAR';
  const rsiOk = long ? bias1h?.rsi14 > 50 : bias1h?.rsi14 < 50;
  const aligned4h = bias4h?.bias === requiredBias;
  const aligned1h = bias1h?.bias === requiredBias && rsiOk;
  const aligned15m = true;
  const confluenceScore = [aligned4h, aligned1h, aligned15m].filter(Boolean).length;
  const missing = [];
  if (!aligned4h) missing.push(`4h is ${bias4h?.bias || 'NEUTRAL'}`);
  if (!aligned1h) missing.push(`1h is ${bias1h?.bias || 'NEUTRAL'} with RSI ${Number.isFinite(bias1h?.rsi14) ? bias1h.rsi14 : '—'}`);
  return {
    confluenceScore,
    confluenceDirection: confluenceScore === 3 ? direction : 'NO TRADE',
    confluenceReason: confluenceScore === 3
      ? '4h, 1h, and 15m are fully aligned'
      : confluenceScore === 2
        ? `Partial confluence — waiting for full alignment${missing.length ? ` (${missing.join('; ')})` : ''}`
        : missing.join('; ') || 'MTF alignment is not ready'
  };
}

function mtfSignalFromCandles(candles) {
  const ind = computeSeriesFromCandles(candles);
  const sr = ind ? strategies(ind, { fundingRatePct: null, skipMtf: true }) : null;
  if (sr?.probability?.direction === 'LONG') return 'LONG';
  if (sr?.probability?.direction === 'SHORT') return 'SHORT';
  return 'NO TRADE';
}

function currentMTFConfluence() {
  const bias4h = calcTimeframeBias(candles4h);
  const bias1h = calcTimeframeBias(candles1h);
  const signal15m = mtfSignalFromCandles(candles15m);
  return { ...calcMTFConfluence(bias4h, bias1h, signal15m), bias4h, bias1h, signal15m };
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
  const longStop = calcDynamicStop(ind.last, ind.atrValue, 'LONG');
  const shortStop = calcDynamicStop(ind.last, ind.atrValue, 'SHORT');
  if (!Number.isFinite(longStop) || !Number.isFinite(shortStop)) return null;
  const stopDist=ind.atrValue*ATR_STOP_MULTIPLIER;
  const targetDist=stopDist*1.6;
  return {
    atr14: ind.atrValue,
    longStop,
    longTarget: ind.last+targetDist,
    shortStop,
    shortTarget: ind.last-targetDist,
    stopType: 'INITIAL',
    longStopInfo: {
      atr14: ind.atrValue,
      dynamicStop: longStop,
      chandelierStop: null,
      stopType: 'INITIAL',
      stopPrice: longStop
    },
    shortStopInfo: {
      atr14: ind.atrValue,
      dynamicStop: shortStop,
      chandelierStop: null,
      stopType: 'INITIAL',
      stopPrice: shortStop
    },
    rr: parseFloat((targetDist/stopDist).toFixed(2)),
    riskPct: parseFloat((stopDist/ind.last*100).toFixed(2))
  };
}

function positionPlan(ind, sr) {
  const probability = sr?.probability || null;
  const mtf = sr?.mtf || null;
  if (!ind || !sr || !ind.risk) {
    return { side:'NO TRADE', cls:'none', entry:null, stop:null, target:null, reason:'Waiting for full signal stack', probability, mtf };
  }
  if (probability?.adjustedConfidence >= NEWS_MIN_CONFIDENCE && probability?.confidenceAfterNews < NEWS_MIN_CONFIDENCE) {
    return { side:'NO TRADE', cls:'none', entry:ind.last, stop:null, target:null, reason:'Confidence suppressed by news sentiment', probability, mtf };
  }
  if (mtf?.confluenceScore === 2) {
    return { side:'NO TRADE', cls:'none', entry:ind.last, stop:null, target:null, reason:'Partial confluence — waiting for full alignment', probability, mtf };
  }
  if (mtf && mtf.confluenceScore < 2) {
    return { side:'NO TRADE', cls:'none', entry:ind.last, stop:null, target:null, reason:mtf.confluenceReason, probability, mtf };
  }
  if (mtf && mtf.confluenceScore === 3 && mtf.confluenceDirection !== probability?.direction) {
    return { side:'NO TRADE', cls:'none', entry:ind.last, stop:null, target:null, reason:mtf.confluenceReason, probability, mtf };
  }
  if (probability?.direction === 'LONG' && probability.confidence >= 58 && sr.riskOk) {
    return {
      side:'LONG',
      cls:'long',
      entry:ind.last,
      stop:ind.risk.longStop,
      stopInfo: ind.risk.longStopInfo,
      atr14: ind.risk.atr14,
      dynamicStop: ind.risk.longStopInfo.dynamicStop,
      chandelierStop: ind.risk.longStopInfo.chandelierStop,
      stopType: ind.risk.longStopInfo.stopType,
      stopPrice: ind.risk.longStopInfo.stopPrice,
      target:ind.risk.longTarget,
      reason:`${probability.label}; ${sr.trending?'trend':'range'} regime`,
      probability,
      mtf
    };
  }
  if (probability?.direction === 'SHORT' && probability.confidence >= 58 && sr.riskOk) {
    return {
      side:'SHORT',
      cls:'short',
      entry:ind.last,
      stop:ind.risk.shortStop,
      stopInfo: ind.risk.shortStopInfo,
      atr14: ind.risk.atr14,
      dynamicStop: ind.risk.shortStopInfo.dynamicStop,
      chandelierStop: ind.risk.shortStopInfo.chandelierStop,
      stopType: ind.risk.shortStopInfo.stopType,
      stopPrice: ind.risk.shortStopInfo.stopPrice,
      target:ind.risk.shortTarget,
      reason:`${probability.label}; ${sr.trending?'trend':'range'} regime`,
      probability,
      mtf
    };
  }
  return {
    side:'NO TRADE',
    cls:'none',
    entry:ind.last,
    stop:null,
    target:null,
    reason: probability ? `${probability.label}; below execution threshold or risk elevated` : 'Waiting for probability ensemble',
    probability,
    mtf
  };
}

function directionalAgreement(sr, side) {
  if (!sr?.list?.length) return 0;
  const wanted = side === 'LONG' ? 'BUY' : 'SELL';
  const against = side === 'LONG' ? 'SELL' : 'BUY';
  const aligned = sr.list.filter(item => item.signal === wanted).reduce((sum,item)=>sum+item.weight,0);
  const opposed = sr.list.filter(item => item.signal === against || (against === 'SELL' && item.signal === 'SHORT')).reduce((sum,item)=>sum+item.weight,0);
  return sr.totalScore ? parseFloat(((aligned-opposed)/sr.totalScore*100).toFixed(1)) : 0;
}

function expectedValueR(winProbability, rewardRisk) {
  const p = clamp(winProbability, 0.05, 0.95);
  return parseFloat((p * rewardRisk - (1 - p)).toFixed(2));
}

function currentFundingRatePct() {
  if (Number.isFinite(currentFundingRate)) return currentFundingRate;
  const text = document.getElementById('m-fund')?.textContent || '';
  const value = Number(text.replace('%', ''));
  return Number.isFinite(value) ? value / 100 : null;
}

function classifyFundingRate(fundingRate) {
  if (!Number.isFinite(fundingRate)) return 'NEUTRAL';
  if (fundingRate > FUNDING_EXTREME_THRESHOLD) return 'EXTREME_POSITIVE';
  if (fundingRate > FUNDING_HIGH_THRESHOLD) return 'HIGH_POSITIVE';
  if (fundingRate < -FUNDING_EXTREME_THRESHOLD) return 'EXTREME_NEGATIVE';
  if (fundingRate < -FUNDING_HIGH_THRESHOLD) return 'HIGH_NEGATIVE';
  return 'NEUTRAL';
}

function fundingZoneLabel(zone, direction = null) {
  if (zone === 'EXTREME_POSITIVE') return direction === 'LONG' ? 'Crowded long — reducing long confidence' : 'Crowded long — short confidence boosted';
  if (zone === 'HIGH_POSITIVE') return direction === 'LONG' ? 'Elevated long funding — reducing long confidence' : 'Elevated long funding — short confidence boosted';
  if (zone === 'HIGH_NEGATIVE') return direction === 'SHORT' ? 'Elevated short funding — reducing short confidence' : 'Elevated short funding — long confidence boosted';
  if (zone === 'EXTREME_NEGATIVE') return direction === 'SHORT' ? 'Crowded short — reducing short confidence' : 'Crowded short — long opportunity';
  return 'Neutral funding';
}

function fundingPillText(zone) {
  if (zone === 'EXTREME_POSITIVE') return 'Crowded long';
  if (zone === 'HIGH_POSITIVE') return 'Elevated long';
  if (zone === 'HIGH_NEGATIVE') return 'Elevated short';
  if (zone === 'EXTREME_NEGATIVE') return 'Crowded short — long opportunity';
  return 'Neutral';
}

function probabilityLabel(probability) {
  if (!probability) return 'Balanced: 50% confidence';
  const side = probability.long >= probability.short ? 'Long' : 'Short';
  return `${side}: ${Math.max(probability.long, probability.short)}% confidence`;
}

function probabilityClass(probability) {
  if (!probability || probability.direction === 'NO TRADE' || probability.confidence < 55) return 'hold';
  return probability.long >= probability.short ? 'buy' : 'sell';
}

function weightedProbability(ind, srContext = {}) {
  if (!ind) return null;
  const clampProb = value => clamp(value, 0, 1);
  const sigmoid = value => 1 / (1 + Math.exp(-value));
  const rsiProb = ind.rsi === null
    ? 0.5
    : clampProb(0.5 + clamp((ind.rsi - 50) / 70, -0.18, 0.18) + (ind.rsi <= 30 ? 0.12 : ind.rsi >= 70 ? -0.12 : 0));
  const macdProb = ind.macd
    ? clampProb(0.5 + (ind.macd.bullish ? 0.14 : -0.14) + clamp((ind.macd.hist / Math.max(ind.last, Number.EPSILON)) * 80, -0.12, 0.12))
    : 0.5;
  const trendDirection = (ind.ema50above ? 1 : -1) + (ind.ema200above ? 1 : -1) + (ind.ema50Slope > 0 ? 1 : -1);
  const adxStrength = ind.adx === null ? 0 : clamp((ind.adx - 18) / 24, 0, 1);
  const adxProb = clampProb(0.5 + (trendDirection / 3) * adxStrength * 0.22);
  const volumeStrength = ind.volRatio === null ? 0 : clamp((ind.volRatio - 0.8) / 1.2, 0, 1);
  const directionBias = srContext.buys !== undefined && srContext.sells !== undefined
    ? sigmoid((srContext.buys - srContext.sells) * 0.8)
    : macdProb;
  const volumeProb = clampProb(0.5 + (directionBias - 0.5) * (0.5 + volumeStrength));
  const funding = Object.prototype.hasOwnProperty.call(srContext, 'fundingRatePct')
    ? srContext.fundingRatePct
    : currentFundingRatePct();
  const fundingProb = Number.isFinite(funding)
    ? clampProb(0.5 - clamp(funding / (FUNDING_EXTREME_THRESHOLD * 3), -0.18, 0.18))
    : 0.5;
  const components = [
    { name:'RSI', weight:25, long:rsiProb },
    { name:'MACD', weight:30, long:macdProb },
    { name:'ADX regime', weight:20, long:adxProb },
    { name:'Volume confirmation', weight:15, long:volumeProb },
    { name:'Funding rate', weight:10, long:fundingProb },
  ];
  const totalWeight = components.reduce((sum, item) => sum + item.weight, 0);
  const longRaw = components.reduce((sum, item) => sum + item.long * item.weight, 0) / totalWeight;
  const longPct = Math.round(clamp(longRaw * 100, 1, 99));
  const shortPct = 100 - longPct;
  const baseConfidence = Math.max(longPct, shortPct);
  const baseDirection = baseConfidence < 55 ? 'NO TRADE' : longPct > shortPct ? 'LONG' : 'SHORT';
  const fundingRate = Object.prototype.hasOwnProperty.call(srContext, 'fundingRatePct')
    ? srContext.fundingRatePct
    : currentFundingRatePct();
  const fundingZone = classifyFundingRate(fundingRate);
  const mod = FUNDING_MODIFIERS[fundingZone] || FUNDING_MODIFIERS.NEUTRAL;
  const fundingModifier = baseDirection === 'LONG' ? mod.longMod : baseDirection === 'SHORT' ? mod.shortMod : 1;
  const adjustedConfidence = Math.min(Math.round(baseConfidence * fundingModifier), 100);
  const directionAfterFunding = adjustedConfidence < MIN_CONFIDENCE_THRESHOLD ? 'NO TRADE' : baseDirection;
  const news = typeof currentNewsSentiment === 'function' ? currentNewsSentiment() : { score: 0, zone: 'NEUTRAL', topBullish: null, topBearish: null, macroAlert: null };
  const newsMod = NEWS_MODIFIERS[news.zone] || NEWS_MODIFIERS.NEUTRAL;
  const newsModifier = directionAfterFunding === 'LONG' ? newsMod.longMod : directionAfterFunding === 'SHORT' ? newsMod.shortMod : 1;
  const confidenceAfterNews = Math.min(Math.round(adjustedConfidence * newsModifier), 100);
  const direction = confidenceAfterNews < NEWS_MIN_CONFIDENCE ? 'NO TRADE' : directionAfterFunding;
  const adjustedLong = direction === 'LONG' ? confidenceAfterNews : direction === 'SHORT' ? 100 - confidenceAfterNews : longPct;
  const adjustedShort = direction === 'SHORT' ? confidenceAfterNews : direction === 'LONG' ? 100 - confidenceAfterNews : shortPct;
  return {
    long: adjustedLong,
    short: adjustedShort,
    confidence: confidenceAfterNews,
    direction,
    fundingRate,
    fundingZone,
    fundingModifier,
    baseConfidence,
    adjustedConfidence,
    fundingLabel: fundingZoneLabel(fundingZone, baseDirection),
    newsSentimentScore: news.score,
    newsSentimentZone: news.zone,
    newsModifier,
    confidenceAfterNews,
    topBullishHeadline: news.topBullish,
    topBearishHeadline: news.topBearish,
    macroAlert: news.macroAlert,
    label: direction === 'NO TRADE' ? `No trade: ${confidenceAfterNews}% confidence` : probabilityLabel({ long: adjustedLong, short: adjustedShort }),
    components: components.map(item => ({
      name: item.name,
      weight: item.weight,
      long: Math.round(item.long * 100),
      short: Math.round((1 - item.long) * 100),
    })),
  };
}

function tradeQuality(ind, sr, side) {
  if (!ind || !sr || (side !== 'LONG' && side !== 'SHORT')) return null;
  const long = side === 'LONG';
  const agreement = directionalAgreement(sr, side);
  const rr = ind.risk?.rr || 0;
  const riskPct = ind.risk?.riskPct ?? Infinity;
  const trendAligned = long
    ? ind.ema50above && ind.ema200above && ind.ema50Slope > 0
    : !ind.ema50above && !ind.ema200above && ind.ema50Slope < 0;
  const momentumAligned = long
    ? ind.macd?.bullish && ind.rsi >= 48 && ind.rsi <= 72
    : ind.macd && !ind.macd.bullish && ind.rsi <= 52 && ind.rsi >= 28;
  const locationOk = long
    ? !ind.structure?.nearResistance
    : !ind.structure?.nearSupport;
  const volumeOk = ind.volRatio === null || ind.volRatio >= 0.9;
  const volatilityOk = ind.atr !== null && ind.atr >= 0.05 && ind.atr <= 2.8;
  const riskOk = riskPct <= 1.1 && rr >= 1.45;
  const regimeOk = sr.trending ? ind.adx >= 22 : agreement >= 35;

  let score = 0;
  score += clamp((sr.conf - 50) * 1.4, 0, 35);
  score += clamp(agreement * 0.35, 0, 20);
  score += trendAligned ? 14 : 0;
  score += momentumAligned ? 14 : 0;
  score += volumeOk ? 7 : -8;
  score += locationOk ? 7 : -10;
  score += volatilityOk ? 5 : -7;
  score += riskOk ? 8 : -12;
  score += regimeOk ? 6 : -8;
  score = Math.round(clamp(score, 0, 100));

  const probability = clamp((0.38 + score / 250 + Math.max(0, agreement) / 500), 0.35, 0.78);
  const evR = expectedValueR(probability, rr || 1);
  const blockers = [];
  if (!trendAligned) blockers.push('trend not aligned');
  if (!momentumAligned) blockers.push('momentum not confirmed');
  if (!locationOk) blockers.push(long ? 'too near resistance' : 'too near support');
  if (!volumeOk) blockers.push('thin volume');
  if (!volatilityOk) blockers.push('volatility outside band');
  if (!riskOk) blockers.push('risk/reward not tight enough');
  if (!regimeOk) blockers.push('weak regime');

  return {
    score,
    agreement,
    probability: parseFloat((probability * 100).toFixed(1)),
    expectedValueR: evR,
    rewardRisk: rr,
    riskPct,
    trendAligned,
    momentumAligned,
    volumeOk,
    locationOk,
    volatilityOk,
    regimeOk,
    riskOk,
    autoPass: score >= 72 && evR >= 0.2 && blockers.length <= 1,
    blockers,
  };
}

function compactEntrySnapshot(ind, sr, plan, source = 'chart') {
  const quality = plan ? tradeQuality(ind, sr, plan.side) : null;
  return {
    source,
    timeframe: document.getElementById('timeframe')?.value || '5m',
    capturedAt: new Date().toISOString(),
    consensus: sr ? {
      decision: sr.cons,
      confidence: sr.conf,
      probability: sr.probability,
      edge: sr.edge,
      buyScore: sr.buyScore,
      sellScore: sr.sellScore,
      trending: sr.trending,
      riskOk: sr.riskOk,
    } : null,
    quality,
    indicators: ind ? {
      rsi: ind.rsi,
      stochRsi: ind.stochRsi,
      macdHist: ind.macd?.hist ?? null,
      macdBullish: ind.macd?.bullish ?? null,
      adx: ind.adx,
      atrPct: ind.atr,
      atr14: ind.atrValue,
      volumeRatio: ind.volRatio,
      ema50above: ind.ema50above,
      ema200above: ind.ema200above,
      ema50Slope: ind.ema50Slope,
      goldenCross: ind.goldenCross,
      candleBias: ind.candle?.bias,
      candlePattern: ind.candle?.pattern,
      structureRangePct: ind.structure?.rangePct ?? null,
      nearSupport: ind.structure?.nearSupport ?? null,
      nearResistance: ind.structure?.nearResistance ?? null,
      risk: ind.risk,
    } : null,
    strategyVotes: (sr?.list || []).map(item => ({
      name: item.name,
      signal: item.signal,
      weight: item.weight,
    })),
  };
}

function computeSeries(o,h,l,c,v) {
  if (c.length < 30) return null;
  const candles = c.map((close, index) => ({
    open: o[index],
    high: h[index],
    low: l[index],
    close
  }));
  const r=rsi(c), m=macd(c), b=bb(c), sr=stochRsi(c), ob=obv(c,v), at=atr(h,l,c);
  const atrAbs=calcATR(candles), ax=adx(h,l,c), candle=candleSignal(o,h,l,c), structure=marketStructure(h,l,c);
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
    candles,
    last
  };
  ind.risk = riskPlan(ind);
  return ind;
}

function computeSeriesFromCandles(candles) {
  if (!Array.isArray(candles) || !candles.length) return null;
  return computeSeries(
    candles.map(candle => candle.open),
    candles.map(candle => candle.high),
    candles.map(candle => candle.low),
    candles.map(candle => candle.close),
    candles.map(candle => candle.volume ?? 0)
  );
}

function compute() {
  return computeSeries(K.o,K.h,K.l,K.c,K.v);
}

function strategies(ind, options = {}) {
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
  const probabilityContext = { buys, sells };
  if (Object.prototype.hasOwnProperty.call(options, 'fundingRatePct')) probabilityContext.fundingRatePct = options.fundingRatePct;
  const probability = weightedProbability(ind, probabilityContext);
  const cons = probability?.direction === 'LONG' ? 'BUY' : probability?.direction === 'SHORT' ? 'SELL' : 'HOLD';
  const conf = probability?.confidence || 50;
  const mtf = options.skipMtf ? null : currentMTFConfluence();
  return {list,cons,conf,probability,mtf,edge:parseFloat((edge*100).toFixed(1)),riskOk,trending,buyScore:buys,sellScore:sells,totalScore:total};
}
