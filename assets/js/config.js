export const SUPABASE_URL="https://hponoukkcegkwddenfqd.supabase.co";
export const SUPABASE_KEY="sb_publishable_YafhKR9rFsUOgTRCfHYGNQ__BPfUS8Q";
export const GITHUB_REPO="gpldroid/claudtest";
export const client=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});