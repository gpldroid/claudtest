(() => {
  const siteUrlInput = document.querySelector("#siteUrl");
  const appNameInput = document.querySelector("#appName");
  const packageInput = document.querySelector("#packageId");
  const packageButton = document.querySelector("#generatePackageId");
  const packageHint = document.querySelector("#packageIdHint");
  const previewFrame = document.querySelector("#webAppViewer");
  const previewEmpty = document.querySelector("#previewEmpty");
  const previewOpen = document.querySelector("#previewOpen");

  if (!siteUrlInput || !appNameInput || !packageInput) return;

  const valueOf = (element) => String(element?.value ?? "").trim();

  const validUrl = (value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password && !!url.hostname;
    } catch {
      return false;
    }
  };

  const segment = (value) => String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "")
    .replace(/^[^a-z]+/, "")
    .slice(0, 40);

  const hash = (value) => {
    let result = 2166136261;
    for (const char of String(value ?? "")) {
      result ^= char.codePointAt(0);
      result = Math.imul(result, 16777619);
    }
    return "h" + (result >>> 0).toString(36).padStart(6, "0").slice(0, 6);
  };

  const generatePackage = () => {
    try {
      const url = new URL(valueOf(siteUrlInput));
      if (!validUrl(url.toString())) return "";
      const host = url.hostname.toLowerCase().replace(/^www\./, "");
      const parts = host.split(".").filter(Boolean).map(segment).filter(Boolean);
      if (parts.length < 2) return "";
      const last = parts.at(-1);
      const second = parts.at(-2);
      const registrable = last.length === 2 && ["co","com","net","org","gov","ac"].includes(second) && parts.length >= 3
        ? parts.slice(-3)
        : parts.slice(-2);
      const app = valueOf(appNameInput)
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .split(/[^A-Za-z0-9_]+/)
        .map(segment)
        .filter(Boolean)
        .join("")
        .slice(0, 24);
      return [...registrable.reverse(), app || "app", hash(url.origin.toLowerCase() + "|" + valueOf(appNameInput).toLowerCase())]
        .slice(0, 5)
        .join(".")
        .slice(0, 150);
    } catch {
      return "";
    }
  };

  let manualPackage = false;

  const updatePackage = (force = false) => {
    if (manualPackage && !force) return;
    const generated = generatePackage();
    if (!generated) return;
    packageInput.value = generated;
    if (packageHint) packageHint.textContent = "تم توليده تلقائياً من رابط الموقع واسم التطبيق. يمكنك تعديله يدوياً.";
  };

  const updateViewer = () => {
    if (!previewFrame || !previewEmpty || !previewOpen) return;
    const value = valueOf(siteUrlInput);
    if (!validUrl(value)) {
      previewFrame.removeAttribute("src");
      previewEmpty.hidden = false;
      previewOpen.href = "#";
      previewOpen.setAttribute("aria-disabled", "true");
      return;
    }
    previewFrame.src = value;
    previewEmpty.hidden = true;
    previewOpen.href = value;
    previewOpen.target = "_blank";
    previewOpen.removeAttribute("aria-disabled");
  };

  packageInput.addEventListener("input", () => {
    manualPackage = true;
    if (packageHint) packageHint.textContent = "معرّف مخصص. اضغط «توليد تلقائياً» للعودة إلى الاقتراح الذكي.";
  });

  packageButton?.addEventListener("click", (event) => {
    event.preventDefault();
    manualPackage = false;
    updatePackage(true);
  });

  for (const eventName of ["input", "change", "blur"]) {
    siteUrlInput.addEventListener(eventName, () => {
      updatePackage();
      updateViewer();
    });
    appNameInput.addEventListener(eventName, updatePackage);
  }

  updatePackage();
  updateViewer();
})();
// progress marker
