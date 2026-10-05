(() => {
  const CONSENT_KEY = "web2apk_cookie_consent_v1";
  const isDashboard = window.location.pathname.includes("/dashboard/");
  const base = isDashboard ? "../" : "";

  const footer = document.createElement("footer");
  footer.className = "site-footer";
  footer.innerHTML = `
    <div class="footer-inner">
      <div>
        <strong>Web2APK</strong>
        <span class="muted">إنشاء تطبيقات Android من مواقع الويب</span>
      </div>
      <nav aria-label="روابط قانونية">
        <a href="${base}privacy.html">الخصوصية</a>
        <a href="${base}terms.html">الشروط</a>
        <a href="${base}cookies.html">ملفات الارتباط</a>
      </nav>
    </div>
    <small>© ${new Date().getFullYear()} Web2APK</small>
  `;
  document.body.appendChild(footer);

  if (localStorage.getItem(CONSENT_KEY)) return;

  const banner = document.createElement("aside");
  banner.className = "consent-banner";
  banner.setAttribute("role", "dialog");
  banner.setAttribute("aria-label", "إعدادات الخصوصية");
  banner.innerHTML = `
    <div>
      <strong>الخصوصية وملفات الارتباط</strong>
      <p>يستخدم Web2APK تقنيات تخزين ضرورية لتشغيل الجلسة وحفظ تفضيل الخصوصية. لا نستخدم حالياً إعلانات أو أدوات تتبع غير ضرورية.</p>
      <a href="${base}cookies.html">اعرف المزيد</a>
    </div>
    <div class="consent-actions">
      <button type="button" data-consent="accept" class="btn primary">موافق</button>
      <button type="button" data-consent="reject" class="btn">رفض غير الضرورية</button>
    </div>
  `;
  document.body.appendChild(banner);

  const save = (value) => {
    localStorage.setItem(CONSENT_KEY, value);
    banner.remove();
  };
  banner.querySelector("[data-consent=accept]").addEventListener("click", () => save("accepted"));
  banner.querySelector("[data-consent=reject]").addEventListener("click", () => save("rejected"));
})();