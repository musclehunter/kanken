# 漢検マスター Playストア配信タスクリスト

デベロッパーアカウントのアクティベーションおよびアッセト準備のためのTODOリストです。

---

## 🟩 デベロッパーアカウントの設定
- [ ] **電話番号の確認手続き** を完了する
  - Google Play Consoleにログインし、確認用のコードを受け取って認証を完了させてください。

---

## 🟩 アプリアイコン・スプラッシュ画面の準備
- [ ] PWAプロジェクトのルートに `assets` フォルダを作成する (`d:\masanobu\dev\kanken\assets`)
- [ ] 以下の元画像を用意して `assets/` フォルダに配置する：
  - [ ] **アプリアイコン**: `icon.png` (1024x1024 px, PNG)
    - *(オプション)* アダプティブアイコン対応時:
      - `icon-foreground.png` (1024x1024 px, 手前のロゴ・背景透過)
      - `icon-background.png` (1024x1024 px, 背景画像・透過なし)
  - [ ] **スプラッシュ画面**: `splash.png` (2732x2732 px, PNG、重要要素は中央の直径1000px以内に配置)
- [ ] 以下の自動生成コマンドを実行してAndroidプロジェクトへ適用する：
  ```bash
  npm install @capacitor/assets --save-dev
  npx capacitor-assets generate --android
  ```

---

## 🟩 ビルドとストア申請
- [ ] アセット反映後、再度Webモジュールをビルドして同期する
  ```powershell
  npm run build
  npx cap sync
  ```
- [ ] Android Studioを起動する (`npx cap open android` もしくは `npm run android`)
- [ ] **署名付きリリースビルド (AAB) の作成**
  - **Build** > **Generate Signed Bundle / APK...**
  - 新規Keystore（署名鍵）を作成し、ファイル（`.jks`）とパスワードを安全な場所に保存する（※絶対に紛失しないこと）
  - ビルドバリアント `release` を選択してビルドを実行する
- [ ] **Google Play Consoleでアプリを作成し、配信手続きを進める**
  - [ ] ストア掲載情報の登録（アプリ説明、512x512アイコン、1024x500の機能グラフィック、スクリーンショット）
  - [ ] プライバシーポリシーのURLを公開して登録
  - [ ] クローズドテストの実施（テスター20名を登録し、14日間連続テスト要件を満たす）
  - [ ] 本番（製品版）へのリリース申請
