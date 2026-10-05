import { client } from "./config.js";

const form = document.querySelector("#generatorForm");
const message = document.querySelector("#generatorMessage");

const get = (id) => document.getElementById(id)?.value.trim() ?? "";

const escapeXml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const escapeKotlin = (value) =>
  String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\\"')
    .replace(/\$/g, () => "\\$");

const validPackage = (value) =>
  /^(?:[a-zA-Z][a-zA-Z0-9_]*)(?:\.[a-zA-Z][a-zA-Z0-9_]*){1,30}$/.test(value) &&
  value.length <= 150;

function packageSegment(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "")
    .replace(/^[^a-z]+/, "")
    .slice(0, 40);
}

function packageHash(value) {
  let hash = 2166136261;
  for (const char of String(value ?? "")) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, "0").slice(0, 7);
}

function registrableDomainParts(hostname) {
  const parts = hostname.split(".").filter(Boolean).map(packageSegment).filter(Boolean);
  if (parts.length < 2) return [];
  const last = parts[parts.length - 1];
  const secondLast = parts[parts.length - 2];
  const commonSecondLevel = new Set(["co", "com", "net", "org", "gov", "ac"]);
  if (last.length === 2 && commonSecondLevel.has(secondLast) && parts.length >= 3) {
    return parts.slice(-3);
  }
  return parts.slice(-2);
}

function generatePackageId(urlValue, appName) {
  try {
    const parsed = new URL(urlValue);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const domainParts = registrableDomainParts(hostname);
    const appParts = String(appName ?? "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/[^A-Za-z0-9_]+/)
      .map(packageSegment)
      .filter(Boolean);
    if (domainParts.length < 2) return "";

    const domain = domainParts.reverse();
    const suffix = appParts.join("").slice(0, 24);
    const stableHash = packageHash(`${parsed.origin.toLowerCase()}|${String(appName ?? "").trim().toLowerCase()}`);
    return [...domain, suffix || "app", stableHash]
      .filter(Boolean)
      .slice(0, 5)
      .join(".")
      .slice(0, 150);
  } catch {
    return "";
  }
}

const validUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !!url.hostname;
  } catch {
    return false;
  }
};

const siteUrlInput = document.querySelector("#siteUrl");
const appNameInput = document.querySelector("#appName");
const appIconInput = document.querySelector("#appIcon");
const metadataStatus = document.querySelector("#siteMetadataStatus");
const appIconPreview = document.querySelector("#appIconPreview");
let detectedIconDataUrl = "";
let appNameManuallyEdited = false;
let metadataTimer = null;
let metadataRequestId = 0;
let previewUrl = "";

const packageInput = document.querySelector("#packageId");
const packageAutoButton = document.querySelector("#generatePackageId");
const packageHint = document.querySelector("#packageIdHint");
let packageManuallyEdited = false;

function updateGeneratedPackageId(force = false) {
  if (!packageInput || (!force && packageManuallyEdited)) return;
  const generated = generatePackageId(get("siteUrl"), get("appName"));
  if (!generated || !validPackage(generated)) return;
  packageInput.value = generated;
  if (packageHint) packageHint.textContent = "تم توليده تلقائياً من رابط الموقع واسم التطبيق. يمكنك تعديله يدوياً.";
}

packageInput?.addEventListener("input", () => {
  packageManuallyEdited = true;
  if (packageHint) packageHint.textContent = "معرّف مخصص. اضغط «توليد تلقائياً» للعودة إلى الاقتراح الذكي.";
});
siteUrlInput?.addEventListener("input", () => {
  updateGeneratedPackageId();
  updateWebAppViewer();
  clearTimeout(metadataTimer);
  if (validUrl(get("siteUrl"))) metadataTimer = setTimeout(analyzeSite, 700);
});
document.querySelector("#siteUrl")?.addEventListener("change", () => updateGeneratedPackageId());
document.querySelector("#siteUrl")?.addEventListener("blur", () => updateGeneratedPackageId());
appNameInput?.addEventListener("input", () => {
  appNameManuallyEdited = true;
  updateGeneratedPackageId();
});
appNameInput?.addEventListener("change", () => updateGeneratedPackageId());
appNameInput?.addEventListener("blur", () => updateGeneratedPackageId());
siteUrlInput?.addEventListener("change", analyzeSite);
siteUrlInput?.addEventListener("blur", () => {
  if (validUrl(get("siteUrl"))) analyzeSite();
});
packageAutoButton?.addEventListener("click", (event) => {
  event.preventDefault();
  packageManuallyEdited = false;
  updateGeneratedPackageId(true);
});

updateGeneratedPackageId();

async function analyzeSite() {
  const url = get("siteUrl");
  const requestId = ++metadataRequestId;
  if (!validUrl(url)) return;
  if (metadataStatus) metadataStatus.textContent = "جارٍ تحليل الموقع واكتشاف الاسم والأيقونة…";
  try {
    const { data, error } = await client.functions.invoke("site-metadata", { body: { url } });
    if (error || !data?.ok) throw new Error(data?.error || "metadata_failed");
    if (requestId !== metadataRequestId || get("siteUrl") !== url) return;
    if (!appNameManuallyEdited && data.name) appNameInput.value = data.name.slice(0, 50);
    detectedIconDataUrl = typeof data.iconDataUrl === "string" ? data.iconDataUrl : "";
    if (appIconPreview) {
      appIconPreview.hidden = !detectedIconDataUrl;
      if (detectedIconDataUrl) appIconPreview.src = detectedIconDataUrl;
    }
    if (appIconInput) {
      appIconInput.value = data.iconUrl || "🌐";
      appIconInput.title = data.iconUrl ? "تم اكتشاف أيقونة الموقع تلقائياً." : "";
    }
    updateGeneratedPackageId();
    updateWebAppViewer(url);
    if (metadataStatus) metadataStatus.textContent = data.iconUrl
      ? "تم اكتشاف اسم الموقع والأيقونة ومعرّف الحزمة تلقائياً."
      : "تم اكتشاف اسم الموقع ومعرّف الحزمة. لم تُكتشف أيقونة.";
  } catch {
    if (metadataStatus) metadataStatus.textContent = "تعذر تحليل الموقع تلقائياً؛ يمكنك إكمال البيانات يدوياً.";
    updateGeneratedPackageId();
  }
}

const previewFrame = document.querySelector("#webAppViewer");
const previewEmpty = document.querySelector("#previewEmpty");
const previewOpen = document.querySelector("#previewOpen");

function updateWebAppViewer(forcedUrl = "") {
  const value = forcedUrl || get("siteUrl");
  previewUrl = value;
  if (!previewFrame || !previewEmpty || !previewOpen) return;
  if (!validUrl(value)) {
    previewFrame.removeAttribute("src");
    previewEmpty.hidden = false;
    previewOpen.href = "#";
    previewOpen.setAttribute("aria-disabled", "true");
    return;
  }
  previewFrame.src = value;
  previewEmpty.hidden = true;
  previewOpen.href = previewUrl;
  previewOpen.target = "_blank";
  previewOpen.removeAttribute("aria-disabled");
}

document.querySelector("#siteUrl")?.addEventListener("input", () => updateWebAppViewer(get("siteUrl")));
document.querySelector("#siteUrl")?.addEventListener("change", () => updateWebAppViewer(get("siteUrl")));
document.querySelector("#siteUrl")?.addEventListener("blur", () => updateWebAppViewer(get("siteUrl")));
updateWebAppViewer();

const safePermissionNames = new Set([
  "CAMERA",
  "ACCESS_FINE_LOCATION",
  "RECORD_AUDIO"
]);

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16)
  };
}

async function canvasPng(size, text, background, foreground) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);

  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, size, size);
  }

  ctx.fillStyle = foreground;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${Math.round(size * 0.42)}px sans-serif`;
  ctx.fillText(text, size / 2, size / 2 + size * 0.02);

  const dataUrl = canvas.toDataURL("image/png");
  return dataUrl.split(",")[1];
}

async function canvasPngFromDataUrl(size, dataUrl, background) {
  const image = new Image();
  image.decoding = "async";
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = reject;
    image.src = dataUrl;
  });
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, size, size);
  }
  const padding = Math.round(size * 0.08);
  const scale = Math.min((size - padding * 2) / image.naturalWidth, (size - padding * 2) / image.naturalHeight);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  ctx.drawImage(image, Math.round((size - width) / 2), Math.round((size - height) / 2), width, height);
  return canvas.toDataURL("image/png").split(",")[1];
}

function iconLetter(iconValue, appName) {
  const trimmed = iconValue.trim();
  if (trimmed) return Array.from(trimmed)[0];
  return Array.from(appName.trim())[0] || "W";
}

function buildFiles(config, iconPngs) {
  const packagePath = config.package.replace(/\./g, "/");
  const permissions = [
    "INTERNET",
    ...config.permissions.filter((p) => safePermissionNames.has(p))
  ]
    .filter((p, i, arr) => arr.indexOf(p) === i)
    .map((p) => `    <uses-permission android:name="android.permission.${p}" />`)
    .join("\n");

  const label = escapeXml(config.name);
  const url = escapeKotlin(config.url);
  const splashText = escapeXml(config.splash || config.name);
  const color = config.primary.toLowerCase();

  return {
    "settings.gradle.kts": `import org.gradle.api.initialization.resolve.RepositoriesMode\n\npluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "${escapeKotlin(config.name)}"
include(":app")
`,
    "build.gradle.kts": `plugins {
    id("com.android.application") version "9.4.0" apply false
    id("org.jetbrains.kotlin.android") version "2.4.20" apply false
}
`,
    "gradle.properties": `org.gradle.jvmargs=-Xmx2g -Dfile.encoding=UTF-8
android.useAndroidX=true
android.nonTransitiveRClass=true
kotlin.code.style=official
`,
    "app/build.gradle.kts": `plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val injectedVersionName = providers.gradleProperty("web2apkVersionName").orElse("${escapeKotlin(config.versionName)}")
val injectedVersionCode = providers.gradleProperty("web2apkVersionCode").map(String::toInt).orElse(${config.versionCode})

android {
    namespace = "${escapeKotlin(config.package)}"
    compileSdk = 36

    buildFeatures {
        buildConfig = true
    }

    defaultConfig {
        applicationId = "${escapeKotlin(config.package)}"
        minSdk = 23
        targetSdk = 36
        versionCode = injectedVersionCode.get()
        versionName = injectedVersionName.get()
        buildConfigField("boolean", "WEB2APK_DEV_TOOLS", "${config.devTools}")
    }

    signingConfigs {
        create("release") {
            val keystorePath = System.getenv("ANDROID_KEYSTORE_PATH")
            if (!keystorePath.isNullOrBlank()) {
                storeFile = file(keystorePath)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            if (!System.getenv("ANDROID_KEYSTORE_PATH").isNullOrBlank()) {
                signingConfig = signingConfigs.getByName("release")
            }
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }
}

dependencies {
}
`,
    "app/proguard-rules.pro": `# WebView uses Android framework APIs and does not require blanket keep rules.
# Keep this file project-specific: add rules only for libraries introduced by your app.
`,
    "app/src/main/AndroidManifest.xml": `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
${permissions}

    <application
        android:allowBackup="false"
        android:icon="@mipmap/ic_launcher"
        android:roundIcon="@mipmap/ic_launcher"
        android:label="${label}"
        android:supportsRtl="true"
        android:theme="@style/Theme.Web2Apk"
        android:usesCleartextTraffic="false"
        android:networkSecurityConfig="@xml/network_security_config">
        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:enableOnBackInvokedCallback="true"
            android:screenOrientation="unspecified">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
`,
    "app/src/main/java/${packagePath}/MainActivity.kt": `package ${config.package}

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.util.Log
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.ConsoleMessage
import android.webkit.DownloadListener
import android.webkit.SslErrorHandler
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceError
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.ValueCallback
import android.widget.Toast
import android.widget.FrameLayout
import android.widget.TextView
import android.view.Gravity
import android.os.Handler
import android.os.Looper

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private val startUrl = "${url}"
    private val allowedHost = Uri.parse(startUrl).host?.lowercase()\n    private val splashText = "${escapeKotlin(config.splash || config.name)}"

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT

        val debugToolsEnabled = BuildConfig.WEB2APK_DEV_TOOLS &&
            (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0
        if (debugToolsEnabled) WebView.setWebContentsDebuggingEnabled(true)

        webView = WebView(this)
        webView.setBackgroundColor(Color.WHITE)

        val root = FrameLayout(this)
        root.setBackgroundColor(Color.WHITE)
        root.addView(webView, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ))

        val splash = TextView(this)
        splash.text = splashText
        splash.setTextColor(Color.WHITE)
        splash.textSize = 28f
        splash.gravity = Gravity.CENTER
        splash.setBackgroundColor(Color.parseColor("${color}"))
        root.addView(splash, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ))
        setContentView(root)
        webView.setOnApplyWindowInsetsListener { view, insets ->
            view.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            insets
        }

        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = false
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.javaScriptCanOpenWindowsAutomatically = false
        settings.setSupportMultipleWindows(false)
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.builtInZoomControls = false
        settings.displayZoomControls = false
        settings.mediaPlaybackRequiresUserGesture = true
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            settings.safeBrowsingEnabled = true
        }
        settings.userAgentString = settings.userAgentString + " Web2APK/${config.versionName}"

        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false)

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                if (uri.scheme == "https" && uri.host?.lowercase() == allowedHost) {
                    return false
                }
                return openExternal(uri)
            }

            override fun onReceivedSslError(
                view: WebView,
                handler: SslErrorHandler,
                error: android.net.http.SslError
            ) {
                handler.cancel()
                Toast.makeText(this@MainActivity, "Secure connection failed.", Toast.LENGTH_SHORT).show()
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError
            ) {
                if (request.isForMainFrame) {
                    Toast.makeText(this@MainActivity, "Unable to load the website.", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onRenderProcessGone(
                view: WebView,
                detail: android.webkit.RenderProcessGoneDetail
            ): Boolean {
                view.destroy()
                recreate()
                return true
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                Log.d("WebViewConsole", "${message.message()} -- ${message.messageLevel()} -- line ${message.lineNumber()} -- ${message.sourceId()}")
                return true
            }

            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams
            ): Boolean {
                filePathCallback?.onReceiveValue(null)
                filePathCallback = callback
                return try {
                    startActivityForResult(params.createIntent(), FILE_CHOOSER_REQUEST)
                    true
                } catch (_: Exception) {
                    filePathCallback = null
                    false
                }
            }
        }

        webView.setDownloadListener(DownloadListener { url, _, _, _, _ ->
            openExternal(Uri.parse(url))
        })

        if (android.os.Build.VERSION.SDK_INT >= 33) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT
            ) {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        }

        if (savedInstanceState == null) {
            webView.loadUrl(startUrl)
        } else {
            webView.restoreState(savedInstanceState)
        }
        Handler(Looper.getMainLooper()).postDelayed({
            splash.animate().alpha(0f).setDuration(180L).withEndAction {
                root.removeView(splash)
            }.start()
        }, 420L)
    }

    private fun openExternal(uri: Uri): Boolean {
        return try {
            val intent = Intent(Intent.ACTION_VIEW, uri)
            startActivity(intent)
            true
        } catch (_: Exception) {
            false
        }
    }

    @Deprecated("Use Activity Result APIs when modernizing this generated template.")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != FILE_CHOOSER_REQUEST) return
        val results = if (resultCode == Activity.RESULT_OK) {
            WebChromeClient.FileChooserParams.parseResult(resultCode, data)
        } else null
        filePathCallback?.onReceiveValue(results)
        filePathCallback = null
    }

    override fun onSaveInstanceState(outState: Bundle) {
        webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            if (webView.canGoBack()) webView.goBack() else finish()
        } else {
            if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
        }
    }

    override fun onDestroy() {
        webView.stopLoading()
        webView.webChromeClient = null
        webView.webViewClient = null
        webView.destroy()
        super.onDestroy()
    }

    companion object {
        private const val FILE_CHOOSER_REQUEST = 1001
    }
}
`,
    "app/src/main/res/values/colors.xml": `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="primary">${color}</color>
    <color name="splash_background">${color}</color>
</resources>
`,
    "app/src/main/res/values/strings.xml": `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">${label}</string>
</resources>
`,
    "app/src/main/res/values/styles.xml": `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="Theme.Web2Apk" parent="android:style/Theme.Material.Light.NoActionBar">
        <item name="android:fontFamily">sans</item>
        <item name="android:statusBarColor">@android:color/transparent</item>
        <item name="android:navigationBarColor">@android:color/transparent</item>
        <item name="android:windowLightStatusBar">false</item>
        <item name="android:windowBackground">@color/splash_background</item>
    </style>
</resources>
`,
    "app/src/main/res/values-v31/styles.xml": `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="Theme.Web2Apk" parent="android:style/Theme.Material.Light.NoActionBar">
        <item name="android:fontFamily">sans</item>
        <item name="android:statusBarColor">@android:color/transparent</item>
        <item name="android:navigationBarColor">@android:color/transparent</item>
        <item name="android:windowLightStatusBar">false</item>
        <item name="android:windowBackground">@color/splash_background</item>
        <item name="android:windowSplashScreenBackground">@color/splash_background</item>
        <item name="android:windowSplashScreenAnimatedIcon">@mipmap/ic_launcher</item>
        <item name="android:windowSplashScreenAnimationDuration">300</item>
    </style>
</resources>
`,
    "app/src/main/res/xml/network_security_config.xml": `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false" />
</network-security-config>
`,


    "app/src/main/res/drawable/ic_launcher_foreground.png": { base64: iconPngs.foreground },
    "app/src/main/res/mipmap-mdpi/ic_launcher.png": { base64: iconPngs.mdpi },
    "app/src/main/res/mipmap-hdpi/ic_launcher.png": { base64: iconPngs.hdpi },
    "app/src/main/res/mipmap-xhdpi/ic_launcher.png": { base64: iconPngs.xhdpi },
    "app/src/main/res/mipmap-xxhdpi/ic_launcher.png": { base64: iconPngs.xxhdpi },
    "app/src/main/res/mipmap-xxxhdpi/ic_launcher.png": { base64: iconPngs.xxxhdpi },
    "app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml": `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/primary" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
</adaptive-icon>
`,
    "README.md": `# ${config.name}

Generated by Web2APK.

- Website: ${config.url}
- Package: ${config.package}
- Version: ${config.versionName} (${config.versionCode})
- Android target: API 36
- Build stack: AGP 9.4.0, Gradle 9.6.0, Kotlin 2.4.20, JDK 17
- Release builds use R8 minification and resource shrinking.

## Build

This generated project is designed for the Web2APK GitHub Actions pipeline. It can also be opened in Android Studio with a compatible Gradle 9.6 / JDK 17 environment.

## Security

The WebView only accepts HTTPS for the configured site host, blocks cleartext traffic and mixed content, rejects SSL certificate errors, disables file/content URL access, disables third-party cookies, and sends non-site links to the external browser.

## Permissions

Only permissions selected in Web2APK are included, plus INTERNET for the configured website.
`,
    ".gitignore": `*.iml
.gradle/
local.properties
.idea/
.DS_Store
build/
captures/
.externalNativeBuild/
.cxx/
*.apk
*.aab
`,
    ".github/workflows/android-build.yml": `name: Build Android

on:
  workflow_dispatch:
    inputs:
      build_type:
        description: "Build type"
        required: true
        default: "both"
        type: choice
        options: ["debug", "release", "both"]
      version_name:
        description: "Optional version name override"
        required: false
        type: string
      version_code:
        description: "Optional version code override"
        required: false
        type: string

permissions:
  contents: read
  actions: read

concurrency:
  group: android-build-${{ github.ref }}
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 25
    env:
      BUILD_TYPE: ${{ inputs.build_type }}
      VERSION_NAME: ${{ inputs.version_name }}
      VERSION_CODE: ${{ inputs.version_code }}
    steps:
      - uses: actions/checkout@v4
      - name: Set up JDK 17
        uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: "17"
          cache: gradle
      - name: Set up Gradle 9.6
        uses: gradle/actions/setup-gradle@v4
        with:
          gradle-version: "9.6"
      - name: Normalize inputs
        shell: bash
        run: |
          set -euo pipefail
          if [[ -z "${BUILD_TYPE:-}" ]]; then echo "BUILD_TYPE=both" >> "$GITHUB_ENV"; fi
          if [[ -n "${VERSION_NAME:-}" && ! "$VERSION_NAME" =~ ^[0-9]+\.[0-9]+\.[0-9]+([+-][0-9A-Za-z.-]+)?$ ]]; then echo "Invalid version name" >&2; exit 1; fi
          if [[ -n "${VERSION_CODE:-}" && ! "$VERSION_CODE" =~ ^[1-9][0-9]{0,9}$ ]]; then echo "Invalid version code" >&2; exit 1; fi
      - name: Prepare release signing
        if: env.BUILD_TYPE != "debug"
        env:
          KEYSTORE_B64: ${{ secrets.ANDROID_KEYSTORE_BASE64 }}
          KEYSTORE_PASSWORD: ${{ secrets.ANDROID_KEYSTORE_PASSWORD }}
          KEY_ALIAS: ${{ secrets.ANDROID_KEY_ALIAS }}
          KEY_PASSWORD: ${{ secrets.ANDROID_KEY_PASSWORD }}
        shell: bash
        run: |
          set -euo pipefail
          if [[ -z "$KEYSTORE_B64" || -z "$KEYSTORE_PASSWORD" || -z "$KEY_ALIAS" || -z "$KEY_PASSWORD" ]]; then echo "Release signing secrets are required for release builds." >&2; exit 1; fi
          printf "%s" "$KEYSTORE_B64" | base64 --decode > "${{ runner.temp }}/web2apk-release.jks"
          chmod 600 "${{ runner.temp }}/web2apk-release.jks"
          echo "ANDROID_KEYSTORE_PATH=${{ runner.temp }}/web2apk-release.jks" >> "$GITHUB_ENV"
          echo "ANDROID_KEYSTORE_PASSWORD=$KEYSTORE_PASSWORD" >> "$GITHUB_ENV"
          echo "ANDROID_KEY_ALIAS=$KEY_ALIAS" >> "$GITHUB_ENV"
          echo "ANDROID_KEY_PASSWORD=$KEY_PASSWORD" >> "$GITHUB_ENV"
      - name: Build
        shell: bash
        run: |
          set -euo pipefail
          args=()
          [[ -n "${VERSION_NAME:-}" ]] && args+=("-Pweb2apkVersionName=$VERSION_NAME")
          [[ -n "${VERSION_CODE:-}" ]] && args+=("-Pweb2apkVersionCode=$VERSION_CODE")
          case "${BUILD_TYPE:-both}" in
            debug) gradle assembleDebug "${args[@]}" ;;
            release) gradle assembleRelease bundleRelease "${args[@]}" ;;
            both) gradle assembleDebug assembleRelease bundleRelease "${args[@]}" ;;
            *) echo "Unsupported build type" >&2; exit 1 ;;
          esac
      - name: Collect artifacts
        shell: bash
        run: |
          set -euo pipefail
          mkdir -p dist
          if [[ "${BUILD_TYPE:-both}" == "debug" || "${BUILD_TYPE:-both}" == "both" ]]; then
            debug_apk=$(find app/build/outputs/apk/debug -type f -name "*.apk" -print -quit)
            test -n "$debug_apk"
            cp "$debug_apk" dist/web2apk-debug.apk
          fi
          if [[ "${BUILD_TYPE:-both}" == "release" || "${BUILD_TYPE:-both}" == "both" ]]; then
            release_apk=$(find app/build/outputs/apk/release -type f -name "*.apk" -print -quit)
            release_aab=$(find app/build/outputs/bundle/release -type f -name "*.aab" -print -quit)
            test -n "$release_apk"
            test -n "$release_aab"
            cp "$release_apk" dist/web2apk-release.apk
            cp "$release_aab" dist/web2apk-release.aab
          fi
          test -n "$(find dist -type f -print -quit)"
          for file in dist/*; do sha256sum "$file" | tee "$file.sha256"; done
      - name: Upload debug APK
        if: env.BUILD_TYPE == 'debug' || env.BUILD_TYPE == 'both'
        uses: actions/upload-artifact@v7
        with:
          path: dist/web2apk-debug.apk
          archive: false
          retention-days: 14

      - name: Upload release APK
        if: env.BUILD_TYPE == 'release' || env.BUILD_TYPE == 'both'
        uses: actions/upload-artifact@v7
        with:
          path: dist/web2apk-release.apk
          archive: false
          retention-days: 14

      - name: Create source archive
        shell: bash
        run: |
          set -euo pipefail
          rm -f dist/web2apk-source.zip
          zip -qr dist/web2apk-source.zip . -x ".git/*" "app/build/*" "build/*" ".gradle/*" "dist/*"
          test -s dist/web2apk-source.zip

      - name: Upload source code
        uses: actions/upload-artifact@v7
        with:
          path: dist/web2apk-source.zip
          archive: false
          retention-days: 14

      - name: Upload release AAB
        if: env.BUILD_TYPE == 'release' || env.BUILD_TYPE == 'both'
        uses: actions/upload-artifact@v7
        with:
          path: dist/web2apk-release.aab
          archive: false
          retention-days: 14
`,
    "gradle/wrapper/gradle-wrapper.properties": `distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\\://services.gradle.org/distributions/gradle-9.6.0-bin.zip
networkTimeout=10000
validateDistributionUrl=true
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
`
  };
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();

  updateGeneratedPackageId();
  const config = {
    url: get("siteUrl"),
    name: get("appName"),
    package: get("packageId"),
    icon: get("appIcon"),
    primary: get("primaryColor") || "#536dfe",
    splash: get("splashText"),
    versionName: get("versionName") || "1.0.0",
    versionCode: Number(get("versionCode") || "1"),
    devTools: form.querySelector("#devTools")?.checked !== false,
    permissions: [...form.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value)
  };

  if (!validUrl(config.url)) {
    message.textContent = "استخدم رابط HTTPS صالحاً بدون اسم مستخدم أو كلمة مرور.";
    return;
  }
  if (config.name.length < 1 || config.name.length > 50) {
    message.textContent = "اسم التطبيق يجب أن يكون بين 1 و50 حرفاً.";
    return;
  }
  if (!validPackage(config.package)) {
    message.textContent = "معرّف الحزمة غير صالح. استخدم صيغة مثل com.example.myapp.";
    return;
  }
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(config.versionName) || config.versionName.length > 30) {
    message.textContent = "رقم الإصدار يجب أن يكون بصيغة 1.0.0.";
    return;
  }
  if (!Number.isInteger(config.versionCode) || config.versionCode < 1 || config.versionCode > 2100000000) {
    message.textContent = "رقم النسخة يجب أن يكون عدداً صحيحاً موجباً.";
    return;
  }

  config.permissions = config.permissions.filter((p) => safePermissionNames.has(p));

  const { data: { user } } = await client.auth.getUser();
  if (!user) {
    message.textContent = "سجّل الدخول عبر GitHub أولاً حتى نتمكن من إنشاء المستودع وبدء البناء.";
    return;
  }
  const { data: { session } } = await client.auth.getSession();
  const githubToken = session?.provider_token || "";
  if (!githubToken) {
    message.textContent = "انتهت صلاحية اتصال GitHub. أعد تسجيل الدخول باستخدام GitHub ثم حاول مرة أخرى.";
    return;
  }

  message.textContent = "جارٍ إنشاء مشروع Android كامل…";

  const rgb = hexToRgb(config.primary);
  const letter = iconLetter(config.icon, config.name);
  let iconPngs;
  if (detectedIconDataUrl) {
    try {
      iconPngs = {
        foreground: await canvasPngFromDataUrl(432, detectedIconDataUrl, null),
        mdpi: await canvasPngFromDataUrl(48, detectedIconDataUrl, config.primary),
        hdpi: await canvasPngFromDataUrl(72, detectedIconDataUrl, config.primary),
        xhdpi: await canvasPngFromDataUrl(96, detectedIconDataUrl, config.primary),
        xxhdpi: await canvasPngFromDataUrl(144, detectedIconDataUrl, config.primary),
        xxxhdpi: await canvasPngFromDataUrl(192, detectedIconDataUrl, config.primary)
      };
    } catch {
      detectedIconDataUrl = "";
    }
  }
  if (!iconPngs) {
    iconPngs = {
      foreground: await canvasPng(432, letter, null, "#ffffff"),
      mdpi: await canvasPng(48, letter, config.primary, "#ffffff"),
      hdpi: await canvasPng(72, letter, config.primary, "#ffffff"),
      xhdpi: await canvasPng(96, letter, config.primary, "#ffffff"),
      xxhdpi: await canvasPng(144, letter, config.primary, "#ffffff"),
      xxxhdpi: await canvasPng(192, letter, config.primary, "#ffffff")
    };
  }

  const files = buildFiles(config, iconPngs);
  const zip = new JSZip();

  for (const [path, body] of Object.entries(files)) {
    if (typeof body === "object" && body.base64) {
      zip.file(path, body.base64, { base64: true });
    } else {
      zip.file(path, body);
    }
  }

  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = `${config.package.replace(/\./g, "-")}-android.zip`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);

  const { data: project, error: projectError } = await client.from("projects").insert({
    user_id: user.id,
    name: config.name,
    url: config.url,
    package: config.package,
    version_name: config.versionName,
    version_code: config.versionCode,
    settings: {
      icon: config.icon,
      primaryColor: config.primary,
      splashText: config.splash,
      permissions: config.permissions
    },
    config,
    status: "draft"
  }).select("id").single();

  if (projectError || !project) {
    const detail = projectError?.message || "";
    message.textContent = detail.includes("PROJECT_QUOTA_EXCEEDED")
      ? "وصلت إلى الحد المجاني: 10 مشاريع."
      : "تعذر حفظ المشروع في قاعدة البيانات.";
    return;
  }

  message.textContent = "تم حفظ المشروع. جارٍ إنشاء مستودع GitHub وبدء البناء…";

  const { data: provision, error: provisionError } = await client.functions.invoke("github-actions", {
    body: {
      action: "provision_project",
      projectId: project.id,
      files,
      githubToken,
      buildType: "debug",
      versionName: config.versionName,
      versionCode: config.versionCode
    }
  });

  if (provisionError || !provision?.ok) {
    const code = provision?.error || "";
    message.textContent = code === "build_daily_quota_exceeded"
      ? "وصلت إلى حد البناء المجاني اليومي: 10 عمليات."
      : code === "project_quota_exceeded"
        ? "وصلت إلى الحد المجاني: 10 مشاريع."
        : "تعذر إنشاء مستودع GitHub أو بدء عملية البناء.";
    return;
  }

  window.location.href = "download.html?build=" + encodeURIComponent(provision.buildId) + "&project=" + encodeURIComponent(provision.projectId);
});
