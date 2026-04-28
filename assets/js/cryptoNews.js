let latestNews = [];
let latestNewsSentiment = null;
let latestNewsUpdatedAt = null;
let cryptoNewsTimer = null;
let cryptoNewsAgeTimer = null;
let cryptoNewsOffline = false;
let cryptoNewsDisabled = false;
let cryptoNewsStatus = '';
let cryptoNewsSymbols = [];

const CRYPTO_NEWS_URL = 'https://cryptocurrency.cv/api/news';
const CRYPTO_NEWS_LIMIT = 10;
const CRYPTO_NEWS_FETCH_LIMIT = 50;
const CRYPTO_NEWS_POLL_MS = 90000;
const BEARISH_HEADLINE_KEYWORDS = [
  'ban','hack','crash','lawsuit','sec','sanction','war','attack','dump','fear','iran','oil spike',
  'inflation','rate hike','recession','exploit','breach','seized','shutdown','rug','ponzi','bubble',
  'collapse','plunge','tumble','drop','fall','bearish','sell-off','restriction','fine','penalty',
  'fraud','scam','nuclear','tariff','trade war','opec','tension','conflict'
];
const BULLISH_HEADLINE_KEYWORDS = [
  'etf','approval','partnership','adoption','upgrade','rally','surge','breakout','accumulate',
  'institutional','ath','all-time high','listing','integration','launch','record','bullish','inflow',
  'buy','green','recover','rebound','growth','expand','investment','backing','support',
  'strategic reserve','sovereign','accumulation'
];
const MACRO_ALERT_KEYWORDS = [
  'iran','russia','ukraine','oil','federal reserve','fed rate','interest rate','inflation','gdp',
  'recession','nuclear','sanctions','tariff','trade war','opec','dxy','dollar index'
];
const SCHEDULED_EVENT_KEYWORDS = [
  'fomc','cpi','ppi','nonfarm','payroll','jobs report','fed decision','rate decision',
  'interest rate','federal reserve','inflation','gdp'
];

function normalizeNewsSymbols(symbols) {
  return [...new Set((symbols || [])
    .map(symbol => String(symbol || '').toUpperCase().replace(/USDT$|USD$|PERP$/g, ''))
    .filter(Boolean))];
}

async function fetchCryptoNews(symbols, schedule = true) {
  cryptoNewsSymbols = normalizeNewsSymbols(symbols);
  if (cryptoNewsDisabled) {
    renderNewsSentimentPanel();
    return latestNews;
  }
  if (schedule && !cryptoNewsTimer) {
    cryptoNewsTimer = setInterval(() => fetchCryptoNews(cryptoNewsSymbols, false), CRYPTO_NEWS_POLL_MS);
  }
  if (!cryptoNewsSymbols.length) return latestNews;
  try {
    const params = new URLSearchParams({
      limit: String(CRYPTO_NEWS_FETCH_LIMIT),
    });
    const response = await fetch(`${CRYPTO_NEWS_URL}?${params.toString()}`);
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    const data = await response.json();
    latestNews = normalizeNewsResponse(data, cryptoNewsSymbols);
    latestNewsSentiment = calcNewsSentiment(latestNews);
    latestNewsUpdatedAt = Date.now();
    cryptoNewsOffline = false;
    cryptoNewsStatus = '';
    renderNewsSentimentPanel();
    if (typeof runAnalysis === 'function' && K.c.length) runAnalysis();
    return latestNews;
  } catch (error) {
    console.warn('cryptocurrency.cv fetch failed:', error);
    cryptoNewsOffline = true;
    cryptoNewsStatus = error.status === 402
      ? 'Paid news endpoint requires x402 payment — neutral mode'
      : 'News feed offline — retrying';
    if (error.status === 402) {
      cryptoNewsDisabled = true;
      if (cryptoNewsTimer) {
        clearInterval(cryptoNewsTimer);
        cryptoNewsTimer = null;
      }
    }
    latestNewsSentiment = neutralNewsSentiment();
    renderNewsSentimentPanel();
    return latestNews;
  }
}

function classifyHeadline(title) {
  const text = String(title || '').toLowerCase();
  const bullishHits = BULLISH_HEADLINE_KEYWORDS.reduce((count, keyword) => count + (text.includes(keyword) ? 1 : 0), 0);
  const bearishHits = BEARISH_HEADLINE_KEYWORDS.reduce((count, keyword) => count + (text.includes(keyword) ? 1 : 0), 0);
  if (bullishHits > bearishHits && bullishHits >= 1) return 'BULLISH';
  if (bearishHits > bullishHits && bearishHits >= 1) return 'BEARISH';
  return 'NEUTRAL';
}

function normalizeNewsResponse(data, symbols = []) {
  const articles = Array.isArray(data) ? data : Array.isArray(data?.articles) ? data.articles : [];
  const normalized = articles.map(article => {
    const tags = Array.isArray(article.tags) ? article.tags : [];
    const coins = Array.isArray(article.coins) ? article.coins : tags
      .map(tag => String(tag || '').toUpperCase())
      .filter(tag => /^[A-Z0-9]{2,10}$/.test(tag));
    return {
      title: article.title || '',
      url: article.url || article.link || '',
      published_at: article.published_at || article.pubDate || article.publishedAt || article.date || '',
      source: article.source || article.sourceKey || '',
      coins,
      sentiment: article.sentiment || null,
    };
  });
  const wanted = normalizeNewsSymbols(symbols);
  const filtered = wanted.length ? normalized.filter(article => {
    const haystack = `${article.title} ${(article.coins || []).join(' ')}`.toUpperCase();
    return wanted.some(symbol => haystack.includes(symbol));
  }) : normalized;
  return (filtered.length ? filtered : normalized).slice(0, CRYPTO_NEWS_LIMIT);
}

function calcNewsSentiment(articles) {
  const list = Array.isArray(articles) ? articles : [];
  if (!list.length) return neutralNewsSentiment();
  const withSentiment = list.map(article => ({
    ...article,
    sentiment: classifyHeadline(article.title),
  }));
  const bullishCount = withSentiment.filter(article => article.sentiment === 'BULLISH').length;
  const bearishCount = withSentiment.filter(article => article.sentiment === 'BEARISH').length;
  const neutralCount = withSentiment.length - bullishCount - bearishCount;
  const score = (bullishCount - bearishCount) / withSentiment.length;
  const zone = score > 0.40 ? 'STRONG_BULL'
    : score >= 0.15 ? 'MILD_BULL'
      : score < -0.40 ? 'STRONG_BEAR'
        : score <= -0.15 ? 'MILD_BEAR'
          : 'NEUTRAL';
  const topBullish = withSentiment.find(article => article.sentiment === 'BULLISH')?.title || null;
  const topBearish = withSentiment.find(article => article.sentiment === 'BEARISH')?.title || null;
  const macroAlert = withSentiment.find(article => {
    const title = String(article.title || '').toLowerCase();
    return MACRO_ALERT_KEYWORDS.some(keyword => title.includes(keyword));
  })?.title || null;
  return { score, zone, bullishCount, bearishCount, neutralCount, articles: withSentiment, topBullish, topBearish, macroAlert };
}

function neutralNewsSentiment() {
  return {
    score: 0,
    zone: 'NEUTRAL',
    bullishCount: 0,
    bearishCount: 0,
    neutralCount: 0,
    articles: latestNews.map(article => ({ ...article, sentiment: classifyHeadline(article.title) })),
    topBullish: null,
    topBearish: null,
    macroAlert: null,
  };
}

function currentNewsSentiment() {
  return cryptoNewsOffline ? neutralNewsSentiment() : (latestNewsSentiment || neutralNewsSentiment());
}

function isMacroBlackoutActive(sentiment = currentNewsSentiment()) {
  const headline = String(sentiment?.macroAlert || '').toLowerCase();
  if (!headline) return false;
  return SCHEDULED_EVENT_KEYWORDS.some(keyword => headline.includes(keyword));
}

function newsZoneLabel(zone) {
  return {
    STRONG_BULL: 'Strong bull',
    MILD_BULL: 'Mild bull',
    NEUTRAL: 'Neutral',
    MILD_BEAR: 'Mild bear',
    STRONG_BEAR: 'Strong bear',
  }[zone] || 'Neutral';
}

function timeAgo(timestamp) {
  if (!timestamp) return '—';
  const time = new Date(timestamp).getTime();
  if (!Number.isFinite(time)) return '—';
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function updatedAgo() {
  if (!latestNewsUpdatedAt) return 'Updated —';
  return `Updated ${Math.floor((Date.now() - latestNewsUpdatedAt) / 1000)}s ago`;
}

function newsSafeText(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function truncateTitle(title, max = 75) {
  const text = String(title || 'Untitled');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function renderNewsSentimentPanel(probability = lastSignalSnapshot?.probability) {
  const panel = document.getElementById('news-sentiment-panel');
  if (!panel) return;
  const sentiment = currentNewsSentiment();
  const impact = probability
    ? `News adj: ${probability.adjustedConfidence}% → ${probability.confidenceAfterNews}% (${sentiment.zone})`
    : `News adj: — (${sentiment.zone})`;
  const rows = (sentiment.articles || []).slice(0, 5).map(article => `
    <button class="news-row" type="button" onclick="window.open(decodeURIComponent('${encodeURIComponent(article.url || '')}'), '_blank', 'noopener')">
      <span class="news-dot ${article.sentiment.toLowerCase()}"></span>
      <span class="news-title">${newsSafeText(truncateTitle(article.title))}</span>
      <span class="news-source">${newsSafeText(article.source || 'Source')}</span>
      <span class="news-time">${timeAgo(article.published_at)}</span>
    </button>`).join('');
  panel.innerHTML = `
    <div class="news-head">
      <span class="news-zone ${sentiment.zone.toLowerCase()}">${newsZoneLabel(sentiment.zone)}</span>
      <span class="news-updated" id="news-updated">${cryptoNewsOffline ? cryptoNewsStatus : updatedAgo()}</span>
    </div>
    <div class="news-impact">${cryptoNewsOffline ? cryptoNewsStatus : impact}</div>
    ${sentiment.macroAlert ? `<div class="macro-alert"><span>Macro alert</span><strong>${newsSafeText(sentiment.macroAlert)}</strong></div>` : ''}
    <div class="news-list">${rows || '<div class="scan-empty">No news articles loaded yet.</div>'}</div>`;
}

function startNewsAgeTicker() {
  if (cryptoNewsAgeTimer) return;
  cryptoNewsAgeTimer = setInterval(() => {
    const el = document.getElementById('news-updated');
    if (el) el.textContent = cryptoNewsOffline ? cryptoNewsStatus : updatedAgo();
  }, 1000);
}
