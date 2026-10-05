import { client, SUPABASE_URL, SUPABASE_KEY, getGitHubProviderToken } from "./config.js";

const params = new URLSearchParams(location.search);
const buildId = params.get("build") || "";
const projectId = params.get("project") || "";
const statusEl = document.querySelector("#downloadStatus");
const timerEl = document.querySelector("#downloadTimer");
const progressEl = document.querySelector("#buildProgress");
const resultsEl = document.querySelector("#downloadResults");
const buttonsEl = document.querySelector("#downloadButtons");
const summaryEl = document.querySelector("#downloadSummary");
const actionsLink = document.querySelector("#actionsLink");
const errorEl = document.querySelector("#downloadError");
const errorText = document.querySelector("#downloadErrorText");
const errorActionsLink = document.querySelector("#errorActionsLink");
const githubReconnectLink = document.querySelector("#githubReconnectLink");

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[c]));

const githubToken = () => getGitHubProviderToken();

function setProgress(value) {
  if (progressEl) progressEl.style.width = Math.max(0, Math.min(100, value)) + "%";
}

function showError(text, runUrl = "", reconnect = false) {
  if (statusEl) statusEl.textContent = "توقف البناء أو حدث خطأ.";
  if (timerEl) timerEl.textContent = "";
  if (progressEl) progressEl.style.width = "0%";
  if (errorEl) errorEl.classList.remove("hidden");
  if (errorText) errorText.textContent = text;
  if (runUrl) {
    errorActionsLink.href = runUrl;
    errorActionsLink.classList.remove("hidden");
  } else {
    errorActionsLink.classList.add("hidden");
  }
  if (reconnect && githubReconnectLink) {
    const next = encodeURIComponent("download.html?build=" + buildId + "&project=" + projectId);
    githubReconnectLink.href = "login.html?next=" + next;
    githubReconnectLink.classList.remove("hidden");
  } else if (githubReconnectLink) {
    githubReconnectLink.classList.add("hidden");
  }
}

async function getBuildContext() {
  if (!buildId || !projectId) throw new Error("missing_build");
  const { data: build, error: buildError } = await client
    .from("builds")
    .select("id,project_id,status,conclusion,run_id,run_url,version,created_at")
    .eq("id", buildId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (buildError || !build) throw new Error("build_not_found");

  const { data: project, error: projectError } = await client
    .from("projects")
    .select("id,name,url,package,repo_full_name,status")
    .eq("id", projectId)
    .maybeSingle();
  if (projectError || !project || project.id !== build.project_id || !project.repo_full_name) {
    throw new Error("project_not_found");
  }
  return { build, project };
}

async function syncBuild(context) {
  const token = await githubToken();
  if (!token) throw new Error("github_session_required");
  const { data, error } = await client.functions.invoke("github-actions", {
    body: {
      action: "sync_build",
      buildId,
      projectId,
      repo: context.project.repo_full_name,
      githubToken: token
    }
  });
  if (error || !data?.ok) return context.build;
  return { ...context.build, ...data.build };
}

async function listArtifacts(repo) {
  const token = await githubToken();
  if (!token) throw new Error("github_session_required");
  const { data, error } = await client.functions.invoke("github-actions", {
    body: { action: "list_artifacts", buildId, repo, githubToken: token }
  });
  if (error || !data?.ok) throw new Error(data?.error || "artifact_list_failed");
  return data.artifacts || [];
}

async function downloadArtifact(artifact, kind, button, repo) {
  const token = await githubToken();
  const session = (await client.auth.getSession()).data.session;
  if (!token || !session) {
    button.textContent = "سجّل الدخول عبر GitHub";
    return;
  }
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "جارٍ التنزيل…";
  try {
    const response = await fetch(SUPABASE_URL + "/functions/v1/github-actions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + session.access_token,
        apikey: SUPABASE_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "download_artifact",
        buildId,
        artifactId: artifact.id,
        repo,
        githubToken: token
      })
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || "download_failed");
    }
    const archive = await response.blob();
    if (!window.JSZip) throw new Error("zip_decoder_unavailable");
    const zip = await window.JSZip.loadAsync(archive);
    const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir);
    let preferred;
    if (kind === "source") {
      preferred = names.find((name) => /web2apk-source\.zip$/i.test(name)) || names.find((name) => /\.zip$/i.test(name));
    } else {
      preferred = names.find((name) => new RegExp("\\." + kind + "$", "i").test(name));
    }
    if (!preferred) throw new Error("download_file_missing");
    const file = zip.files[preferred];
    const blob = await file.async("blob");
    const filename = preferred.split("/").pop();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (error) {
    button.textContent = error?.message === "artifact_expired_or_missing"
      ? "الملف منتهي"
      : "تعذر التنزيل";
    setTimeout(() => { button.textContent = original; }, 2500);
  } finally {
    button.disabled = false;
  }
}

function renderDownloads(artifacts, context) {
  const byName = new Map(artifacts.map((item) => [String(item.name).toLowerCase(), item]));
  const definitions = [
    ["web2apk-debug.apk", "apk", "APK تجريبي"],
    ["web2apk-release.apk", "apk", "APK إصدار"],
    ["web2apk-release.aab", "aab", "AAB للنشر"],
    ["web2apk-source.zip", "source", "Source Code"]
  ];
  const available = definitions.filter(([name]) => byName.has(name));
  if (!available.length) return false;

  buttonsEl.innerHTML = available.map(([name, kind, label]) =>
    '<button type="button" class="btn primary downloadButton" data-kind="' + esc(kind) + '">' + esc(label) + "</button>"
  ).join("");
  buttonsEl.querySelectorAll(".downloadButton").forEach((button, index) => {
    const artifact = byName.get(String(available[index][0]).toLowerCase());
    button.addEventListener("click", () => downloadArtifact(artifact, available[index][1], button, context.project.repo_full_name));
  });
  summaryEl.textContent = context.project.name + " · " + context.project.package + " · " + (context.build.version || "");
  actionsLink.href = context.build.run_url || "#";
  resultsEl.classList.remove("hidden");
  setProgress(100);
  return true;
}

let context;
let countdown = 8;
let timer = null;
let startedAt = Date.now();
let polling = null;

async function poll() {
  try {
    const updated = await syncBuild(context);
    context.build = updated;
    const status = updated.status;
    if (status === "failed" || status === "cancelled") {
      clearInterval(polling);
      showError(updated.conclusion || "تعذر بناء التطبيق.", updated.run_url);
      return;
    }
    if (status === "success") {
      setProgress(90);
      const artifacts = await listArtifacts(context.project.repo_full_name);
      if (renderDownloads(artifacts, context)) {
        clearInterval(polling);
        clearInterval(timer);
        if (statusEl) statusEl.textContent = "اكتمل البناء وأصبحت الملفات جاهزة للتنزيل.";
        if (timerEl) timerEl.textContent = "جاهز";
        return;
      }
      if (statusEl) statusEl.textContent = "اكتمل البناء، جارٍ تجهيز ملفات التنزيل…";
      return;
    }
    setProgress(status === "building" ? 55 : 20);
    if (statusEl) statusEl.textContent = status === "building"
      ? "جاري بناء APK/AAB على GitHub Actions… عادةً يستغرق ذلك بضع دقائق."
      : "البناء في قائمة الانتظار؛ سيتم التحقق تلقائياً كل 8 ثوانٍ…";
  } catch (error) {
    if (error?.message === "github_session_required") {
      clearInterval(polling);
      showError("انتهت جلسة GitHub أو لم تعد صلاحية GitHub متاحة في الذاكرة. أعد ربط GitHub ثم ستعود تلقائياً إلى صفحة التحميل.", "", true);
      return;
    }
    if (statusEl) statusEl.textContent = "جارٍ إعادة المحاولة…";
  }
}

async function init() {
  try {
    const { data: { user } } = await client.auth.getUser();
    if (!user) throw new Error("auth_required");
    context = await getBuildContext();
    if (actionsLink) actionsLink.href = context.build.run_url || "#";
    await poll();
    if (!resultsEl?.classList.contains("hidden") || !errorEl?.classList.contains("hidden")) return;

    startedAt = Date.now();
    const renderTimer = () => {
      const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      const minutes = String(Math.floor(elapsed / 60)).padStart(2, "0");
      const seconds = String(elapsed % 60).padStart(2, "0");
      if (timerEl) timerEl.textContent = "الوقت المنقضي: " + minutes + ":" + seconds + " · التحقق التالي خلال " + countdown + " ثوانٍ";
    };
    renderTimer();
    timer = setInterval(() => {
      countdown -= 1;
      if (countdown <= 0) countdown = 8;
      renderTimer();
    }, 1000);
    polling = setInterval(poll, 8000);
  } catch (error) {
    showError(error?.message === "auth_required"
      ? "سجّل الدخول أولاً."
      : "تعذر العثور على عملية البناء المطلوبة.");
  }
}

init();
