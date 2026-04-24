let sockets = [];
let connected = false;
let activeConnectionId = 0;

function wsBase() {
  return document.getElementById('testnet').checked
    ? 'wss://testnet.binancefuture.com/ws'
    : 'wss://fstream.binance.com/stream';
}

function closeAll() {
  activeConnectionId++;
  sockets.forEach(s=>{try{s.close();}catch(e){}});
  sockets=[];
}

function openWS(sym,tf) {
  const connectionId = ++activeConnectionId;
  const s=sym.toLowerCase();
  const streams=`${s}@kline_${tf}/${s}@miniTicker/${s}@depth5@100ms`;
  const url=`${wsBase()}?streams=${streams}`;
  setStatus('connecting');

  const sock=new WebSocket(url);
  sockets.push(sock);

  sock.onopen=()=>{
    if (connectionId !== activeConnectionId) return;
    setStatus('connected');
    connected=true;
    hideOverlay();
    document.getElementById('cbtn').textContent='Disconnect';
    document.getElementById('cbtn').classList.add('live');
    document.getElementById('m-sym').textContent=sym;
    document.getElementById('chart-label').textContent=sym+' · '+tf.toUpperCase();
    pushAlert('◉','#00e5a0',`Connected to Binance Futures WebSocket — streaming ${sym} ${tf}`);
  };

  sock.onmessage=evt=>{
    if (connectionId !== activeConnectionId) return;
    const {stream,data}=JSON.parse(evt.data);

    if(stream.includes('@kline')){
      const k=data.k;
      if(k.x){
        K.t.push(k.t);K.o.push(+k.o);K.h.push(+k.h);K.l.push(+k.l);K.c.push(+k.c);K.v.push(+k.v);
        const d=new Date(k.t);
        K.labels.push(d.getHours()+':'+(d.getMinutes()+'').padStart(2,'0'));
        if(K.c.length>MAX){['t','o','h','l','c','v','labels'].forEach(key=>K[key].shift());}
        renderChart();
        runAnalysis();
        pushAlert('◉','#7b6fff',`${tf} candle closed at $${(+k.c).toLocaleString(undefined,{maximumFractionDigits:2})}`);
      } else if(K.c.length>0){
        K.c[K.c.length-1]=+k.c;
        K.h[K.h.length-1]=Math.max(K.h[K.h.length-1],+k.h);
        K.l[K.l.length-1]=Math.min(K.l[K.l.length-1],+k.l);
      }
    }

    if(stream.includes('@miniTicker')){
      const p=parseFloat(data.c), chg=parseFloat(data.P);
      const prev=parseFloat((document.getElementById('m-price').textContent||'0').replace(/[$,]/g,''))||p;
      const pel=document.getElementById('m-price');
      pel.textContent='$'+p.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:4});
      pel.style.color=p>prev?'var(--accent)':p<prev?'var(--accent2)':'var(--text)';
      document.getElementById('m-chg').textContent=(chg>=0?'+':'')+chg.toFixed(2)+'%';
      document.getElementById('m-chg').style.color=chg>=0?'var(--accent)':'var(--accent2)';
      document.getElementById('m-chgsub').textContent=chg>=0?'gaining today':'losing today';
      const vol=parseFloat(data.q);
      document.getElementById('m-vol').textContent='$'+(vol>=1e9?(vol/1e9).toFixed(2)+'B':vol>=1e6?(vol/1e6).toFixed(2)+'M':vol.toFixed(0));
      if (typeof updatePaperTrade === 'function') updatePaperTrade(p);
    }

    if(stream.includes('@depth')){
      renderOB(data.asks||[],data.bids||[]);
    }
  };

  sock.onerror=()=>{
    if (connectionId === activeConnectionId) setStatus('disconnected');
  };
  sock.onclose=()=>{
    if (connectionId !== activeConnectionId) return;
    setStatus('disconnected');
    document.getElementById('cbtn').textContent='Connect';
    document.getElementById('cbtn').classList.remove('live');
    connected=false;
  };
}
