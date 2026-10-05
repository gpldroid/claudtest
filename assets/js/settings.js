import { client } from "../assets/js/config.js";

const message = document.querySelector("#settingsMessage");
const projectSelect = document.querySelector("#projectSelect");
const form = document.querySelector("#signingForm");

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[c]));

async function githubToken() {
  const { data: { session } } = await client.auth.getSession();
  return session?.provider_token || "";
}

async function loadProjects() {
  const { data: { user } } = await client.auth.getUser();
  if (!user) {
    message.textContent = "سجّل الدخول أولاً.";
    form?.classList.add("hidden");
    return;
  }
  const { data, error } = await client.from("projects")
    .select("id,name,repo_full_name,status")
    .order("created_at", { ascending: false });
  if (error) {
    message.textContent = "تعذر تحميل المشاريع.";
    return;
  }
  const projects = (data || []).filter((p) => p.repo_full_name);
  projectSelect.innerHTML = projects.length
    ? projects.map((p) => '<option value="' + esc(p.id) + '">' + esc(p.name) + " — " + esc(p.repo_full_name) + "</option>").join("")
    : '<option value="">لا يوجد مستودع GitHub مرتبط بعد</option>';
  if (!projects.length) form?.classList.add("hidden");
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const token = await githubToken();
  const projectId = projectSelect.value;
  const base64 = document.querySelector("#keystoreBase64").value.trim();
  const storePassword = document.querySelector("#storePassword").value;
  const alias = document.querySelector("#keyAlias").value.trim();
  const keyPassword = document.querySelector("#keyPassword").value;
  if (!token) {
    message.textContent = "أعد تسجيل الدخول عبر GitHub للحصول على صلاحية Actions.";
    return;
  }
  if (!projectId || !base64 || !storePassword || !alias || !keyPassword) {
    message.textContent = "أكمل جميع بيانات توقيع الإصدار.";
    return;
  }
  if (!/^[A-Za-z0-9+/=\s]+$/.test(base64) || base64.replace(/\s/g, "").length < 100) {
    message.textContent = "قيمة keystore Base64 غير صالحة.";
    return;
  }
  const { data: project, error: projectError } = await client.from("projects")
    .select("repo_full_name").eq("id", projectId).single();
  const repo = project?.repo_full_name || "";
  if (projectError || !repo) {
    message.textContent = "تعذر التحقق من مستودع المشروع.";
    return;
  }
  message.textContent = "جارٍ تشفير الأسرار وإرسالها مباشرة إلى GitHub Actions…";
  const { data, error } = await client.functions.invoke("github-actions", {
    body: {
      action: "set_secrets",
      repo,
      githubToken: token,
      secrets: {
        ANDROID_KEYSTORE_BASE64: base64.replace(/\s/g, ""),
        ANDROID_KEYSTORE_PASSWORD: storePassword,
        ANDROID_KEY_ALIAS: alias,
        ANDROID_KEY_PASSWORD: keyPassword
      }
    }
  });
  document.querySelector("#keystoreBase64").value = "";
  document.querySelector("#storePassword").value = "";
  document.querySelector("#keyAlias").value = "";
  document.querySelector("#keyPassword").value = "";
  if (error || !data?.ok) {
    message.textContent = "تعذر حفظ أسرار التوقيع في GitHub.";
    return;
  }
  message.textContent = "تم حفظ أسرار التوقيع في GitHub Actions. لم يتم تخزينها في Web2APK.";
});

document.querySelector("#signOut")?.addEventListener("click", async () => {
  await client.auth.signOut();
  window.location.href = "../login.html";
});

loadProjects();
