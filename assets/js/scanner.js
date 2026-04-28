function seriesFromKlines(data) {
  return data.reduce((acc,k)=>{
    acc.t.push(k[0]);acc.o.push(+k[1]);acc.h.push(+k[2]);acc.l.push(+k[3]);acc.c.push(+k[4]);acc.v.push(+k[5]);
    return acc;
  }, { o:[], h:[], l:[], c:[], v:[], t:[] });
}

async function fetchKlineData(sym,tf,limit=200) {
  const candles = await Exchange.klines(sym, tf, limit);
  return candles.map(k=>[
    k.time,
    String(k.open),
    String(k.high),
    String(k.low),
    String(k.close),
    String(k.volume),
  ]);
}

async function scanMarkets() {
  const tf=document.getElementById('timeframe').value;
  const rows = await Promise.all(SCAN_SYMBOLS.map(async sym=>{
    try {
      const data=await fetchKlineData(sym,tf,200);
      const s=seriesFromKlines(data);
      const ind=computeSeries(s.o,s.h,s.l,s.c,s.v);
      const sr=strategies(ind, { fundingRatePct: null, skipMtf: true });
      const plan=positionPlan(ind, sr);
      const quality=tradeQuality(ind, sr, plan.side);
      const longScore=sr.buyScore-sr.sellScore;
      const shortScore=sr.sellScore-sr.buyScore;
      return {
        symbol:sym,
        signal:sr.cons,
        side:plan.side,
        conf:sr.conf,
        edge:sr.edge,
        longScore,
        shortScore,
        adx:ind.adx??'—',
        regime:sr.trending?'trend':'range',
        risk:ind.risk?`risk ${ind.risk.riskPct}%`:'risk —',
        riskPct: ind.risk?.riskPct ?? null,
        quality,
        price:ind.last,
        closes:s.c.slice(-80),
        ind,
        sr,
        plan
      };
    } catch(e) {
      return {symbol:sym,error:e.message};
    }
  }));
  lastScannerRows = rows;
  updateCorrelationCache(rows);
  renderScanner(rows);
  maybeAutoScout(rows);
}

function returnsFromCloses(closes) {
  const out = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) out.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  return out;
}

function pearsonCorrelation(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 30) return null;
  const x = a.slice(-n);
  const y = b.slice(-n);
  const mx = x.reduce((s,v)=>s+v,0)/n;
  const my = y.reduce((s,v)=>s+v,0)/n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const xv = x[i] - mx;
    const yv = y[i] - my;
    num += xv * yv;
    dx += xv * xv;
    dy += yv * yv;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : null;
}

function updateCorrelationCache(rows) {
  const series = rows
    .filter(row => !row.error && Array.isArray(row.closes) && row.closes.length > 30)
    .reduce((acc,row) => {
      acc[row.symbol] = returnsFromCloses(row.closes);
      return acc;
    }, {});
  const cache = {};
  Object.keys(series).forEach(a => {
    cache[a] = {};
    Object.keys(series).forEach(b => {
      if (a === b) return;
      const corr = pearsonCorrelation(series[a], series[b]);
      if (Number.isFinite(corr)) cache[a][b] = corr;
    });
  });
  correlationCache = cache;
}

function syncAutoScoutButton() {
  const btn = document.getElementById('auto-scout-btn');
  if (!btn) return;
  btn.textContent = `Auto Scout: ${autoScout ? 'On' : 'Off'}`;
  btn.classList.toggle('active', autoScout);
}

function toggleAutoScout() {
  autoScout = !autoScout;
  syncAutoScoutButton();
  pushAlert('S', autoScout ? '#00e5a0' : '#f5c842', `Auto scout ${autoScout ? 'enabled' : 'disabled'}`);
  persistAppStateSoon();
  scanMarkets();
}

function scannerAutoSettings() {
  return {
    maxOpen: clamp(Number(document.getElementById('auto-scout-max')?.value || 3), 1, 8),
    minConf: clamp(Number(document.getElementById('auto-scout-conf')?.value || 65), 50, 95),
  };
}

function maybeAutoScout(rows) {
  if (!autoScout || Date.now() - lastScoutActionAt < 5000) return;
  const {maxOpen, minConf} = scannerAutoSettings();
  const slots = maxOpen - paperTrades.length;
  if (slots <= 0) return;
  const ranked = rows
    .filter(r => !r.error && (r.side === 'LONG' || r.side === 'SHORT'))
    .filter(r => r.conf >= minConf && r.riskPct !== null && r.riskPct <= 1.1)
    .filter(r => r.quality?.autoPass)
    .filter(r => !paperTrades.some(trade => trade.symbol === r.symbol))
    .sort((a,b) => (b.quality?.score || 0)-(a.quality?.score || 0))
    .slice(0, slots);
  ranked.forEach(row => {
    const opened = openPaperTradeFromPlan(row.side, row.price, row.ind, row.plan, 'auto', {
      symbol: row.symbol,
      activate: row.symbol === currentSymbol(),
      signalSnapshot: row.sr,
      source: 'scanner'
    });
    if (opened) {
      pushAlert(row.side === 'LONG' ? '▲' : '▼', row.side === 'LONG' ? '#00e5a0' : '#ff4d6d', `Auto scout opened ${row.side} ${row.symbol} from scanner confidence ${row.conf}%`);
    }
  });
  if (ranked.length) {
    lastScoutActionAt = Date.now();
    renderOpenTrades();
    renderRiskDashboard();
    persistAppStateSoon();
  }
}

function selectSymbol(sym) {
  document.getElementById('ticker').value=sym;
  persistAppStateSoon();
  if (connected) {
    closeAll();
    connected=false;
  }
  setTimeout(()=>toggleConnect(),150);
}
