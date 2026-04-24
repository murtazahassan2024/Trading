function summarizeBacktest(trades) {
  const wins = trades.filter(t=>t.r>0);
  const losses = trades.filter(t=>t.r<0);
  const grossWin = wins.reduce((a,t)=>a+t.r,0);
  const grossLoss = Math.abs(losses.reduce((a,t)=>a+t.r,0));
  let equity = 0, peak = 0, maxDd = 0;
  trades.forEach(t=>{
    equity += t.r;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak-equity);
  });
  return {
    trades: trades.length,
    winRate: trades.length ? wins.length/trades.length*100 : 0,
    profitFactor: grossLoss ? grossWin/grossLoss : grossWin ? Infinity : 0,
    maxDd,
    totalR: trades.reduce((a,t)=>a+t.r,0),
  };
}

function simulateTrade(series, side, entryIndex, plan, maxBars=24) {
  const entry = series.c[entryIndex];
  const stop = side === 'LONG' ? plan.stop : plan.stop;
  const target = side === 'LONG' ? plan.target : plan.target;
  for (let i=entryIndex+1;i<Math.min(series.c.length, entryIndex+maxBars+1);i++) {
    if (side === 'LONG') {
      if (series.l[i] <= stop) return {r:-1, bars:i-entryIndex, exit:stop, reason:'stop'};
      if (series.h[i] >= target) return {r:(target-entry)/(entry-stop), bars:i-entryIndex, exit:target, reason:'target'};
    } else {
      if (series.h[i] >= stop) return {r:-1, bars:i-entryIndex, exit:stop, reason:'stop'};
      if (series.l[i] <= target) return {r:(entry-target)/(stop-entry), bars:i-entryIndex, exit:target, reason:'target'};
    }
  }
  const exit = series.c[Math.min(series.c.length-1, entryIndex+maxBars)];
  const risk = Math.abs(entry-stop);
  return {
    r: risk ? (side === 'LONG' ? exit-entry : entry-exit)/risk : 0,
    bars: maxBars,
    exit,
    reason:'time',
  };
}

async function runBacktest(symbol=document.getElementById('ticker').value.toUpperCase().trim()||'BTCUSDT') {
  const tf = document.getElementById('timeframe').value;
  const data = await fetchKlineData(symbol, tf, 300);
  const raw = seriesFromKlines(data);
  const trades = [];
  for (let i=60;i<raw.c.length-25;i++) {
    const slice = {
      o: raw.o.slice(0,i+1), h: raw.h.slice(0,i+1), l: raw.l.slice(0,i+1), c: raw.c.slice(0,i+1), v: raw.v.slice(0,i+1)
    };
    const ind = computeSeries(slice.o,slice.h,slice.l,slice.c,slice.v);
    const sr = strategies(ind);
    const plan = positionPlan(ind, sr);
    if (plan.side !== 'LONG' && plan.side !== 'SHORT') continue;
    const result = simulateTrade(raw, plan.side, i, plan);
    trades.push({symbol, side:plan.side, ...result});
    i += Math.max(1, result.bars);
  }
  renderBacktestResults(symbol, summarizeBacktest(trades));
  return trades;
}

async function runScannerBacktests() {
  const results = await Promise.all(SCAN_SYMBOLS.map(async s=>{
    const trades = await runBacktest(s);
    return {symbol:s, summary:summarizeBacktest(trades)};
  }));
  const best = results.sort((a,b)=>b.summary.totalR-a.summary.totalR)[0];
  renderBacktestResults(`Best: ${best.symbol}`, best.summary);
}

function renderBacktestResults(label, summary) {
  const el = document.getElementById('backtest-results');
  if (!el) return;
  el.innerHTML = `
    <div><span>Sample</span><strong>${label}</strong></div>
    <div><span>Trades</span><strong>${summary.trades}</strong></div>
    <div><span>Win rate</span><strong>${summary.winRate.toFixed(0)}%</strong></div>
    <div><span>Profit factor</span><strong>${summary.profitFactor===Infinity?'∞':summary.profitFactor.toFixed(2)}</strong></div>
    <div><span>Max drawdown</span><strong>${summary.maxDd.toFixed(2)}R</strong></div>
    <div><span>Total R</span><strong style="color:${summary.totalR>=0?'var(--accent)':'var(--accent2)'}">${summary.totalR.toFixed(2)}R</strong></div>`;
}
