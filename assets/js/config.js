const SUPABASE_URL = "https://hponoukkcegkwddenfqd.supabase.co";
const SUPABASE_KEY = "sb_publishable_YafhKR9rFsUOgTRCfHYGNQ__BPfUS8Q";
const GITHUB_REPO = "gpldroid/claudtest";

if (!window.supabase?.createClient) {
  throw new Error("Supabase client library failed to load.");
}

export { SUPABASE_URL, SUPABASE_KEY, GITHUB_REPO };

export const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

// GitHub provider tokens are intentionally kept in memory only.
// Supabase does not persist provider tokens for security reasons.
let githubProviderToken = "";

client.auth.onAuthStateChange((_event, session) => {
  if (session?.provider_token) {
    githubProviderToken = session.provider_token;
  }
  if (!session) {
    githubProviderToken = "";
  }
});

export async function getGitHubProviderToken() {
  if (githubProviderToken) return githubProviderToken;
  const { data: { session } } = await client.auth.getSession();
  if (session?.provider_token) {
    githubProviderToken = session.provider_token;
    return githubProviderToken;
  }
  return "";
}

export function clearGitHubProviderToken() {
  githubProviderToken = "";
}
