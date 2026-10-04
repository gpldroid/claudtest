# Web2APK
A lightweight Arabic-first website-to-Android WebView project generator.

## Architecture
- `index.html`: landing page
- `generator.html`: Android project generator and ZIP download
- `login.html`: GitHub OAuth through Supabase Auth
- `dashboard/`: overview, projects and settings
- `assets/css/style.css`: shared responsive styles
- `assets/js/`: Supabase config, auth, generator and dashboard modules
- `supabase/schema.sql`: tables and owner-scoped RLS
- `.github/workflows/pages.yml`: GitHub Pages deployment

## Supabase
The browser uses the publishable key only. Never put a `service_role` or secret key in frontend code.
Enable GitHub in Supabase Dashboard → Authentication → Providers and configure the GitHub OAuth application. Add the deployed GitHub Pages URL to Supabase Auth URL Configuration → Redirect URLs. The GitHub OAuth callback is `https://hponoukkcegkwddenfqd.supabase.co/auth/v1/callback`.
The schema has been applied to the configured Supabase project. To recreate it elsewhere, run `supabase/schema.sql`.

## Deploy
In GitHub Settings → Pages choose **GitHub Actions** as the deployment source. Pushes to `main` run the Pages workflow.

## Android build
Download the generated ZIP and open it in Android Studio, sync Gradle, then build an APK or AAB. This release downloads a generated Android project; publishing generated projects to another GitHub repository and automated APK signing are not included yet.
