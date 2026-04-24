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
        price:ind.last
      };
    } catch(e) {
      return {symbol:sym,error:e.message};
    }
  }));
  renderScanner(rows);
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
