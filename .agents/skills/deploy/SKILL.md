---
name: deploy
description: Build the 漢検マスター PWA and deploy it to GitHub Pages (https://masanobu.jp/kanken/). Use when asked to deploy, release, publish, or push a new version of the web app / PWA, or to bump the app version and update the live site.
---

# Deploy 漢検マスター to GitHub Pages

The web/PWA version is published to GitHub Pages at `https://masanobu.jp/kanken/`.
Deployment is triggered automatically by `.github/workflows/deploy.yml` on every push to
`master`. Pages serves the **repository root** (`path: '.'`), i.e. `index.html`, `js/`,
`css/`, `manifest.json`, `sw.js`, `icons/`. (The `www/` directory produced by `build.js`
is only for the Capacitor/Android build and is not what Pages serves.)

## Steps

1. **Bump the version and sync build metadata**

   ```bash
   node build.js
   ```

   `build.js` detects changes by file hash and, when the hashed web files changed, bumps the
   app version and syncs it across `js/app.js` (`APP_VERSION`), `manifest.json`, and `sw.js`
   (cache name). It also rebuilds `www/` and updates `android/app/build.gradle`'s versionCode
   (Unix-epoch minutes) — those are gitignored and irrelevant to the Pages deploy. If it prints
   `変更なし` (no change), there is nothing new to deploy.

2. **Commit the version bump**

   Stage only the changed, tracked web files (do NOT `git add -A` — that could pick up
   gitignored build artifacts or unrelated files):

   ```bash
   git add js/app.js manifest.json sw.js package.json
   git commit -m "Deploy: version bump"
   ```

3. **Land the change on `master`**

   - **Devin / Devin Desktop (recommended):** do not push directly to `master`. Create a
     branch, open a PR into `master`, and merge it. Merging pushes to `master`, which triggers
     the deploy workflow.
   - The push to `master` (via merge) is what triggers `.github/workflows/deploy.yml`.

4. **Verify the GitHub Actions deploy succeeded**

   Prefer the builtin PR/CI tools when available. Otherwise query the API (use `grep`, not
   Windows `findstr`):

   ```bash
   curl -s "https://api.github.com/repos/musclehunter/kanken/actions/runs?per_page=1" \
     | grep -E '"status"|"conclusion"|"html_url"'
   ```

   - `"status":"in_progress"` → wait a few seconds and re-check.
   - `"status":"completed"` and `"conclusion":"success"` → deploy succeeded.
   - `"conclusion":"failure"` → inspect the run logs.

5. **Confirm the live site reflects the new version**

   ```bash
   curl -s "https://masanobu.jp/kanken/manifest.json" | grep version
   ```

   The version must match the number `build.js` produced. If an old version is returned, it is
   usually CDN caching — wait a few minutes and re-check.
