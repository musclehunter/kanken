# 漢検マスター – Android (TWA/APK)

このディレクトリは PWA を [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap)
で **TWA (Trusted Web Activity)** としてラップし、Android の APK / AAB を生成するための設定です。
アプリは https://masanobu.jp/kanken/ の公開 PWA を全画面で表示します。

## 前提ツール

- Node.js 20 / npm
- JDK 17
- Android SDK（`platform-tools`, `build-tools;34.0.0`, `platforms;android-34`）
- Bubblewrap CLI: `npm i -g @bubblewrap/cli`

`bubblewrap doctor` で JDK / Android SDK パスの検証ができます。

## 署名鍵（keystore）

APK の署名には keystore が必要です。**keystore はリポジトリにコミットしません**（`.gitignore` 済み）。
このディレクトリに `android.keystore`（alias: `android`）を用意してください。新規作成例:

```bash
keytool -genkeypair -v -keystore ./android.keystore -alias android \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=Kanken Master, OU=Dev, O=masanobu.jp, C=JP"
```

`twa-manifest.json` の `fingerprints` は上記の開発用鍵の SHA256 です。別の鍵で署名する場合は
`keytool -list -v -keystore ./android.keystore -alias android` で取得した値に更新してください。

## ビルド

```bash
# keystore のパスワードは環境変数で渡せます（対話プロンプトを省略）
export BUBBLEWRAP_KEYSTORE_PASSWORD=****
export BUBBLEWRAP_KEY_PASSWORD=****
bubblewrap build
```

生成物:
- `app-release-signed.apk` … 端末 / エミュレータへの直接インストール用
- `app-release-bundle.aab` … Google Play 配布用

> `iconUrl` は公開サイトのアイコンを参照します。デプロイ前にローカルで試す場合は、
> リポジトリルートを HTTP 配信（`python3 -m http.server 8000`）し、`iconUrl` を
> `http://localhost:8000/icons/icon-512.png` に一時変更してください。

## エミュレータへのインストール

```bash
adb install -r app-release-signed.apk
adb shell monkey -p jp.masanobu.kanken -c android.intent.category.LAUNCHER 1
```

## 全画面表示（URL バーを消す）＝ Digital Asset Links

TWA を URL バーなしの全画面で表示するには、署名鍵の指紋を含む `assetlinks.json` を
**オリジンのルート** で配信する必要があります:

```
https://masanobu.jp/.well-known/assetlinks.json
```

注意: 本アプリは `masanobu.jp/kanken/`（サブパス）で公開されていますが、Digital Asset Links は
**ドメインルート**（`masanobu.jp`）配下でのみ検証されます。`kanken` リポジトリの GitHub Pages が
サブパスに配信される場合、この `twa/assetlinks.json` をルートドメインを配信している場所に設置してください。
未設置の場合はカスタムタブ（URL バーあり）で動作します。
