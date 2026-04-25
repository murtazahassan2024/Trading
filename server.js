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

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
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

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/binance/')) {
    proxyBinance(req, res, url.pathname, url.search);
    return;
  }
  serveStatic(req, res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`SignalOS running at http://localhost:${PORT}`);
});
