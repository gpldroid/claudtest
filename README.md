# Web2APK
Arabic-first website-to-Android WebView generator using GitHub Pages, Supabase and GitHub Actions.

## Current architecture
- GitHub Pages hosts the static Arabic/English-ready UI.
- Supabase Auth handles sign-in.
- Supabase Postgres stores profiles, projects, builds and audit records with RLS.
- Supabase Edge Function `github-actions` is the only trusted bridge to GitHub APIs.
- Generated Android projects are pushed into private GitHub repositories.
- GitHub Actions builds debug APKs or signed release APK/AAB artifacts.
- Build status is synchronized into Supabase from the dashboard.
- Build artifacts are downloaded through the authenticated Supabase Edge Function; GitHub tokens are never placed in download URLs or stored in the database.

## Security
- Browser code contains only the Supabase publishable key.
- GitHub OAuth requests `repo workflow` because the current architecture creates private repositories and writes workflow files.
- GitHub provider tokens are transient and are sent only to the authenticated Edge Function.
- Android signing secrets are encrypted with GitHub's repository public key and are never stored in Web2APK.
- Public tables use owner-scoped RLS.
- Generated Android WebView projects restrict navigation to HTTPS same-host pages and route external URLs through Android intents.
- Free-plan quotas are enforced by database triggers, not by browser-supplied values.

## Dashboard
- `dashboard/index.html`: overview
- `dashboard/projects.html`: projects, build status, build controls and artifact downloads
- `dashboard/settings.html`: release signing secret configuration
- `generator.html`: Android project generator and GitHub provisioning

## Android build
The generated project targets current Android tooling used by the generator (AGP 9.4.0, Gradle 9.6, Kotlin 2.4.20, JDK 17, compile/target SDK 36). Debug builds require no signing configuration. Release APK/AAB builds require the four Android signing secrets configured from the dashboard.

## Verification status
- Supabase Edge Function `github-actions` is deployed and ACTIVE.
- All four public application tables have RLS enabled.
- Build status constraints are applied to the live database.
- Security Advisor currently reports one remaining Auth configuration warning: leaked-password protection is disabled.
- A real user GitHub OAuth session and a real Android Actions build have not yet been executed in this environment, so end-to-end APK/AAB success is not claimed.
