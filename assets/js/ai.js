function compactStrategyList(sr) {
  return (sr?.list || []).map(item => ({
    name: item.name,
    author: item.author,
    signal: item.signal,
    weight: item.weight,
  }));
}

let aiBriefTimer = null;
let aiBriefInFlight = false;
let lastAIBriefAt = 0;
const AI_BRIEF_MIN_INTERVAL_MS = 90000;

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
    .slice(0, 50)
    .map(compactScannerRow);
  return {
    mode: 'scanner-first',
    scannerUniverseCount: (lastScannerRows || []).filter(row => !row.error).length,
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
  const decisionClass = value => {
    const decision = String(value || fallbackDecision || 'HOLD').toUpperCase();
    if (decision === 'BUY' || decision === 'SELL' || decision === 'HOLD' || decision === 'AVOID') return decision.toLowerCase();
    return 'hold';
  };
  const cardTitle = item => {
    const decision = String(item.decision || item.side || fallbackDecision || 'HOLD').toUpperCase();
    const confidence = String(item.confidence || item.conf || 'LOW').toUpperCase();
    const edge = String(item.edge || 'NONE').toUpperCase().replaceAll('_', ' ');
    return [decision, confidence, edge === 'NONE' ? null : edge].filter(Boolean).join(' · ');
  };
  const focusHtml = focusList.map(item => `
    <div class="ai-decision-card">
      <span>${safeText(item.symbol || 'Market')}</span>
      <strong class="${safeText(decisionClass(item.decision || item.side))}">
        ${safeText(cardTitle(item))}
      </strong>
      <em>${safeText(item.reason || item.why || brief.summary || brief.opportunity || 'No clean edge')}</em>
    </div>`).join('');
  el.innerHTML = `
    <div class="ai-summary-card"><span>Summary</span><strong>${safeText(brief.headline || 'Market scan')}</strong><em>${safeText(brief.summary || brief.action || brief.opportunity || 'Waiting for scanner edge')}</em></div>
    ${focusHtml || '<div class="ai-decision-card"><span>Market</span><strong class="hold">HOLD · LOW</strong><em>No clean edge</em></div>'}`;
}

function localMarketBrief(error = null) {
  const rows = [...(lastScannerRows || [])].filter(row => !row.error);
  const ranked = rows
    .filter(row => row.sr?.probability)
    .sort((a,b)=>(b.sr.probability.confidence || 0)-(a.sr.probability.confidence || 0));
  const actionable = ranked.filter(row => row.side === 'LONG' || row.side === 'SHORT').slice(0, 5);
  const fallback = ranked.slice(0, 5);
  const focus = (actionable.length ? actionable : fallback).map(row => ({
    symbol: row.symbol,
    decision: row.side === 'LONG' ? 'BUY' : row.side === 'SHORT' ? 'SELL' : 'HOLD',
    confidence: row.sr?.probability?.confidence >= 70 ? 'HIGH' : row.sr?.probability?.confidence >= 55 ? 'MEDIUM' : 'LOW',
    edge: row.regime === 'Trend' || row.adx >= 25 ? 'MOMENTUM' : 'NONE',
    reason: row.plan?.reason || row.sr?.probability?.label || `${row.conf || 0}% confidence`,
  }));
  return {
    headline: actionable.length ? 'Scanner edge found' : 'No clean scanner edge',
    summary: error ? `Local fallback: ${error.message}` : 'Auto scanner summary',
    focusList: focus.length ? focus : [{ symbol: currentSymbol(), decision: 'HOLD', reason: 'Waiting for scanner data' }],
  };
}

function scheduleAIMarketBrief(reason = 'scanner') {
  if (aiBriefTimer) clearTimeout(aiBriefTimer);
  const elapsed = Date.now() - lastAIBriefAt;
  const delay = Math.max(2500, AI_BRIEF_MIN_INTERVAL_MS - elapsed);
  aiBriefTimer = setTimeout(() => runAIMarketBrief({ automatic:true, reason }), delay);
}

async function runAIMarketBrief(options = {}) {
  if (aiBriefInFlight) return;
  if (options.automatic && Date.now() - lastAIBriefAt < AI_BRIEF_MIN_INTERVAL_MS) return;
  aiBriefInFlight = true;
  const state = document.getElementById('ai-provider-state');
  if (state) state.textContent = options.automatic ? 'Auto-analyzing scanner...' : 'Scanning market list...';
  try {
    const response = await fetch('/api/ai/market-brief', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(aiMarketContext()),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'AI analysis failed');
    renderAIBrief(data.brief || {});
    lastAIBriefAt = Date.now();
    if (state) state.textContent = `${data.provider} · ${data.model} · auto refresh on`;
  } catch (error) {
    renderAIBrief(localMarketBrief(error));
    lastAIBriefAt = Date.now();
    if (state) state.textContent = `AI request failed; using local scanner fallback. ${error.message}`;
  } finally {
    aiBriefInFlight = false;
  }
}
