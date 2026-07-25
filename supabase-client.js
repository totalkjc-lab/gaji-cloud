// supabase-client.js — must load after config.js and the Supabase CDN
// script tag (<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js">).
window.sb = supabase.createClient(
  window.GAJI_CONFIG.supabaseUrl,
  window.GAJI_CONFIG.supabaseAnonKey
);
