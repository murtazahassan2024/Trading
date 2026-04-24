const Persistence = (() => {
  const SHARED_PROFILE_ID = 'signalos-shared-profile';
  const DEFAULT_CONFIG = {
    url: 'https://gyczvzsqvhvaghasktvg.supabase.co',
    anonKey: 'sb_publishable_Ui385rmmnUDiSLxRtuIYEw_3dI7bgxW',
  };
  let runtimeConfig = { ...DEFAULT_CONFIG };
  let client = null;
  let saveTimer = null;

  function deviceId() {
    return SHARED_PROFILE_ID;
  }

  function config() {
    return { ...runtimeConfig };
  }

  function saveConfig(url, anonKey) {
    runtimeConfig = {
      url: url || DEFAULT_CONFIG.url,
      anonKey: anonKey || DEFAULT_CONFIG.anonKey,
    };
    setup();
  }

  function setup() {
    const { url, anonKey } = config();
    if (!url || !anonKey || !window.supabase) {
      client = null;
      return false;
    }
    client = window.supabase.createClient(url, anonKey);
    return true;
  }

  async function load() {
    if (!client && !setup()) return null;
    const { data, error } = await client
      .from('signalos_state')
      .select('state')
      .eq('device_id', deviceId())
      .maybeSingle();
    if (error) throw error;
    return data?.state || null;
  }

  async function save(state) {
    if (!client && !setup()) return false;
    const { error } = await client
      .from('signalos_state')
      .upsert({
        device_id: deviceId(),
        state,
        updated_at: new Date().toISOString(),
      });
    if (error) throw error;
    return true;
  }

  async function saveAlert(alert) {
    if (!client && !setup()) return false;
    const { error } = await client
      .from('signalos_alerts')
      .insert({
        device_id: deviceId(),
        trade_id: alert.tradeId || null,
        symbol: alert.symbol || null,
        side: alert.side || null,
        kind: alert.kind || 'trade',
        status: alert.status || 'open',
        icon: alert.icon || null,
        color: alert.color || null,
        message: alert.text || alert.message,
        expires_at: alert.expiresAt || null,
      });
    if (error) throw error;
    return true;
  }

  async function loadAlerts() {
    if (!client && !setup()) return [];
    await cleanupExpiredAlerts();
    const { data, error } = await client
      .from('signalos_alerts')
      .select('*')
      .eq('device_id', deviceId())
      .order('created_at', { ascending: false })
      .limit(30);
    if (error) throw error;
    return (data || []).map(row => ({
      icon: row.icon || '◉',
      color: row.color || 'var(--muted)',
      text: row.message,
      ts: new Date(row.created_at).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' }),
      persisted: true,
      tradeId: row.trade_id,
      kind: row.kind,
      status: row.status,
    }));
  }

  async function markTradeAlertsClosed(tradeId) {
    if (!client && !setup()) return false;
    if (!tradeId) return false;
    const expires = new Date(Date.now() + 3*24*60*60*1000).toISOString();
    const { error } = await client
      .from('signalos_alerts')
      .update({ status: 'closed', expires_at: expires })
      .eq('device_id', deviceId())
      .eq('trade_id', tradeId);
    if (error) throw error;
    return true;
  }

  async function cleanupExpiredAlerts() {
    if (!client && !setup()) return false;
    const { error } = await client
      .from('signalos_alerts')
      .delete()
      .eq('device_id', deviceId())
      .not('expires_at', 'is', null)
      .lt('expires_at', new Date().toISOString());
    if (error) throw error;
    return true;
  }

  function saveSoon(stateFactory) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      save(stateFactory()).catch(err => setStatus(`Supabase save failed: ${err.message}`));
    }, 600);
  }

  function setStatus(text) {
    const el = document.getElementById('supabase-state');
    if (el) el.textContent = text;
  }

  function fillInputs() {
    const { url, anonKey } = config();
    const urlEl = document.getElementById('supabase-url');
    const keyEl = document.getElementById('supabase-key');
    if (urlEl) urlEl.value = url || '';
    if (keyEl) keyEl.value = anonKey || '';
  }

  return { config, saveConfig, setup, load, save, saveSoon, saveAlert, loadAlerts, markTradeAlertsClosed, cleanupExpiredAlerts, setStatus, fillInputs, deviceId };
})();

window.Persistence = Persistence;
