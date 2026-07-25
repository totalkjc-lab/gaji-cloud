// supabase-client.js — must load after config.js and the Supabase CDN
// script tag (<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js">).
if (
  window.GAJI_CONFIG.supabaseUrl.includes("YOUR-PROJECT") ||
  window.GAJI_CONFIG.supabaseAnonKey.includes("YOUR-ANON-KEY")
) {
  // alert(), not a DOM write: this script can run in <head>, before <body> exists (map.html).
  alert("config.js에 Supabase 프로젝트 정보를 먼저 채워주세요.");
  throw new Error("config.js not filled in");
}
window.sb = supabase.createClient(
  window.GAJI_CONFIG.supabaseUrl,
  window.GAJI_CONFIG.supabaseAnonKey
);
