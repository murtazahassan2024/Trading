const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 5173);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const GRANULARITY = {
  '1m': 60,
  '3m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 21600,
};

function loadEnvFile() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq === -1) return;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (key && process.env[key] === undefined) process.env[key] = value;
  });
}

loadEnvFile();

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1000000) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}

function aiConfig() {
  const openRouterKey = process.env.OPENROUTER_API_KEY || process.env.openrouter_api_key;
  const provider = (process.env.AI_PROVIDER || (openRouterKey ? 'openrouter' : process.env.OPENAI_API_KEY ? 'openai' : process.env.DEEPSEEK_API_KEY ? 'deepseek' : '')).toLowerCase();
  if (provider === 'openrouter' || (openRouterKey && provider !== 'openai' && provider !== 'deepseek')) return {
    provider: 'openrouter',
    key: openRouterKey,
    model: process.env.OPENROUTER_MODEL || process.env.openrouter_model || 'openrouter/auto',
    baseUrl: 'https://openrouter.ai/api/v1',
    headers: {
      'HTTP-Referer': process.env.APP_URL || 'http://localhost:5173',
      'X-Title': process.env.APP_NAME || 'SignalOS',
    },
  };
  if (provider === 'deepseek') return { provider, key: process.env.DEEPSEEK_API_KEY, model: process.env.DEEPSEEK_MODEL || 'deepseek-chat' };
  return { provider: 'openai', key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL || 'gpt-4o-mini' };
}

function aiPrompt(context) {
  return `You are a sharp, concise AI market coach embedded in a live crypto futures paper-trading dashboard.
Use ONLY the supplied JSON. Never claim certainty or guarantee profit.
Your job: scan ALL symbols in scannerUniverse/scannerLeaders and surface the 2–5 that genuinely deserve attention right now.

DATA MAPPING — read these fields directly from each symbol in the JSON:
- confidence field → use this directly to set your confidence output (high number = HIGH, mid = MEDIUM, low = LOW)
- edge field → use this directly to set your edge output
- signal or decision field → use this for BUY/SELL/HOLD/AVOID
- adx field → if > 25, regime is trending; if < 20, it is choppy
- rsi field → if > 55 with MACD positive = MOMENTUM edge; if > 70 or < 30 = REVERSAL edge
- fundingRate → if absolute value > 0.001 = HIGH_FUNDING risk flag

DECISION RULES — do not default to HOLD:
- If the symbol's own signal/decision field says BUY or LONG → output BUY
- If the symbol's own signal/decision field says SELL or SHORT → output SELL
- HOLD only if the signal is genuinely neutral or conflicting
- AVOID only if risk flags are present alongside a weak signal
- You must output at least one BUY or SELL across the entire focusList if any symbol has a non-neutral signal

CRITICAL RULES:
- Do NOT default everything to HOLD. Read the actual signal/decision field from each symbol.
- Do NOT return NONE edge if RSI and MACD data exists — derive the edge from the data.
- Surface genuine differences between symbols — not every symbol is the same.

In your reason field, always cite specific values from the JSON.
Good: "ADX 55, RSI 62, signal BUY"
Bad: "Strong trend, neutral signal"

Return ONLY valid JSON. No prose, no markdown, no explanation outside the JSON.

Required shape — no extra keys, no deviation:
{
  "headline": "5–7 words capturing dominant market theme",
  "regime": "TRENDING | RANGING | CHOPPY | MIXED",
  "summary": "One sentence, max 15 words, scanner-wide mood",
  "focusList": [
    {
      "symbol": "BTCUSDT",
      "decision": "BUY | SELL | HOLD | AVOID",
      "confidence": "HIGH | MEDIUM | LOW",
      "edge": "MOMENTUM | BREAKOUT | REVERSAL | MEAN_REVERT | NONE",
      "reason": "Max 12 words — must cite at least one specific number from the data",
      "riskFlag": "NONE | HIGH_FUNDING | OI_SPIKE | OVEREXTENDED | LOW_VOLUME"
    }
  ],
  "coachNote": "One actionable behavioral nudge for the trader. Max 18 words."
}

Context JSON:
${JSON.stringify(context).slice(0, 18000)}`;
}

function extractJson(text) {
  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(cleaned); }
  catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('AI response was not valid JSON');
  }
}

async function askOpenAICompatible({ key, model, baseUrl, headers = {} }, context) {
  const isOpenRouter = String(baseUrl || '').includes('openrouter.ai');
  const wantsJsonMode = !isOpenRouter;
  const maxTokens = isOpenRouter ? 700 : 450;
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
      ...headers,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: maxTokens,
      ...(wantsJsonMode ? { response_format: { type: 'json_object' } } : {}),
      messages: [
        { role: 'system', content: 'Return only valid JSON.' },
        { role: 'user', content: aiPrompt(context) },
      ],
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || `AI request failed: ${response.status}`);
  return extractJson(data.choices?.[0]?.message?.content || '{}');
}

async function aiMarketBrief(req, res) {
  try {
    const context = await readJson(req);
    const config = aiConfig();
    if (!config.key) {
      send(res, 200, JSON.stringify({
        provider: config.provider,
        model: config.model,
        brief: {
          headline: 'AI analysis unavailable',
          regime: 'Server key not configured',
          opportunity: 'Add an API key to the server environment.',
          risk: `Missing ${config.provider.toUpperCase()} API key in server environment.`,
          action: 'Restart the local server with a server-side key.',
          confidenceNote: 'No model call was made.',
        },
      }), {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      return;
    }
    let brief;
    brief = await askOpenAICompatible({
      key: config.key,
      model: config.model,
      baseUrl: config.baseUrl || (config.provider === 'deepseek' ? 'https://api.deepseek.com/v1' : 'https://api.openai.com/v1'),
      headers: config.headers,
    }, context);
    send(res, 200, JSON.stringify({ provider: config.provider, model: config.model, brief }), {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
  } catch (error) {
    send(res, 500, JSON.stringify({ error: error.message }), {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
  }
}

function alpacaConfig() {
  const baseUrl = (process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets').replace(/\/v2\/?$/, '');
  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    key: process.env.ALPACA_API_KEY_ID,
    secret: process.env.ALPACA_API_SECRET_KEY,
    paperOnly: process.env.ALPACA_PAPER_ONLY !== 'false',
  };
}

function assertAlpacaPaper(config) {
  if (!config.key || !config.secret) throw new Error('Missing Alpaca paper API keys in server environment.');
  if (config.paperOnly && !config.baseUrl.includes('paper-api.alpaca.markets')) {
    throw new Error('Alpaca live endpoint blocked. Use https://paper-api.alpaca.markets for this app.');
  }
}

async function alpacaRequest(pathname, options = {}) {
  const config = alpacaConfig();
  assertAlpacaPaper(config);
  const response = await fetch(`${config.baseUrl}${pathname}`, {
    ...options,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'APCA-API-KEY-ID': config.key,
      'APCA-API-SECRET-KEY': config.secret,
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); }
    catch { data = { message: text }; }
  }
  if (!response.ok) throw new Error(data?.message || data?.error || `Alpaca request failed: ${response.status}`);
  return data;
}

function brokerSide(side) {
  const normalized = String(side || '').toUpperCase();
  if (normalized === 'LONG' || normalized === 'BUY') return 'buy';
  if (normalized === 'SHORT' || normalized === 'SELL') return 'sell';
  throw new Error('Order side must be LONG/SHORT or BUY/SELL.');
}

async function alpacaApi(req, res, url) {
  try {
    const config = alpacaConfig();
    if (url.pathname === '/api/alpaca/status') {
      send(res, 200, JSON.stringify({
        configured: !!(config.key && config.secret),
        baseUrl: config.baseUrl,
        paperOnly: config.paperOnly,
        liveBlocked: config.paperOnly,
      }), {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      return;
    }
    if (url.pathname === '/api/alpaca/account' && req.method === 'GET') {
      const account = await alpacaRequest('/v2/account');
      send(res, 200, JSON.stringify(account), {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      return;
    }
    if (url.pathname === '/api/alpaca/positions' && req.method === 'GET') {
      const positions = await alpacaRequest('/v2/positions');
      send(res, 200, JSON.stringify(positions), {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      return;
    }
    if (url.pathname === '/api/alpaca/asset' && req.method === 'GET') {
      const symbol = url.searchParams.get('symbol');
      if (!symbol) throw new Error('Asset symbol is required.');
      let asset = null;
      try {
        asset = await alpacaRequest(`/v2/assets/${encodeURIComponent(symbol)}`);
      } catch {
        const assets = await alpacaRequest('/v2/assets?status=active');
        const normalized = symbol.replace('/','').toUpperCase();
        asset = assets.find(item =>
          String(item.symbol || '').toUpperCase() === symbol.toUpperCase() ||
          String(item.symbol || '').replace('/','').toUpperCase() === normalized
        );
        if (!asset) {
          send(res, 200, JSON.stringify({
            symbol,
            tradable: false,
            status: 'unavailable',
            message: `${symbol} is not available in Alpaca paper assets.`,
          }), {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          });
          return;
        }
      }
      send(res, 200, JSON.stringify(asset), {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      return;
    }
    if (url.pathname === '/api/alpaca/orders' && req.method === 'GET') {
      const status = url.searchParams.get('status') || 'open';
      const orders = await alpacaRequest(`/v2/orders?status=${encodeURIComponent(status)}&limit=25&direction=desc`);
      send(res, 200, JSON.stringify(orders), {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      return;
    }
    if (url.pathname === '/api/alpaca/orders/cancel-all' && req.method === 'POST') {
      const result = await alpacaRequest('/v2/orders', { method: 'DELETE' });
      send(res, 200, JSON.stringify(result || []), {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      return;
    }
    if (url.pathname === '/api/alpaca/positions/close-all' && req.method === 'POST') {
      const result = await alpacaRequest('/v2/positions?cancel_orders=true', { method: 'DELETE' });
      send(res, 200, JSON.stringify(result || []), {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      return;
    }
    if (url.pathname === '/api/alpaca/positions/close' && req.method === 'POST') {
      const body = await readJson(req);
      const symbol = String(body.symbol || '').trim().toUpperCase();
      if (!symbol) throw new Error('Position symbol is required.');
      const result = await alpacaRequest(`/v2/positions/${encodeURIComponent(symbol)}`, { method: 'DELETE' });
      send(res, 200, JSON.stringify(result || {}), {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      return;
    }
    if (url.pathname === '/api/alpaca/orders' && req.method === 'POST') {
      const body = await readJson(req);
      const symbol = String(body.symbol || '').trim().toUpperCase();
      const qty = Number(body.qty);
      if (!symbol) throw new Error('Alpaca symbol is required.');
      if (!Number.isFinite(qty) || qty <= 0) throw new Error('Order quantity must be positive.');
      const order = await alpacaRequest('/v2/orders', {
        method: 'POST',
        body: JSON.stringify({
          symbol,
          qty: String(qty),
          side: brokerSide(body.side),
          type: body.type || 'market',
          time_in_force: body.time_in_force || (symbol.includes('/') ? 'gtc' : 'day'),
          client_order_id: `signalos-${Date.now()}`,
        }),
      });
      send(res, 200, JSON.stringify(order), {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      return;
    }
    send(res, 404, JSON.stringify({ error: 'Unknown Alpaca API route' }), {
      'content-type': 'application/json; charset=utf-8',
    });
  } catch (error) {
    send(res, 400, JSON.stringify({ error: error.message }), {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
  }
}

async function proxyBinance(req, res, pathname, search) {
  const upstream = `https://fapi.binance.com${pathname.replace('/api/binance', '')}${search}`;
  try {
    const response = await fetch(upstream);
    const body = await response.text();
    if (!response.ok && pathname.endsWith('/fapi/v1/klines')) {
      const fallback = await fetchCoinbaseKlines(search);
      send(res, 200, JSON.stringify(fallback), {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      return;
    }
    if (!response.ok && (pathname.endsWith('/fapi/v1/premiumIndex') || pathname.endsWith('/fapi/v1/openInterest'))) {
      send(res, 200, JSON.stringify({ unavailable: true }), {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      return;
    }
    send(res, response.status, body, {
      'content-type': response.headers.get('content-type') || 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
  } catch (error) {
    send(res, 502, JSON.stringify({ error: 'Binance proxy failed', detail: error.message }), {
      'content-type': 'application/json; charset=utf-8',
    });
  }
}

function decodeXml(value = '') {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function tagValue(item, tag) {
  const match = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? decodeXml(match[1]) : '';
}

function parseRssItems(xml, source, limit = 10) {
  const items = String(xml || '').match(/<item[\s\S]*?<\/item>/gi) || [];
  return items.slice(0, limit).map(item => ({
    title: tagValue(item, 'title'),
    url: tagValue(item, 'link') || tagValue(item, 'guid'),
    published_at: tagValue(item, 'pubDate') || tagValue(item, 'dc:date') || new Date().toISOString(),
    source,
    coins: [],
  })).filter(article => article.title && article.url);
}

async function fetchRssNews(limit = 10) {
  const feeds = [
    ['CoinTelegraph', 'https://cointelegraph.com/rss'],
    ['CoinDesk', 'https://www.coindesk.com/arc/outboundfeeds/rss/'],
    ['Decrypt', 'https://decrypt.co/feed'],
  ];
  const results = await Promise.allSettled(feeds.map(async ([source, url]) => {
    const response = await fetch(url, { headers: { 'user-agent': 'SignalOS local dev server' } });
    if (!response.ok) throw new Error(`${source} RSS ${response.status}`);
    return parseRssItems(await response.text(), source, limit);
  }));
  return results
    .flatMap(result => result.status === 'fulfilled' ? result.value : [])
    .sort((a,b) => new Date(b.published_at) - new Date(a.published_at))
    .slice(0, limit);
}

async function cryptoNewsApi(req, res, url) {
  const limit = Math.min(Number(url.searchParams.get('limit') || 10), 50);
  try {
    const upstream = `https://cryptocurrency.cv/api/news?limit=${limit}`;
    const response = await fetch(upstream, {
      headers: {
        accept: 'application/json',
        'user-agent': 'Mozilla/5.0 SignalOS local dev server',
      },
    });
    const data = await response.json().catch(() => ({}));
    const articles = Array.isArray(data.articles) ? data.articles : [];
    if (response.ok && articles.length) {
      send(res, 200, JSON.stringify({ articles, source: 'cryptocurrency.cv', fallback: false }), {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      return;
    }
    const rssArticles = await fetchRssNews(limit);
    send(res, 200, JSON.stringify({
      articles: rssArticles,
      source: 'rss-fallback',
      fallback: true,
      upstreamStatus: response.status,
      upstreamCode: data.code || null,
    }), {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
  } catch (error) {
    try {
      const rssArticles = await fetchRssNews(limit);
      send(res, 200, JSON.stringify({ articles: rssArticles, source: 'rss-fallback', fallback: true, error: error.message }), {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
    } catch (fallbackError) {
      send(res, 502, JSON.stringify({ error: 'Crypto news fetch failed', detail: fallbackError.message }), {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
    }
  }
}

async function fetchCoinbaseKlines(search) {
  const params = new URLSearchParams(search);
  const symbol = params.get('symbol') || 'BTCUSDT';
  const interval = params.get('interval') || '5m';
  const limit = Math.min(Number(params.get('limit') || 200), 300);
  const base = symbol.replace(/(USDT|USDC|BUSD)$/,'').replace(/^1000/, '') || 'BTC';
  const product = `${base}-USD`;
  const granularity = GRANULARITY[interval] || 300;
  const url = `https://api.exchange.coinbase.com/products/${product}/candles?granularity=${granularity}`;
  const response = await fetch(url, {
    headers: { 'user-agent': 'SignalOS local dev server' },
  });
  if (!response.ok) throw new Error(`Coinbase fallback failed: ${response.status}`);
  const candles = await response.json();
  return candles
    .slice(0, limit)
    .sort((a,b)=>a[0]-b[0])
    .map(([time, low, high, open, close, volume]) => {
      const openTime = time * 1000;
      return [
        openTime,
        String(open),
        String(high),
        String(low),
        String(close),
        String(volume),
        openTime + granularity * 1000 - 1,
      ];
    });
}

function serveStatic(req, res, pathname) {
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(ROOT, safePath));
  if (!filePath.startsWith(ROOT)) {
    send(res, 403, 'Forbidden', { 'content-type': 'text/plain; charset=utf-8' });
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      send(res, 404, 'Not found', { 'content-type': 'text/plain; charset=utf-8' });
      return;
    }
    const ext = path.extname(filePath);
    send(res, 200, data, { 'content-type': MIME[ext] || 'application/octet-stream' });
  });
}

function requestHandler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/api/ai/market-brief' && req.method === 'POST') {
    aiMarketBrief(req, res);
    return;
  }
  if (url.pathname === '/api/crypto-news') {
    cryptoNewsApi(req, res, url);
    return;
  }
  if (url.pathname.startsWith('/api/alpaca/')) {
    alpacaApi(req, res, url);
    return;
  }
  if (url.pathname.startsWith('/api/binance/')) {
    proxyBinance(req, res, url.pathname, url.search);
    return;
  }
  serveStatic(req, res, url.pathname);
}

if (require.main === module) {
  const server = http.createServer(requestHandler);
  server.listen(PORT, () => {
    console.log(`SignalOS running at http://localhost:${PORT}`);
  });
}

module.exports = { requestHandler };
