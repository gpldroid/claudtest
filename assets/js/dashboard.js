import { client, SUPABASE_URL, SUPABASE_KEY } from "./config.js";

const msg = document.querySelector("#dashboardMessage");
const list = document.querySelector("#projectsList");

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));

const githubToken = async () => {
  const { data: { session } } = await client.auth.getSession();
  return session?.provider_token || "";
};

async function syncBuild(buildId, projectId, repo) {
  const token = await githubToken();
  if (!token || !repo) return null;
  const { data, error } = await client.functions.invoke("github-actions", {
    body: { action: "sync_build", buildId, projectId, repo, githubToken: token }
  });
  return error || !data?.ok ? null : data.build;
}

async function listArtifacts(buildId, repo, target) {
  const token = await githubToken();
  if (!token) {
    target.textContent = "يجب تسجيل الدخول عبر GitHub لتنزيل ملفات البناء.";
    return;
  }

  target.textContent = "جارٍ التحقق من ملفات البناء…";
  const { data, error } = await client.functions.invoke("github-actions", {
    body: { action: "list_artifacts", buildId, repo, githubToken: token }
  });

  if (error || !data?.ok) {
    target.textContent = data?.error === "artifact_expired_or_missing"
      ? "ملفات البناء منتهية أو لم تعد متاحة."
      : "تعذر الوصول إلى ملفات البناء.";
    return;
  }

  if (!data.artifacts?.length) {
    target.textContent = "لا توجد ملفات قابلة للتنزيل لهذا البناء.";
    return;
  }

  target.innerHTML = data.artifacts.map((artifact) =>
    '<button type="button" class="downloadArtifact" data-build="' + esc(buildId) +
    '" data-repo="' + esc(repo) + '" data-artifact="' + esc(artifact.id) + '">' +
    esc(artifact.name) + "</button>"
  ).join(" ");

  target.querySelectorAll(".downloadArtifact").forEach((button) => {
    button.addEventListener("click", () => downloadArtifact(
      button.dataset.build,
      button.dataset.repo,
      button.dataset.artifact,
      button
    ));
  });
}

async function downloadArtifact(buildId, repo, artifactId, button) {
  const token = await githubToken();
  if (!token) {
    button.textContent = "سجّل الدخول عبر GitHub";
    return;
  }

  button.disabled = true;
  const original = button.textContent;
  button.textContent = "جارٍ التنزيل…";

  try {
    const response = await fetch(SUPABASE_URL + "/functions/v1/github-actions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + (await client.auth.getSession()).data.session.access_token,
        apikey: SUPABASE_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "download_artifact",
        buildId,
        artifactId,
        repo,
        githubToken: token
      })
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || "download_failed");
    }

    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="([^"]+)"/);
    const filename = match?.[1] || ("web2apk-" + artifactId + ".zip");
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    button.textContent = "تعذر التنزيل";
    setTimeout(() => { button.textContent = original; }, 2500);
  } finally {
    button.disabled = false;
  }
}

async function startBuild(projectId, repo, buildType, button) {
  const token = await githubToken();
  if (!token) {
    button.textContent = "سجّل الدخول عبر GitHub";
    return;
  }
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "جارٍ البدء…";
  try {
    const { data, error } = await client.functions.invoke("github-actions", {
      body: { action: "start_build", projectId, repo, githubToken: token, buildType }
    });
    if (error || !data?.ok) throw new Error("build_failed");
    button.textContent = "بدأ البناء";
    setTimeout(() => { button.textContent = original; }, 2500);
    setTimeout(() => init(), 1200);
  } catch {
    button.textContent = "تعذر البدء";
    setTimeout(() => { button.textContent = original; }, 2500);
  } finally {
    button.disabled = false;
  }
}

async function init() {
  const { data: { user } } = await client.auth.getUser();
  if (!user) {
    if (msg) msg.textContent = "سجّل الدخول أولاً لعرض مشاريعك.";
    if (list) list.innerHTML = '<p>يرجى <a href="../login.html">تسجيل الدخول</a>.</p>';
    return;
  }

  if (msg) msg.textContent = "مرحباً " + (user.email || "بك");

  const { data, error } = await client
    .from("projects")
    .select("id,name,url,package,status,repo_full_name,created_at")
    .order("created_at", { ascending: false });

  if (error) {
    if (msg) msg.textContent = "تعذر تحميل المشاريع.";
    return;
  }

  const rows = data || [];
  const total = document.querySelector("#totalProjects");
  if (total) total.textContent = rows.length;
  const last = document.querySelector("#lastActivity");
  if (last) last.textContent = rows[0] ? new Date(rows[0].created_at).toLocaleDateString() : "—";

  if (!list) return;
  if (!rows.length) {
    list.innerHTML = '<p>لا توجد مشاريع بعد. <a href="../generator.html">أنشئ أول مشروع</a>.</p>';
    return;
  }

  const buildResults = await Promise.all(rows.map(async (project) => {
    const { data: builds } = await client
      .from("builds")
      .select("id,project_id,run_id,status,conclusion,created_at,version")
      .eq("project_id", project.id)
      .order("created_at", { ascending: false })
      .limit(5);
    const rows = builds || [];
    const synced = await Promise.all(rows.map((build) =>
      project.repo_full_name ? syncBuild(build.id, project.id, project.repo_full_name) : null
    ));
    synced.forEach((updated, index) => {
      if (updated) rows[index] = { ...rows[index], ...updated };
    });
    return [project.id, rows];
  }));
  const buildsByProject = new Map(buildResults);

  list.innerHTML = rows.map((p) => {
    const builds = buildsByProject.get(p.id) || [];
    const buildHtml = (p.repo_full_name
      ? '<div class="buildControls">' +
          '<button type="button" class="startBuild" data-project="' + esc(p.id) + '" data-repo="' + esc(p.repo_full_name) + '" data-type="debug">APK تجريبي</button>' +
          '<button type="button" class="startBuild" data-project="' + esc(p.id) + '" data-repo="' + esc(p.repo_full_name) + '" data-type="release">APK/AAB إصدار</button>' +
        "</div>"
      : "") +
      (builds.length
      ? '<div class="builds">' + builds.map((build) =>
          '<div class="buildRow">' +
            '<span>Build ' + esc(build.version || build.id.slice(0, 8)) + " · " + esc(build.status) + "</span>" +
            (build.run_url ? '<a class="btn" target="_blank" rel="noopener noreferrer" href="' + esc(build.run_url) + '">GitHub Actions</a>' : "") +
            '<button type="button" class="artifactList" data-build="' + esc(build.id) +
              '" data-repo="' + esc(p.repo_full_name || p.repo || "") + '">ملفات البناء</button>' +
            '<div class="artifactResults" id="artifacts-' + esc(build.id) + '"></div>' +
          "</div>"
        ).join("") + "</div>"
      : "<p>لا توجد عمليات بناء مسجلة بعد.</p>");

    return '<article><h3>' + esc(p.name) + "</h3>" +
      "<p>" + esc(p.url) + " · " + esc(p.package) + "</p>" +
      "<small>" + esc(p.status) + "</small>" +
      buildHtml + "</article>";
  }).join("");

  list.querySelectorAll(".startBuild").forEach((button) => {
    button.addEventListener("click", () => startBuild(
      button.dataset.project,
      button.dataset.repo,
      button.dataset.type,
      button
    ));
  });

  list.querySelectorAll(".artifactList").forEach((button) => {
    button.addEventListener("click", () => {
      const target = document.querySelector("#artifacts-" + CSS.escape(button.dataset.build));
      listArtifacts(button.dataset.build, button.dataset.repo, target);
    });
  });
}

document.querySelector("#signOut")?.addEventListener("click", async () => {
  await client.auth.signOut();
  window.location.href = "../login.html";
});

init();
