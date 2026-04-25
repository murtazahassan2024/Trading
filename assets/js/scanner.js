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
      const sr=strategies(ind);
      const plan=positionPlan(ind, sr);
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
        price:ind.last,
        ind,
        plan
      };
    } catch(e) {
      return {symbol:sym,error:e.message};
    }
  }));
  lastScannerRows = rows;
  renderScanner(rows);
  maybeAutoScout(rows);
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
    .filter(r => !paperTrades.some(trade => trade.symbol === r.symbol))
    .sort((a,b) => Math.max(b.longScore,b.shortScore)-Math.max(a.longScore,a.shortScore))
    .slice(0, slots);
  ranked.forEach(row => {
    const opened = openPaperTradeFromPlan(row.side, row.price, row.ind, row.plan, 'auto', {
      symbol: row.symbol,
      activate: row.symbol === currentSymbol()
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
