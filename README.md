# Web2APK

Convert any website into an Android Studio project (WebView) built by GitHub Actions.

- `index.html` public site + generator
- `dashboard.html` projects dashboard (GitHub login via Supabase)
- `supabase/schema.sql` tables + RLS

## Deploy (free)
1. Push this folder to a GitHub repo, then Settings > Pages > Source: GitHub Actions.
2. Create a Supabase project and run `supabase/schema.sql`.
3. Supabase > Auth > Providers: enable GitHub. Add your Pages URL to Redirect URLs.
4. Open dashboard.html > Settings and paste your Supabase URL and anon key (or hardcode them in `assets/app.js` in `CFG`).
