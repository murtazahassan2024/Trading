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
  const avgWin = wins.length ? grossWin / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const expectancy = trades.length ? trades.reduce((a,t)=>a+t.r,0) / trades.length : 0;
  return {
    trades: trades.length,
    winRate: trades.length ? wins.length/trades.length*100 : 0,
    profitFactor: grossLoss ? grossWin/grossLoss : grossWin ? Infinity : 0,
    maxDd,
    totalR: trades.reduce((a,t)=>a+t.r,0),
    expectancy,
    avgWin,
    avgLoss,
  };
}

function backtestSettings() {
  return {
    slippagePct: Math.max(0, Number(document.getElementById('bt-slip')?.value || 0)),
    feePct: Math.max(0, Number(document.getElementById('fee-pct')?.value || 0)),
    maxBars: Math.max(3, Number(document.getElementById('bt-bars')?.value || 24)),
  };
}

function applyEntrySlip(price, side, slipPct) {
  const slip = slipPct / 100;
  return side === 'LONG' ? price * (1 + slip) : price * (1 - slip);
}

function applyExitSlip(price, side, slipPct) {
  const slip = slipPct / 100;
  return side === 'LONG' ? price * (1 - slip) : price * (1 + slip);
}

function simulateTrade(series, side, entryIndex, plan, settings=backtestSettings()) {
  const entry = applyEntrySlip(series.c[entryIndex], side, settings.slippagePct);
  const stop = plan.stopPrice ?? plan.stop;
  const target = plan.target;
  const risk = Math.abs(entry-stop);
  const feeR = risk ? ((entry + target) * settings.feePct / 100) / risk : 0;
  for (let i=entryIndex+1;i<Math.min(series.c.length, entryIndex+settings.maxBars+1);i++) {
    if (side === 'LONG') {
      if (series.l[i] <= stop) {
        const exit = applyExitSlip(stop, side, settings.slippagePct);
        return {r: risk ? (exit-entry)/risk-feeR : 0, bars:i-entryIndex, exit, reason:'stop'};
      }
      if (series.h[i] >= target) {
        const exit = applyExitSlip(target, side, settings.slippagePct);
        return {r: risk ? (exit-entry)/risk-feeR : 0, bars:i-entryIndex, exit, reason:'target'};
      }
    } else {
      if (series.h[i] >= stop) {
        const exit = applyExitSlip(stop, side, settings.slippagePct);
        return {r: risk ? (entry-exit)/risk-feeR : 0, bars:i-entryIndex, exit, reason:'stop'};
      }
      if (series.l[i] <= target) {
        const exit = applyExitSlip(target, side, settings.slippagePct);
        return {r: risk ? (entry-exit)/risk-feeR : 0, bars:i-entryIndex, exit, reason:'target'};
      }
    }
  }
  const exit = applyExitSlip(series.c[Math.min(series.c.length-1, entryIndex+settings.maxBars)], side, settings.slippagePct);
  return {
    r: risk ? (side === 'LONG' ? exit-entry : entry-exit)/risk-feeR : 0,
    bars: settings.maxBars,
    exit,
    reason:'time',
  };
}

async function runBacktest(symbol=document.getElementById('ticker').value.toUpperCase().trim()||'BTCUSDT') {
  const tf = document.getElementById('timeframe').value;
  const data = await fetchKlineData(symbol, tf, 300);
  const raw = seriesFromKlines(data);
  const trades = [];
  const settings = backtestSettings();
  for (let i=60;i<raw.c.length-25;i++) {
    const slice = {
      o: raw.o.slice(0,i+1), h: raw.h.slice(0,i+1), l: raw.l.slice(0,i+1), c: raw.c.slice(0,i+1), v: raw.v.slice(0,i+1)
    };
    const ind = computeSeries(slice.o,slice.h,slice.l,slice.c,slice.v);
    const sr = strategies(ind);
    const plan = positionPlan(ind, sr);
    if (plan.side !== 'LONG' && plan.side !== 'SHORT') continue;
    const result = simulateTrade(raw, plan.side, i, plan, settings);
    trades.push({symbol, side:plan.side, ...result});
    i += Math.max(1, result.bars);
  }
  renderBacktestResults(symbol, summarizeBacktest(trades));
  runLiveReadiness();
  return trades;
}

async function runScannerBacktests() {
  const results = await Promise.all(SCAN_SYMBOLS.map(async s=>{
    const trades = await runBacktest(s);
    return {symbol:s, summary:summarizeBacktest(trades)};
  }));
  const best = results.sort((a,b)=>b.summary.totalR-a.summary.totalR)[0];
  renderBacktestResults(`Best: ${best.symbol}`, best.summary);
  runLiveReadiness();
}

function renderBacktestResults(label, summary) {
  const el = document.getElementById('backtest-results');
  if (!el) return;
  el.innerHTML = `
    <div><span>Sample</span><strong>${label}</strong></div>
    <div><span>Trades</span><strong>${summary.trades}</strong></div>
    <div><span>Win rate</span><strong>${summary.winRate.toFixed(0)}%</strong></div>
    <div><span>Profit factor</span><strong>${summary.profitFactor===Infinity?'∞':summary.profitFactor.toFixed(2)}</strong></div>
    <div><span>Expectancy</span><strong style="color:${summary.expectancy>=0?'var(--accent)':'var(--accent2)'}">${summary.expectancy.toFixed(2)}R</strong></div>
    <div><span>Avg win/loss</span><strong>${summary.avgWin.toFixed(2)}R / ${summary.avgLoss.toFixed(2)}R</strong></div>
    <div><span>Max drawdown</span><strong>${summary.maxDd.toFixed(2)}R</strong></div>
    <div><span>Total R</span><strong style="color:${summary.totalR>=0?'var(--accent)':'var(--accent2)'}">${summary.totalR.toFixed(2)}R</strong></div>`;
  window.lastBacktestSummary = summary;
}

function summarizeForwardTest() {
  const trades = paperLedger.map(t => ({ r: Number(t.rMultiple || 0) }));
  return summarizeBacktest(trades);
}

function renderForwardTest(summary = summarizeForwardTest()) {
  const el = document.getElementById('forward-test-results');
  if (!el) return;
  const status = summary.trades < 30 ? 'Need 30+ trades' : summary.profitFactor >= 1.1 && summary.expectancy > 0 ? 'Promising' : 'Weak';
  el.innerHTML = `
    <div><span>Forward trades</span><strong>${summary.trades}</strong></div>
    <div><span>Forward win rate</span><strong>${summary.winRate.toFixed(0)}%</strong></div>
    <div><span>Forward PF</span><strong>${summary.profitFactor===Infinity?'∞':summary.profitFactor.toFixed(2)}</strong></div>
    <div><span>Expectancy</span><strong style="color:${summary.expectancy>=0?'var(--accent)':'var(--accent2)'}">${summary.expectancy.toFixed(2)}R</strong></div>
    <div><span>Max drawdown</span><strong>${summary.maxDd.toFixed(2)}R</strong></div>
    <div><span>Status</span><strong>${status}</strong></div>`;
  return summary;
}

function readinessItem(label, ok, note, warn = false) {
  return { label, ok, warn, note, status: ok ? 'PASS' : warn ? 'WARN' : 'BLOCK' };
}

function runLiveReadiness() {
  const forward = renderForwardTest();
  const backtest = window.lastBacktestSummary || { trades:0, profitFactor:0, expectancy:0, maxDd:0 };
  const dailyLossLimit = Number(document.getElementById('daily-loss-limit')?.value || 2);
  const maxOpen = Number(document.getElementById('live-max-open')?.value || 3);
  const checks = [
    readinessItem('Broker execution', false, 'Alpaca paper adapter exists; live broker remains blocked.'),
    readinessItem('Kill switch', false, 'Needs hard stop button and broker cancel-all.'),
    readinessItem('Data health', connected && K.c.length > 50, connected ? 'Live stream and candles available.' : 'WebSocket not connected.', true),
    readinessItem('Max open positions', paperTrades.length <= maxOpen, `${paperTrades.length}/${maxOpen} open paper trades.`),
    readinessItem('Daily loss cap', dailyLossLimit <= 2, `Configured at ${dailyLossLimit}% max daily loss.`, dailyLossLimit > 2),
    readinessItem('Cost-aware backtest', backtest.trades >= 30 && backtest.expectancy > 0 && backtest.profitFactor >= 1.15, `${backtest.trades} trades · PF ${backtest.profitFactor?.toFixed ? backtest.profitFactor.toFixed(2) : '0'} · ${backtest.expectancy?.toFixed ? backtest.expectancy.toFixed(2) : '0'}R exp.`, backtest.trades > 0),
    readinessItem('Forward test', forward.trades >= 30 && forward.expectancy > 0 && forward.profitFactor >= 1.1, `${forward.trades} paper trades · ${forward.expectancy.toFixed(2)}R expectancy.`, forward.trades > 0),
    readinessItem('Real-money mode', false, 'Intentionally blocked until all execution controls exist.'),
  ];
  const hardBlocks = checks.filter(c => !c.ok && !c.warn).length;
  const status = document.getElementById('readiness-status');
  if (status) {
    status.classList.toggle('ready', hardBlocks === 0);
    status.innerHTML = hardBlocks === 0
      ? '<strong>READY FOR LIMITED PAPER-LIVE TEST</strong><span>Still start tiny and monitor fills.</span>'
      : `<strong>NOT READY FOR LIVE MONEY</strong><span>${hardBlocks} hard blockers before connecting real funds.</span>`;
  }
  const grid = document.getElementById('readiness-grid');
  if (grid) {
    grid.innerHTML = checks.map(c => `
      <div>
        <span>${c.label}</span>
        <strong style="color:${c.ok?'var(--accent)':c.warn?'var(--gold)':'var(--accent2)'}">${c.status}</strong>
        <em>${c.note}</em>
      </div>`).join('');
  }
}

function simulateExecution() {
  const el = document.getElementById('execution-sim');
  if (!el) return;
  const ind = compute();
  const sr = ind ? strategies(ind) : null;
  const plan = paperTrade ? {
    symbol: paperTrade.symbol,
    side: paperTrade.side,
    entry: tradeClosePrice(paperTrade),
    stop: paperTrade.stop,
    stopType: paperTrade.stopType,
    stopPrice: paperTrade.stopPrice ?? paperTrade.stop,
    probability: paperTrade.entrySnapshot?.consensus?.probability,
    target: paperTrade.target,
    reason: 'Selected open paper trade',
  } : (ind && sr ? positionPlan(ind, sr) : null);
  if (!plan || (plan.side !== 'LONG' && plan.side !== 'SHORT')) {
    el.innerHTML = '<div><span>Probability</span><strong>No execution edge yet</strong></div><div><span>Reason</span><strong>No trade plan</strong></div>';
    return;
  }
  const symbol = plan.symbol || currentSymbol();
  const slipPct = Math.max(0, Number(document.getElementById('exec-slip')?.value || 0));
  const fill = applyEntrySlip(plan.entry, plan.side, slipPct);
  const stop = plan.stopPrice ?? plan.stop;
  const sizing = tradeSizingSnapshot(fill, stop);
  const openFee = sizing.notional * sizing.feePct / 100;
  const worstLoss = Math.abs(fill - stop) * sizing.qty + openFee;
  const stopLabel = plan.stopType === 'CHANDELIER' ? 'Trailing' : 'Stop';
  const stopText = plan.stopType === 'CHANDELIER'
    ? `${fmtPrice(stop)} (Chandelier)`
    : `${fmtPrice(stop)} (ATR x ${ATR_STOP_MULTIPLIER.toFixed(1)})`;
  el.innerHTML = `
    <div><span>Probability</span><strong>${plan.probability?.label || plan.side} ${symbol}</strong></div>
    <div><span>Est. fill</span><strong>${fmtPrice(fill)}</strong></div>
    <div><span>Qty</span><strong>${sizing.qty.toFixed(5)}</strong></div>
    <div><span>Notional</span><strong>$${sizing.notional.toFixed(2)}</strong></div>
    <div><span>Fees</span><strong>$${openFee.toFixed(2)} open</strong></div>
    <div><span>Worst planned loss</span><strong style="color:var(--accent2)">$${worstLoss.toFixed(2)}</strong></div>
    <div><span>${stopLabel}</span><strong>${stopText}</strong></div>
    <div><span>Target</span><strong>${fmtPrice(plan.target)}</strong></div>`;
}
