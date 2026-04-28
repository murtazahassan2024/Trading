function alpacaSymbolFromSignal(symbol = currentSymbol()) {
  const raw = String(symbol || '').toUpperCase().trim();
  const base = raw.replace(/(USDT|USDC|BUSD)$/, '').replace(/^1000/, '');
  const map = {
    BTC:'BTC/USD',
    ETH:'ETH/USD',
    SOL:'SOL/USD',
    DOGE:'DOGE/USD',
    LTC:'LTC/USD',
    BCH:'BCH/USD',
    LINK:'LINK/USD',
    UNI:'UNI/USD',
    AAVE:'AAVE/USD',
    AVAX:'AVAX/USD',
  };
  return map[base] || raw;
}

async function alpacaFetch(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Alpaca request failed');
  return data;
}

function setAlpacaStatus(title, detail, ok = false) {
  const el = document.getElementById('alpaca-status');
  if (!el) return;
  el.classList.toggle('ready', ok);
  el.innerHTML = `<strong>${title}</strong><span>${detail}</span>`;
}

function syncAlpacaSymbol() {
  const input = document.getElementById('alpaca-symbol');
  if (!input || input.dataset.touched) return;
  input.value = alpacaSymbolFromSignal();
  validateAlpacaSymbol();
}

function symbolMappingNote(symbol = document.getElementById('alpaca-symbol')?.value || '') {
  const mapped = alpacaSymbolFromSignal();
  const current = currentSymbol();
  if (symbol === current && current.endsWith('USDT')) {
    return `${current} may not be tradable on Alpaca. Suggested mapping: ${mapped}.`;
  }
  if (!symbol.includes('/') && current.endsWith('USDT')) {
    return `${symbol} is being treated as a stock/ETF symbol, not Binance futures.`;
  }
  return `Mapped from ${current} to Alpaca symbol ${symbol}.`;
}

async function validateAlpacaSymbol() {
  const el = document.getElementById('alpaca-symbol-state');
  const symbol = document.getElementById('alpaca-symbol')?.value.trim().toUpperCase();
  if (!el || !symbol) return false;
  el.textContent = `Checking ${symbol}...`;
  try {
    const result = await alpacaFetch(`/api/alpaca/asset?symbol=${encodeURIComponent(symbol)}`);
    const tradable = result.tradable !== false && !['inactive','unavailable'].includes(result.status);
    el.textContent = tradable
      ? `${symbol} tradable on Alpaca paper. ${symbolMappingNote(symbol)}`
      : `${result.message || `${symbol} is not tradable on Alpaca paper.`} Choose another Alpaca symbol.`;
    el.style.color = tradable ? 'var(--accent)' : 'var(--accent2)';
    return tradable;
  } catch (error) {
    el.textContent = `${symbol} not validated: ${error.message}. ${symbolMappingNote(symbol)}`;
    el.style.color = 'var(--gold)';
    return false;
  }
}

function alpacaOrderPlan() {
  const trade = paperTrade;
  const symbol = document.getElementById('alpaca-symbol')?.value.trim().toUpperCase() || alpacaSymbolFromSignal();
  const qty = Number(document.getElementById('alpaca-qty')?.value || 0);
  const side = trade ? trade.side : lastSignalSnapshot?.plan?.side;
  return {
    symbol,
    qty,
    side,
    source: trade ? `${trade.side} ${trade.symbol} selected paper trade` : 'current strategy plan',
  };
}

function previewAlpacaOrder() {
  syncAlpacaSymbol();
  const preview = document.getElementById('alpaca-preview');
  const plan = alpacaOrderPlan();
  if (!preview) return;
  if (!plan.side || !['LONG','SHORT'].includes(plan.side)) {
    preview.textContent = 'No executable probability setup selected. Select an open paper trade or wait for the ensemble threshold.';
    return;
  }
  if (!Number.isFinite(plan.qty) || plan.qty <= 0) {
    preview.textContent = 'Enter a positive Alpaca quantity before submitting.';
    return;
  }
  const brokerSide = plan.side === 'LONG' ? 'BUY' : 'SELL';
  preview.textContent = `${brokerSide} ${plan.qty} ${plan.symbol} · source: ${plan.source}. Paper-only endpoint; not Binance Futures.`;
  validateAlpacaSymbol();
}

async function syncAlpacaBroker() {
  syncAlpacaSymbol();
  try {
    const status = await alpacaFetch('/api/alpaca/status');
    if (!status.configured) {
      setAlpacaStatus('NOT CONNECTED', 'Add Alpaca paper keys to .env, then restart.', false);
      return;
    }
    const [account, positions, orders] = await Promise.all([
      alpacaFetch('/api/alpaca/account'),
      alpacaFetch('/api/alpaca/positions'),
      alpacaFetch('/api/alpaca/orders?status=open'),
    ]);
    renderAlpacaAccount(account, positions, orders);
    setAlpacaStatus('PAPER CONNECTED', 'Alpaca paper account synced. Live endpoint remains blocked.', true);
  } catch (error) {
    setAlpacaStatus('SYNC FAILED', error.message, false);
  }
}

function renderAlpacaAccount(account, positions = [], orders = []) {
  const acct = document.getElementById('alpaca-account');
  if (acct) {
    acct.innerHTML = `
      <div><span>Equity</span><strong>$${Number(account.equity || 0).toLocaleString(undefined,{maximumFractionDigits:2})}</strong></div>
      <div><span>Buying power</span><strong>$${Number(account.buying_power || 0).toLocaleString(undefined,{maximumFractionDigits:2})}</strong></div>
      <div><span>Cash</span><strong>$${Number(account.cash || 0).toLocaleString(undefined,{maximumFractionDigits:2})}</strong></div>
      <div><span>Portfolio</span><strong>$${Number(account.portfolio_value || 0).toLocaleString(undefined,{maximumFractionDigits:2})}</strong></div>
      <div><span>Status</span><strong>${account.status || '—'}</strong></div>
      <div><span>Currency</span><strong>${account.currency || '—'}</strong></div>
      <div><span>Account</span><strong>${account.account_number || account.id || '—'}</strong></div>
      <div><span>Open orders</span><strong>${orders.length}</strong></div>`;
  }
  const pos = document.getElementById('alpaca-positions');
  renderAlpacaOrders(orders);
  if (!pos) return;
  if (!positions.length) {
    pos.innerHTML = '<div class="scan-empty">No Alpaca paper positions.</div>';
    return;
  }
  pos.innerHTML = positions.map(p => `
    <div class="ledger-row alpaca-position-row">
      <strong>${p.symbol}</strong>
      <span>${p.side || '—'}</span>
      <span>Qty ${p.qty}</span>
      <span>Avg $${Number(p.avg_entry_price || 0).toFixed(2)}</span>
      <span style="color:${Number(p.unrealized_pl || 0) >= 0 ? 'var(--accent)' : 'var(--accent2)'}">$${Number(p.unrealized_pl || 0).toFixed(2)}</span>
      <span class="ledger-note">${Number(p.unrealized_plpc || 0) >= 0 ? '+' : ''}${(Number(p.unrealized_plpc || 0)*100).toFixed(2)}%</span>
      <button class="mini-close-btn" type="button" onclick="closeAlpacaPosition('${String(p.symbol || '').replace(/'/g, '\\\'')}')">Close</button>
    </div>`).join('');
}

function renderAlpacaOrders(orders = []) {
  const el = document.getElementById('alpaca-orders');
  if (!el) return;
  if (!orders.length) {
    el.innerHTML = '<div class="scan-empty">No open Alpaca paper orders.</div>';
    return;
  }
  el.innerHTML = orders.map(order => `
    <div class="ledger-row alpaca-order-row">
      <strong>${order.symbol}</strong>
      <span>${String(order.side || '—').toUpperCase()}</span>
      <span>${order.qty || order.notional || '—'}</span>
      <span>${String(order.type || '—').toUpperCase()}</span>
      <span style="color:${order.status === 'filled' ? 'var(--accent)' : order.status === 'rejected' ? 'var(--accent2)' : 'var(--gold)'}">${String(order.status || '—').toUpperCase()}</span>
      <span class="ledger-note">${new Date(order.submitted_at || order.created_at || Date.now()).toLocaleTimeString()}</span>
    </div>`).join('');
}

async function submitAlpacaPaperOrder() {
  previewAlpacaOrder();
  const plan = alpacaOrderPlan();
  const preview = document.getElementById('alpaca-preview');
  if (!plan.side || !['LONG','SHORT'].includes(plan.side)) return;
  if (!Number.isFinite(plan.qty) || plan.qty <= 0) return;
  try {
    const tradable = await validateAlpacaSymbol();
    if (!tradable) throw new Error(`${plan.symbol} did not pass Alpaca tradability validation.`);
    const order = await alpacaFetch('/api/alpaca/orders', {
      method: 'POST',
      body: JSON.stringify({
        symbol: plan.symbol,
        qty: plan.qty,
        side: plan.side,
        type: 'market',
      }),
    });
    if (preview) preview.textContent = `Submitted Alpaca PAPER order ${order.side?.toUpperCase()} ${order.qty} ${order.symbol}. Status: ${order.status}.`;
    pushAlert('A', '#7b6fff', `Alpaca paper order submitted: ${order.side} ${order.qty} ${order.symbol}`);
    syncAlpacaBroker();
  } catch (error) {
    if (preview) preview.textContent = `Alpaca order failed: ${error.message}`;
    pushAlert('!', '#ff4d6d', `Alpaca paper order failed: ${error.message}`);
  }
}

async function cancelAllAlpacaOrders() {
  try {
    const result = await alpacaFetch('/api/alpaca/orders/cancel-all', { method: 'POST' });
    pushAlert('■', '#ff4d6d', `Cancel-all sent to Alpaca paper for ${Array.isArray(result) ? result.length : 0} order(s).`);
    await syncAlpacaBroker();
    return true;
  } catch (error) {
    pushAlert('!', '#ff4d6d', `Alpaca cancel-all failed: ${error.message}`);
    return false;
  }
}

async function liquidateAlpacaPositions() {
  try {
    const result = await alpacaFetch('/api/alpaca/positions/close-all', { method: 'POST' });
    const count = Array.isArray(result) ? result.length : 0;
    pushAlert('■', '#ff4d6d', `Liquidate-all sent to Alpaca paper for ${count} position(s).`);
    await syncAlpacaBroker();
    return true;
  } catch (error) {
    pushAlert('!', '#ff4d6d', `Alpaca liquidate-all failed: ${error.message}`);
    return false;
  }
}

async function closeAlpacaPosition(symbol) {
  if (!symbol) return false;
  try {
    const result = await alpacaFetch('/api/alpaca/positions/close', {
      method: 'POST',
      body: JSON.stringify({ symbol }),
    });
    pushAlert('■', '#ff4d6d', `Close sent to Alpaca paper for ${symbol}. Status: ${result.status || 'submitted'}.`);
    await syncAlpacaBroker();
    return true;
  } catch (error) {
    pushAlert('!', '#ff4d6d', `Alpaca close ${symbol} failed: ${error.message}`);
    return false;
  }
}

async function killSwitch() {
  autoPaper = false;
  autoScout = false;
  syncAutoScoutButton();
  const autoBtn = document.getElementById('auto-paper-btn');
  if (autoBtn) {
    autoBtn.textContent = 'Auto Paper: Off';
    autoBtn.classList.remove('active');
  }
  closeAll();
  const liquidated = await liquidateAlpacaPositions();
  if (!liquidated) await cancelAllAlpacaOrders();
  persistAppStateSoon();
  setAlpacaStatus('KILL SWITCH ACTIVE', 'Automation stopped, streams disconnected, Alpaca paper positions liquidated and orders canceled.', false);
  pushAlert('!', '#ff4d6d', 'Kill switch activated: automation stopped, positions liquidated, and orders canceled.');
}

window.addEventListener('load', () => {
  document.getElementById('alpaca-symbol')?.addEventListener('input', event => {
    event.currentTarget.dataset.touched = 'true';
    validateAlpacaSymbol();
  });
});
