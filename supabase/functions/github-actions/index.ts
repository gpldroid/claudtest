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
const validUuid = (value: unknown) => typeof value === "string" && /^[0-9a-fA-F-]{36}$/.test(value);
const validPath = (value: string) => value.length > 0 && value.length <= 240 && !value.startsWith("/") && !value.includes("\\") && !/[\x00-\x1f]/.test(value);
const base64Utf8 = (value: string) => {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

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

  let body: {
  action?: string; repo?: string; githubToken?: string; secrets?: Record<string, string>;
  workflow?: string; ref?: string; projectId?: string; buildId?: string;
  artifactId?: string | number; files?: Record<string, string | { base64: string }>;
  buildType?: "debug" | "release" | "both"; versionName?: string; versionCode?: number;
};
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  if (!body.githubToken || body.githubToken.length < 20 || body.githubToken.length > 500) {
    return json({ error: "invalid_github_token" }, 400);
  }


  const ghHeaders = {
    "Accept": "application/vnd.github+json",
    "Authorization": `Bearer ${body.githubToken}`,
    "X-GitHub-Api-Version": "2026-03-10",
    "Content-Type": "application/json",
    "User-Agent": "Web2APK",
  };

  if (body.action === "provision_project") {
    if (!validUuid(body.projectId)) return json({ error: "invalid_project_id" }, 400);
    const entries = Object.entries(body.files ?? {});
    if (!entries.length || entries.length > 100) return json({ error: "invalid_file_count" }, 400);
    let totalBytes = 0;
    for (const [path, value] of entries) {
      if (!validPath(path)) return json({ error: "invalid_file_path" }, 400);
      if (typeof value === "string") totalBytes += new TextEncoder().encode(value).byteLength;
      else if (value && typeof value.base64 === "string" && /^[A-Za-z0-9+/=]*$/.test(value.base64)) totalBytes += Math.floor(value.base64.length * 0.75);
      else return json({ error: "invalid_file_content" }, 400);
    }
    if (totalBytes > 2500000) return json({ error: "project_too_large" }, 413);
    const { data: project, error: projectError } = await supabase.from("projects").select("id,name,version_name,version_code,repo_full_name").eq("id", body.projectId).maybeSingle();
    if (projectError || !project) return json({ error: "project_not_found" }, 404);
    if (project.repo_full_name) return json({ error: "project_already_provisioned" }, 409);
    const identity = await fetch("https://api.github.com/user", { headers: ghHeaders });
    if (!identity.ok) return json({ error: "github_identity_failed" }, 403);
    const githubUser = await identity.json();
    if (!githubUser.login || typeof githubUser.login !== "string") return json({ error: "github_identity_failed" }, 403);
    const slug = project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 45) || "project";
    const repoName = "web2apk-" + slug + "-" + project.id.slice(0, 8);
    const createRepo = await fetch("https://api.github.com/user/repos", {
      method: "POST", headers: ghHeaders,
      body: JSON.stringify({ name: repoName, description: "Web2APK Android app: " + project.name, private: true, has_issues: false, has_projects: false, has_wiki: false, auto_init: false }),
    });
    if (!createRepo.ok) return json({ error: createRepo.status === 422 ? "github_repo_create_failed_name_conflict" : "github_repo_create_failed" }, createRepo.status === 422 ? 409 : createRepo.status);
    const repoData = await createRepo.json();
    const fullName = repoData.full_name;
    if (!validRepo(fullName)) return json({ error: "github_repo_create_failed" }, 502);
    const [owner, repo] = fullName.split("/");
    const orderedEntries = [...entries.filter(([path]) => path === "README.md"), ...entries.filter(([path]) => path !== "README.md")];
    for (const [path, value] of orderedEntries) {
      const encodedPath = path.split("/").map(encodeURIComponent).join("/");
      const content = typeof value === "string" ? base64Utf8(value) : value.base64;
      const response = await fetch("https://api.github.com/repos/" + owner + "/" + repo + "/contents/" + encodedPath, {
        method: "PUT", headers: ghHeaders,
        body: JSON.stringify({ message: "Web2APK: add " + path, content, branch: "main" }),
      });
      if (!response.ok) {
        await supabase.from("projects").update({ status: "failed" }).eq("id", project.id);
        return json({ error: "github_file_push_failed", path }, response.status);
      }
    }
    const projectUpdate = await supabase.from("projects").update({ repo: fullName, repo_full_name: fullName, status: "building" }).eq("id", project.id);
    if (projectUpdate.error) return json({ error: "project_update_failed" }, 500);
    const { data: build, error: buildError } = await supabase.from("builds").insert({ project_id: project.id, status: "queued", version: project.version_name + " (" + project.version_code + ")" }).select("id").single();
    if (buildError || !build) return json({ error: "build_create_failed" }, 500);
    const buildType = body.buildType || "both";
    const versionName = body.versionName || project.version_name;
    const versionCode = Number(body.versionCode || project.version_code);
    const dispatchResponse = await fetch("https://api.github.com/repos/" + owner + "/" + repo + "/actions/workflows/android-build.yml/dispatches?return_run_details=true", {
      method: "POST", headers: ghHeaders,
      body: JSON.stringify({ ref: "main", inputs: { build_type: buildType, version_name: versionName, version_code: String(versionCode) } }),
    });
    if (!dispatchResponse.ok) {
      await supabase.from("builds").update({ status: "failed", conclusion: "dispatch_failed", finished_at: new Date().toISOString() }).eq("id", build.id);
      await supabase.from("projects").update({ status: "failed" }).eq("id", project.id);
      return json({ error: "github_dispatch_failed" }, dispatchResponse.status);
    }
    const dispatch = await dispatchResponse.json();
    const buildUpdate = await supabase.from("builds").update({ run_id: dispatch.workflow_run_id, run_url: dispatch.html_url || dispatch.run_url || null }).eq("id", build.id);
    if (buildUpdate.error) return json({ error: "build_update_failed" }, 500);
    return json({ ok: true, action: "provision_project", projectId: project.id, repo: fullName, buildId: build.id, runId: dispatch.workflow_run_id, runUrl: dispatch.html_url || dispatch.run_url || null });
  }

  if (!body.repo || !validRepo(body.repo)) return json({ error: "invalid_repo" }, 400);
  const [owner, repo] = body.repo.split("/");
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


  if (body.action === "sync_build") {
    if (!validUuid(body.buildId) || !validUuid(body.projectId) || !body.repo || !validRepo(body.repo)) {
      return json({ error: "invalid_build_request" }, 400);
    }
    const { data: build, error: buildError } = await supabase.from("builds")
      .select("id,project_id,run_id,status,conclusion,created_at,version").eq("id", body.buildId).maybeSingle();
    if (buildError || !build) return json({ error: "build_not_found" }, 404);
    if (!build.run_id) return json({ error: "build_run_not_ready" }, 409);
    const { data: project, error: projectError } = await supabase.from("projects")
      .select("id,repo_full_name").eq("id", build.project_id).maybeSingle();
    if (projectError || !project || project.id !== body.projectId || project.repo_full_name !== body.repo) {
      return json({ error: "project_access_denied" }, 403);
    }
    const runResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/runs/${build.run_id}`, { headers: ghHeaders });
    if (!runResponse.ok) return json({ error: "github_run_failed" }, runResponse.status);
    const run = await runResponse.json();
    let artifactIds: number[] = [];
    if (run.status === "completed") {
      const artifactsResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/runs/${build.run_id}/artifacts?per_page=100`, { headers: ghHeaders });
      if (artifactsResponse.ok) {
        const payload = await artifactsResponse.json();
        artifactIds = Array.isArray(payload.artifacts) ? payload.artifacts.filter((a: any) => !a.expired).map((a: any) => Number(a.id)) : [];
      }
    }
    const status = run.status === "completed" ? (run.conclusion === "success" ? "success" : "failed")
      : run.status === "in_progress" ? "building" : "queued";
    const update = {
      status,
      conclusion: run.conclusion || null,
      run_url: run.html_url || run.url || null,
      artifact_ids: artifactIds,
      started_at: run.run_started_at || null,
      finished_at: run.completed_at || null,
    };
    const { error: updateError } = await supabase.from("builds").update(update).eq("id", build.id);
    if (updateError) return json({ error: "build_update_failed" }, 500);
    await supabase.from("projects").update({ status: status === "success" ? "ready" : status === "failed" ? "failed" : "building" }).eq("id", project.id);
    return json({ ok: true, action: "sync_build", build: { ...build, ...update } });
  }

  if (body.action === "list_artifacts" || body.action === "download_artifact") {
    if (!body.buildId || typeof body.buildId !== "string" || !/^[0-9a-fA-F-]{36}$/.test(body.buildId)) {
      return json({ error: "invalid_build_id" }, 400);
    }

    const { data: build, error: buildError } = await supabase
      .from("builds")
      .select("id,project_id,run_id,status,conclusion,artifact_ids")
      .eq("id", body.buildId)
      .maybeSingle();
    if (buildError || !build) return json({ error: "build_not_found" }, 404);
    if (!build.run_id) return json({ error: "build_run_not_ready" }, 409);

    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id,repo_full_name,repo")
      .eq("id", build.project_id)
      .maybeSingle();
    if (projectError || !project || !project.repo_full_name) {
      return json({ error: "project_not_found" }, 404);
    }
    if (project.repo_full_name !== body.repo) return json({ error: "repo_mismatch" }, 403);

    const artifactsResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/runs/${build.run_id}/artifacts?per_page=100`,
      { headers: ghHeaders },
    );
    if (!artifactsResponse.ok) {
      return json(
        { error: artifactsResponse.status === 404 ? "artifact_expired_or_missing" : "github_artifacts_failed" },
        artifactsResponse.status === 404 ? 410 : artifactsResponse.status,
      );
    }

    const artifactPayload = await artifactsResponse.json();
    const artifacts = Array.isArray(artifactPayload.artifacts)
      ? artifactPayload.artifacts.filter((artifact: any) => !artifact.expired)
      : [];

    if (body.action === "list_artifacts") {
      return json({
        ok: true,
        buildId: build.id,
        status: build.status,
        conclusion: build.conclusion,
        artifacts: artifacts.map((artifact: any) => ({
          id: artifact.id,
          name: artifact.name,
          sizeInBytes: artifact.size_in_bytes,
          expired: artifact.expired,
          createdAt: artifact.created_at,
          expiresAt: artifact.expires_at,
        })),
      });
    }

    if (!body.artifactId || !/^\d+$/.test(String(body.artifactId))) {
      return json({ error: "invalid_artifact_id" }, 400);
    }
    const artifactId = Number(body.artifactId);
    const artifact = artifacts.find((item: any) => item.id === artifactId);
    if (!artifact) return json({ error: "artifact_expired_or_missing" }, 410);

    const downloadResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/artifacts/${artifactId}/zip`,
      { headers: ghHeaders },
    );
    if (!downloadResponse.ok || !downloadResponse.body) {
      return json(
        { error: downloadResponse.status === 404 ? "artifact_expired_or_missing" : "github_artifact_download_failed" },
        downloadResponse.status === 404 ? 410 : downloadResponse.status,
      );
    }

    return new Response(downloadResponse.body, {
      status: 200,
      headers: {
        ...cors,
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="web2apk-${artifactId}.zip"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  if (body.action === "dispatch") {
    const workflow = body.workflow || "android-build.yml";
    const ref = body.ref || "main";
    if (!/^[A-Za-z0-9_.-]+\.yml$/.test(workflow)) return json({ error: "invalid_workflow" }, 400);
    if (!/^[A-Za-z0-9._\/-]{1,100}$/.test(ref)) return json({ error: "invalid_ref" }, 400);
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`,
      { method: "POST", headers: ghHeaders, body: JSON.stringify({ ref, return_run_details: true }) },
    );
    if (!response.ok) return json({ error: "github_dispatch_failed" }, response.status);
    const result = await response.json().catch(() => ({}));
    return json({ ok: true, action: "dispatch", runId: result.workflow_run_id || null, runUrl: result.html_url || result.run_url || null });
  }

  return json({ error: "unsupported_action" }, 400);
});
