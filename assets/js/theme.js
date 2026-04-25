function initTheme() {
  const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  setTheme(prefersLight ? 'light' : 'dark', { persist: false });
}

function setTheme(theme, options = {}) {
  const { persist = true } = options;
  const light = theme === 'light';
  document.body.classList.toggle('light', light);
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = light ? 'Dark' : 'Light';
  updateChartTheme();
  if (persist) persistAppStateSoon();
}

function toggleTheme() {
  setTheme(document.body.classList.contains('light') ? 'dark' : 'light');
}

function cssVar(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

function collectPersistedState() {
  return {
    version: 1,
    paperTrades,
    activeTradeId,
    paperLedger,
    paperTrade,
    autoPaper,
    autoScout,
    autoScoutMax: document.getElementById('auto-scout-max')?.value || '3',
    autoScoutMinConf: document.getElementById('auto-scout-conf')?.value || '65',
    theme: document.body.classList.contains('light') ? 'light' : 'dark',
    symbol: document.getElementById('ticker')?.value || 'BTCUSDT',
    timeframe: document.getElementById('timeframe')?.value || '5m',
    accountSize: document.getElementById('acct-size')?.value || '10000',
    riskPct: document.getElementById('risk-pct')?.value || '1',
    feePct: document.getElementById('fee-pct')?.value || '0.05',
  };
}

function applyPersistedState(state) {
  if (!state) return;
  paperTrades = Array.isArray(state.paperTrades)
    ? state.paperTrades
    : (state.paperTrade ? [state.paperTrade] : []);
  activeTradeId = state.activeTradeId || paperTrades[0]?.tradeId || null;
  syncPaperTradeSelection();
  paperLedger = Array.isArray(state.paperLedger) ? state.paperLedger : [];
  autoPaper = !!state.autoPaper;
  autoScout = !!state.autoScout;
  if (state.theme) setTheme(state.theme, { persist: false });
  if (state.symbol) document.getElementById('ticker').value = state.symbol;
  if (state.timeframe) document.getElementById('timeframe').value = state.timeframe;
  if (state.accountSize) document.getElementById('acct-size').value = state.accountSize;
  if (state.riskPct) document.getElementById('risk-pct').value = state.riskPct;
  if (state.feePct) document.getElementById('fee-pct').value = state.feePct;
  if (state.autoScoutMax && document.getElementById('auto-scout-max')) document.getElementById('auto-scout-max').value = state.autoScoutMax;
  if (state.autoScoutMinConf && document.getElementById('auto-scout-conf')) document.getElementById('auto-scout-conf').value = state.autoScoutMinConf;
  const btn = document.getElementById('auto-paper-btn');
  if (btn) {
    btn.textContent = `Auto Paper: ${autoPaper ? 'On' : 'Off'}`;
    btn.classList.toggle('active', autoPaper);
  }
  syncAutoScoutButton();
  renderOpenTrades();
  if (paperTrade) {
    const price = Number.isFinite(paperTrade.lastPrice) ? paperTrade.lastPrice : paperTrade.entry;
    const exit = exitSignalForTrade(paperTrade, price, lastSignalSnapshot);
    renderTradeStatus(paperTrade, computeTradePnl(paperTrade, price), exit.status, exit.rule);
  } else {
    renderTradeStatus(null, null, 'Waiting', 'Open a paper long/short to track it');
  }
  renderTradeDetail(true);
  renderLedger();
  renderRiskDashboard();
  renderPositionSizing();
  if (typeof runLiveReadiness === 'function') runLiveReadiness();
}

function persistAppStateSoon() {
  if (window.Persistence) Persistence.saveSoon(collectPersistedState);
}

async function saveAppStateNow() {
  try {
    await Persistence.save(collectPersistedState());
    Persistence.setStatus(`Saved to Supabase at ${new Date().toLocaleTimeString()}`);
  } catch (err) {
    Persistence.setStatus(`Save failed: ${err.message}`);
  }
}

async function connectSupabase() {
  const url = document.getElementById('supabase-url').value.trim();
  const key = document.getElementById('supabase-key').value.trim();
  if (!url || !key) {
    Persistence.setStatus('Add your Supabase URL and anon key first.');
    return;
  }
  try {
    Persistence.saveConfig(url, key);
    const state = await Persistence.load();
    applyPersistedState(state);
    await saveAppStateNow();
    Persistence.setStatus('Connected to shared Supabase profile.');
  } catch (err) {
    Persistence.setStatus(`Supabase connect failed: ${err.message}`);
  }
}
