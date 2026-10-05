import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js/cors";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});
const MAX_HTML = 512 * 1024, MAX_ICON = 192 * 1024, MAX_REDIRECTS = 3;

function privateHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".home.arpa")) return true;
  if (/^(127\.|10\.|192\.168\.|169\.254\.)/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return true;
  if (/^[0-9.]+$/.test(host) || host.includes(":")) return true;
  return false;
}
function targetUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname || privateHost(url.hostname)) throw new Error("invalid_target");
  if (url.port && url.port !== "443") throw new Error("invalid_target");
  return url;
}
function resolveUrl(base: URL, value: string) {
  try { return targetUrl(new URL(value, base).toString()); } catch { return null; }
}
async function fetchLimited(start: URL, maxBytes: number, accept: string) {
  let current = start;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    const response = await fetch(current, { redirect: "manual", headers: { Accept: accept, "User-Agent": "Web2APK-Metadata/1.0" } });
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirect === MAX_REDIRECTS) throw new Error("too_many_redirects");
      const next = resolveUrl(current, location);
      if (!next) throw new Error("invalid_redirect");
      current = next; continue;
    }
    if (!response.ok || !response.body) throw new Error("fetch_failed");
    const length = Number(response.headers.get("content-length") || 0);
    if (length && length > maxBytes) throw new Error("response_too_large");
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      total += item.value.byteLength;
      if (total > maxBytes) { await reader.cancel(); throw new Error("response_too_large"); }
      chunks.push(item.value);
    }
    const bytes = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { url: current, bytes, contentType: response.headers.get("content-type") || "" };
  }
  throw new Error("too_many_redirects");
}
function clean(value: string, max = 80) { return value.replace(/\s+/g, " ").replace(/[<>]/g, "").trim().slice(0, max); }
function meta(html: string, key: string) {
  const patterns = [
    new RegExp("<meta[^>]+(?:property|name)=['\"]" + key + "['\"][^>]+content=['\"]([^'\"]+)['\"][^>]*>", "i"),
    new RegExp("<meta[^>]+content=['\"]([^'\"]+)['\"][^>]+(?:property|name)=['\"]" + key + "['\"][^>]*>", "i")
  ];
  for (const pattern of patterns) { const match = html.match(pattern); if (match && match[1]) return clean(match[1], 120); }
  return "";
}
function extractName(html: string, fallback: string) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [,""])[1];
  return meta(html, "og:title") || meta(html, "twitter:title") || clean(title, 80) || fallback;
}
function extractIcon(html: string, base: URL) {
  const tags = Array.from(html.matchAll(/<link\b[^>]*>/gi)).map((m) => m[0]);
  const candidates: { href: string; score: number }[] = [];
  for (const tag of tags) {
    const rel = (tag.match(/\brel=['"]([^'"]+)['"]/i) || [,""])[1].toLowerCase();
    const href = (tag.match(/\bhref=['"]([^'"]+)['"]/i) || [,""])[1];
    if (!href || !/(icon|shortcut)/.test(rel)) continue;
    const resolved = resolveUrl(base, href); if (!resolved) continue;
    const sizes = (tag.match(/\bsizes=['"]([^'"]+)['"]/i) || [,""])[1];
    candidates.push({ href: resolved.toString(), score: (/apple-touch-icon/.test(rel) ? 30 : /icon/.test(rel) ? 20 : 10) + (/180|192|512/.test(sizes) ? 10 : 0) });
  }
  const favicon = resolveUrl(base, "/favicon.ico"); if (favicon) candidates.push({ href: favicon.toString(), score: 1 });
  candidates.sort((a,b) => b.score - a.score);
  return candidates.length ? candidates[0].href : "";
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const userResult = await supabase.auth.getUser(auth.slice(7));
  if (userResult.error || !userResult.data.user) return json({ error: "unauthorized" }, 401);
  let body: { url?: string };
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  if (typeof body.url !== "string" || body.url.length > 2048) return json({ error: "invalid_url" }, 400);
  try {
    const page = await fetchLimited(targetUrl(body.url), MAX_HTML, "text/html,application/xhtml+xml");
    const html = new TextDecoder("utf-8", { fatal: false }).decode(page.bytes);
    const fallback = page.url.hostname.replace(/^www\./i, "").split(".")[0] || "Web2APK";
    const name = extractName(html, fallback), iconUrl = extractIcon(html, page.url);
    let iconDataUrl = "";
    if (iconUrl) {
      try {
        const icon = await fetchLimited(targetUrl(iconUrl), MAX_ICON, "image/avif,image/webp,image/png,image/jpeg,image/x-icon,image/svg+xml");
        const type = icon.contentType.split(";")[0].toLowerCase();
        const allowed = new Set(["image/png","image/jpeg","image/webp","image/avif","image/x-icon","image/vnd.microsoft.icon","image/svg+xml"]);
        if (allowed.has(type)) {
          let binary = "";
          for (let i = 0; i < icon.bytes.length; i += 0x8000) binary += String.fromCharCode(...icon.bytes.subarray(i, i + 0x8000));
          iconDataUrl = "data:" + type + ";base64," + btoa(binary);
        }
      } catch { iconDataUrl = ""; }
    }
    return json({ ok: true, name, iconUrl, iconDataUrl, finalUrl: page.url.toString() });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "metadata_failed";
    return json({ error: reason }, reason === "invalid_target" || reason === "invalid_redirect" ? 400 : 422);
  }
});