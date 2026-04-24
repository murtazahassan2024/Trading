const Persistence = (() => {
  const CONFIG_KEY = 'signalos-supabase-config';
  const DEVICE_KEY = 'signalos-device-id';
  const DEFAULT_CONFIG = {
    url: 'https://gyczvzsqvhvaghasktvg.supabase.co',
    anonKey: 'sb_publishable_Ui385rmmnUDiSLxRtuIYEw_3dI7bgxW',
  };
  let client = null;
  let saveTimer = null;

  function deviceId() {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  }

  function config() {
    try {
      const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
      return {
        url: saved.url || DEFAULT_CONFIG.url,
        anonKey: saved.anonKey || DEFAULT_CONFIG.anonKey,
      };
    }
    catch { return DEFAULT_CONFIG; }
  }

  function saveConfig(url, anonKey) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify({ url, anonKey }));
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

  return { config, saveConfig, setup, load, save, saveSoon, setStatus, fillInputs, deviceId };
})();

window.Persistence = Persistence;
