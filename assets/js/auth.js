import { client } from "./config.js";

const message = document.querySelector("#authMessage");
const githubLogin = document.querySelector("#githubLogin");
const logout = document.querySelector("#logout");
const passwordForm = document.querySelector("#passwordLogin");

function nextUrl() {
  const requested = new URLSearchParams(location.search).get("next");
  if (!requested || !/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.html(?:\?[A-Za-z0-9_.=&%-]*)?$/.test(requested)) {
    return new URL("dashboard/", location.href).href;
  }
  return new URL(requested, location.href).href;
}

const goNext = () => {
  window.location.href = nextUrl();
};

passwordForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = document.querySelector("#email").value.trim();
  const password = document.querySelector("#password").value;
  message.textContent = "جارٍ تسجيل الدخول…";
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    message.textContent = "تعذر تسجيل الدخول. تحقق من البريد الإلكتروني وكلمة المرور.";
    return;
  }
  message.textContent = "تم تسجيل الدخول بنجاح.";
  goNext();
});

githubLogin?.addEventListener("click", async () => {
  message.textContent = "جارٍ تحويلك إلى GitHub…";
  const { error } = await client.auth.signInWithOAuth({
    provider: "github",
    options: {
      redirectTo: nextUrl(),
      scopes: "repo workflow"
    }
  });
  if (error) message.textContent = error.message;
});

logout?.addEventListener("click", async () => {
  await client.auth.signOut();
  message.textContent = "تم تسجيل الخروج.";
  logout.classList.add("hidden");
  githubLogin?.classList.remove("hidden");
  passwordForm?.classList.remove("hidden");
});

const { data: { session } } = await client.auth.getSession();
if (session) {
  message.textContent = "لديك جلسة دخول بالفعل.";
  githubLogin?.classList.add("hidden");
  logout?.classList.remove("hidden");
  passwordForm?.classList.add("hidden");
}
