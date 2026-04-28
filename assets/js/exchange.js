const Exchange = (() => {
  const providers = {
    binance: {
      name: 'Binance Futures',
      restBase() {
        return document.getElementById('testnet')?.checked
          ? 'https://testnet.binancefuture.com'
          : '/api/binance';
      },
      wsBase() {
        return document.getElementById('testnet')?.checked
          ? 'wss://testnet.binancefuture.com/ws'
          : 'wss://fstream.binance.com/stream';
      },
      async klines(symbol, interval, limit = 200) {
        const url = `${this.restBase()}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
        const response = await fetch(url);
        const data = await response.json();
        if (!Array.isArray(data)) throw new Error(data?.msg || 'Kline data unavailable');
        return data.map(k => ({
          time: k[0],
          open: +k[1],
          high: +k[2],
          low: +k[3],
          close: +k[4],
          volume: +k[5],
        }));
      },
      async meta(symbol) {
        const [funding, oi, longShort] = await Promise.all([
          fetch(`${this.restBase()}/fapi/v1/premiumIndex?symbol=${symbol}`).then(r=>r.json()),
          fetch(`${this.restBase()}/fapi/v1/openInterest?symbol=${symbol}`).then(r=>r.json()),
          fetch(`${this.restBase()}/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=5m&limit=1`).then(r=>r.json()).catch(() => null),
        ]);
        return { funding, openInterest: oi, longShort };
      },
      streams(symbol, interval) {
        const s = symbol.toLowerCase();
        return `${s}@kline_${interval}/${s}@miniTicker/${s}@depth5@100ms`;
      },
    },
  };

  let current = providers.binance;

  return {
    get name() { return current.name; },
    restBase: () => current.restBase(),
    wsBase: () => current.wsBase(),
    klines: (symbol, interval, limit) => current.klines(symbol, interval, limit),
    meta: symbol => current.meta(symbol),
    streams: (symbol, interval) => current.streams(symbol, interval),
  };
})();
