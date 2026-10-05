import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import sodium from "npm:libsodium-wrappers@0.7.15";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const allowedSecrets = new Set([
  "ANDROID_KEYSTORE_BASE64",
  "ANDROID_KEYSTORE_PASSWORD",
  "ANDROID_KEY_ALIAS",
  "ANDROID_KEY_PASSWORD",
]);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json" },
});
const validRepo = (value: string) => /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: { user }, error: userError } = await supabase.auth.getUser(auth.slice(7));
  if (userError || !user) return json({ error: "unauthorized" }, 401);

  let body: { action?: string; repo?: string; githubToken?: string; secrets?: Record<string, string>; workflow?: string; ref?: string };
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  if (!body.repo || !validRepo(body.repo)) return json({ error: "invalid_repo" }, 400);
  if (!body.githubToken || body.githubToken.length < 20 || body.githubToken.length > 500) {
    return json({ error: "invalid_github_token" }, 400);
  }

  const [owner, repo] = body.repo.split("/");
  const ghHeaders = {
    "Accept": "application/vnd.github+json",
    "Authorization": `Bearer ${body.githubToken}`,
    "X-GitHub-Api-Version": "2026-03-10",
    "Content-Type": "application/json",
    "User-Agent": "Web2APK",
  };
  const repoCheck = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers: ghHeaders });
  if (!repoCheck.ok) return json({ error: "github_repo_access_denied" }, repoCheck.status === 404 ? 404 : 403);

  if (body.action === "set_secrets") {
    const entries = Object.entries(body.secrets ?? {});
    if (!entries.length || entries.length > 4) return json({ error: "invalid_secret_count" }, 400);
    if (entries.some(([name, value]) => !allowedSecrets.has(name) || !value || value.length > 49152)) {
      return json({ error: "invalid_secret" }, 400);
    }
    const keyResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/secrets/public-key`, { headers: ghHeaders });
    if (!keyResponse.ok) return json({ error: "github_public_key_failed" }, keyResponse.status);
    const publicKey = await keyResponse.json();
    await sodium.ready;
    const keyBytes = sodium.from_base64(publicKey.key, sodium.base64_variants.ORIGINAL);
    const results: string[] = [];
    for (const [name, value] of entries) {
      const encrypted = sodium.crypto_box_seal(new TextEncoder().encode(value), keyBytes);
      const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/secrets/${name}`, {
        method: "PUT",
        headers: ghHeaders,
        body: JSON.stringify({
          encrypted_value: sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL),
          key_id: publicKey.key_id,
        }),
      });
      if (!response.ok) return json({ error: "github_secret_write_failed", secret: name }, response.status);
      results.push(name);
    }
    return json({ ok: true, action: "set_secrets", secrets: results });
  }

  if (body.action === "dispatch") {
    const workflow = body.workflow || "android-build.yml";
    const ref = body.ref || "main";
    if (!/^[A-Za-z0-9_.-]+\.yml$/.test(workflow)) return json({ error: "invalid_workflow" }, 400);
    if (!/^[A-Za-z0-9._\/-]{1,100}$/.test(ref)) return json({ error: "invalid_ref" }, 400);
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`,
      { method: "POST", headers: ghHeaders, body: JSON.stringify({ ref }) },
    );
    if (!response.ok) return json({ error: "github_dispatch_failed" }, response.status);
    return json({ ok: true, action: "dispatch" });
  }

  return json({ error: "unsupported_action" }, 400);
});
