function compactStrategyList(sr) {
  return (sr?.list || []).map(item => ({
    name: item.name,
    author: item.author,
    signal: item.signal,
    weight: item.weight,
  }));
}

function compactIndicators(ind) {
  if (!ind) return null;
  return {
    last: ind.last,
    rsi: ind.rsi,
    macd: ind.macd,
    stochRsi: ind.stochRsi,
    atrPct: ind.atr,
    adx: ind.adx,
    volumeRatio: ind.volRatio,
    candle: ind.candle,
    structure: ind.structure ? {
      rangePct: ind.structure.rangePct,
      nearSupport: ind.structure.nearSupport,
      nearResistance: ind.structure.nearResistance,
    } : null,
    risk: ind.risk,
    ema50above: ind.ema50above,
    ema200above: ind.ema200above,
    goldenCross: ind.goldenCross,
  };
}

function compactScannerRow(row) {
  return {
    symbol: row.symbol,
    side: row.side,
    signal: row.signal,
    confidence: row.conf,
    edge: row.edge,
    adx: row.adx,
    regime: row.regime,
    riskPct: row.riskPct,
    price: row.price,
    longScore: row.longScore,
    shortScore: row.shortScore,
    quality: row.quality ? {
      score: row.quality.score,
      expectedValueR: row.quality.expectedValueR,
      probability: row.quality.probability,
      autoPass: row.quality.autoPass,
      blockers: row.quality.blockers,
    } : null,
  };
}

function aiMarketContext() {
  const ind = compute();
  const sr = ind ? strategies(ind) : null;
  const plan = ind && sr ? positionPlan(ind, sr) : null;
  const scannerUniverse = [...(lastScannerRows || [])]
    .filter(row => !row.error)
    .sort((a,b) => Math.max(b.longScore,b.shortScore)-Math.max(a.longScore,a.shortScore))
    .map(compactScannerRow);
  return {
    mode: 'scanner-first',
    symbol: currentSymbol(),
    selectedSymbolNote: 'The selected chart is secondary. Prefer the scanner universe when choosing what deserves attention.',
    timeframe: document.getElementById('timeframe')?.value || '5m',
    account: accountInputs(),
    market: {
      price: document.getElementById('m-price')?.textContent || '—',
      change24h: document.getElementById('m-chg')?.textContent || '—',
      volume24h: document.getElementById('m-vol')?.textContent || '—',
      funding: document.getElementById('m-fund')?.textContent || '—',
      openInterest: document.getElementById('m-oi')?.textContent || '—',
    },
    consensus: sr ? { probability: sr.probability, edge: sr.edge, riskOk: sr.riskOk, trending: sr.trending } : null,
    indicators: compactIndicators(ind),
    plan,
    strategyVotes: compactStrategyList(sr),
    scannerUniverse,
    scannerLeaders: scannerUniverse.slice(0, 10),
    openPaperTrades: paperTrades.map(trade => ({
      symbol: trade.symbol,
      side: trade.side,
      mode: trade.mode,
      entry: trade.entry,
      stop: trade.stop,
      target: trade.target,
      lastPrice: trade.lastPrice,
      lastExitStatus: trade.lastExitStatus,
    })),
    recentLedger: paperLedger.slice(0, 8).map(trade => ({
      symbol: trade.symbol,
      side: trade.side,
      reason: trade.reason,
      rMultiple: trade.rMultiple,
      pnl: trade.pnl,
      entryQuality: trade.entrySnapshot?.quality || null,
    })),
  };
}

function safeText(value) {
  return String(value ?? '—')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderAIBrief(brief) {
  const el = document.getElementById('ai-brief');
  if (!el) return;
  const focusList = Array.isArray(brief.focusList) ? brief.focusList.slice(0, 5) : [];
  const fallbackDecision = brief.action ? String(brief.action).match(/\b(BUY|SELL|HOLD)\b/i)?.[1]?.toUpperCase() : null;
  const displayDecision = value => {
    const decision = String(value || fallbackDecision || 'BALANCED').toUpperCase();
    if (decision === 'BUY') return 'Long probability';
    if (decision === 'SELL') return 'Short probability';
    return 'Balanced probability';
  };
  const focusHtml = focusList.map(item => `
    <div class="ai-decision-card">
      <span>${safeText(item.symbol || 'Market')}</span>
      <strong class="${safeText((item.decision || item.side || fallbackDecision || 'hold').toLowerCase())}">
        ${safeText(displayDecision(item.decision || item.side))}
      </strong>
      <em>${safeText(item.reason || item.why || brief.summary || brief.opportunity || 'No clean edge')}</em>
    </div>`).join('');
  el.innerHTML = `
    <div class="ai-summary-card"><span>Summary</span><strong>${safeText(brief.headline || 'Market scan')}</strong><em>${safeText(brief.summary || brief.action || brief.opportunity || 'Waiting for scanner edge')}</em></div>
    ${focusHtml || '<div class="ai-decision-card"><span>Market</span><strong class="hold">Balanced probability</strong><em>No clean edge</em></div>'}`;
}

async function runAIMarketBrief() {
  const state = document.getElementById('ai-provider-state');
  if (state) state.textContent = 'Scanning market list...';
  try {
    const response = await fetch('/api/ai/market-brief', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(aiMarketContext()),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'AI analysis failed');
    renderAIBrief(data.brief || {});
    if (state) state.textContent = `${data.provider} · ${data.model}`;
  } catch (error) {
    renderAIBrief({
      headline: 'AI analysis unavailable',
      risk: error.message,
      action: 'Check server environment keys and restart the app.',
    });
    if (state) state.textContent = 'AI request failed.';
  }
}
