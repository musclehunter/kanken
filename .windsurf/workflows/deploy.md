---
description: ビルドしてデプロイする（バージョン更新→コミット→プッシュ→GitHub Pages反映確認）
---

## 手順

1. **ビルドスクリプトを実行してバージョンを更新する**
   // turbo
   `node build.js` を実行する。ファイルハッシュで変更を検知し、自動で `app.js` / `manifest.json` / `sw.js` のバージョンを同期する。

2. **変更をコミットする**
   // turbo
   `git add -A` を実行する。

3. **コミットメッセージを作成する**
   // turbo
   `git commit -m "update: version bump and deploy"` を実行する。

4. **リモートにプッシュする**
   // turbo
   `git push origin master` を実行する。これにより GitHub Actions が自動的にトリガーされ、GitHub Pages にデプロイされる。

5. **GitHub Actions のデプロイ状況を確認する**
   GitHub API を使ってワークフロー実行状態を確認する:
   ```
   curl -s "https://api.github.com/repos/musclehunter/kanken/actions/runs?per_page=1" | findstr "status conclusion html_url"
   ```
   - `"status":"in_progress"` の場合は数秒待ってから再確認
   - `"status":"completed"` かつ `"conclusion":"success"` ならデプロイ成功
   - `"conclusion":"failure"` の場合はログを確認する必要あり

6. **GitHub Pages の反映を確認する**
   デプロイ完了後、以下でバージョンが更新されているか確認する:
   ```
   curl -s "https://musclehunter.github.io/kanken/manifest.json" | findstr version
   ```
   - ビルドスクリプトで更新したバージョン番号と一致していれば反映完了
   - CDN キャッシュで古いバージョンが返る場合は数分待って再確認
