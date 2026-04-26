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
      if (body.length > 120000) {
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
  const googleKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  const provider = (process.env.AI_PROVIDER || (googleKey ? 'google' : process.env.OPENAI_API_KEY ? 'openai' : process.env.ANTHROPIC_API_KEY ? 'anthropic' : process.env.DEEPSEEK_API_KEY ? 'deepseek' : '')).toLowerCase();
  if (provider === 'google' || provider === 'gemini') return { provider: 'google', key: googleKey, model: process.env.GOOGLE_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash' };
  if (provider === 'anthropic') return { provider, key: process.env.ANTHROPIC_API_KEY, model: process.env.ANTHROPIC_MODEL || 'claude-3-5-haiku-latest' };
  if (provider === 'deepseek') return { provider, key: process.env.DEEPSEEK_API_KEY, model: process.env.DEEPSEEK_MODEL || 'deepseek-chat' };
  return { provider: 'openai', key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL || 'gpt-4o-mini' };
}

function aiPrompt(context) {
  return `You are a cautious AI market coach for a paper-trading crypto dashboard.
Use only the supplied JSON. Do not claim certainty or guarantee profit.
The user wants scanner-wide attention guidance, not analysis anchored to only the selected symbol.
First inspect scannerUniverse/scannerLeaders, then identify which symbols deserve attention because of trend strength, confidence, edge, momentum, risk, or unusual disagreement.
Be extremely brief.
Return valid JSON with keys: headline, summary, focusList.
headline must be 7 words or fewer.
summary must be 12 words or fewer.
focusList must be an array of 1 to 5 objects with keys: symbol, decision, reason.
decision must be exactly one of: BUY, SELL, HOLD.
reason must be 8 words or fewer.
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

async function askOpenAICompatible({ key, model, baseUrl }, context) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
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

async function askAnthropic({ key, model }, context) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 450,
      temperature: 0.2,
      system: 'Return only valid JSON.',
      messages: [{ role: 'user', content: aiPrompt(context) }],
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || `Anthropic request failed: ${response.status}`);
  return extractJson(data.content?.map(part => part.text || '').join('\n') || '{}');
}

async function askGoogle({ key, model }, context) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': key,
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: aiPrompt(context) }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
      },
      systemInstruction: {
        parts: [{ text: 'Return only valid JSON.' }],
      },
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || `Google AI request failed: ${response.status}`);
  return extractJson(data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('\n') || '{}');
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
    if (config.provider === 'anthropic') {
      brief = await askAnthropic(config, context);
    } else if (config.provider === 'google') {
      brief = await askGoogle(config, context);
    } else {
      brief = await askOpenAICompatible({
        key: config.key,
        model: config.model,
        baseUrl: config.provider === 'deepseek' ? 'https://api.deepseek.com/v1' : 'https://api.openai.com/v1',
      }, context);
    }
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
