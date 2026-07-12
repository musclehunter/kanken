# 問題データ生成スクリプト

## 1. 語彙リスト生成（scripts/generate-vocab.js）

### 準備

`.env.example` をコピーして `.env` を作成し、APIキーとエンドポイントを設定する。

```bash
cp .env.example .env
```

`.env` の例:

```bash
# 語彙生成用（必須）
LLM_API_KEY_VOCAB=sk-xxx

# 短文生成用（scripts/generate-sentences.js）
LLM_API_KEY_SENTENCE=sk-yyy

# 日本語 meanings 生成用（scripts/generate-meanings-ja.js）
LLM_API_KEY_MEANINGS=sk-zzz

# 共通設定
LLM_API_ENDPOINT=https://api.openai.com/v1/responses
LLM_MODEL=gpt-5.6-luna

# 後方互換フォールバック
LLM_API_KEY=sk-common
```

### 実行

Windows 環境では `npm run` 経由で引数が正しく渡されないため、**直接 node を実行**してください。

```bash
# 基本（10級）
node scripts/generate-vocab.js --grade=10

# 入力/出力を指定
node scripts/generate-vocab.js --grade=10 --input=./js/grades/kentei-10.json --output=./js/grades/vocab-10.json --sleep=1000

# テスト用に2件だけ生成（確認プロンプトをスキップ）
node scripts/generate-vocab.js --grade=10 --limit=2 --yes
```

### オプション

- `--grade={級}`: 対象級（1〜10）
- `--input={path}`: 入力の漢字JSONパス
- `--output={path}`: 出力先JSONパス
- `--limit={n}`: 先頭から n 件だけ生成（テスト用）
- `--sleep={ms}`: 各リクエスト間の待機時間（デフォルト 500ms）
- `--yes`: API呼び出し前の確認プロンプトをスキップ

### 出力

`--output` を省略すると、`js/grades/vocab-{grade}-{YYYYMMSS-HHMMSS}.json` として新規ファイルが作成されます。既存ファイルへの上書きは行われません。

出力JSONには以下が含まれる：

- `generated_at`: 生成日時
- `model`: 使用したモデル
- `vocab`: 各漢字の語彙リスト（熟語・訓読み）
- `failures_detail`: 検証失敗した漢字一覧

### 検証内容

生成された語彙は自動で以下をチェックされる：

- 対象漢字を含むか
- 卑猥・性的・暴力・犯罪・自殺・差別的な表現を含まないか
- JSONスキーマに沿っているか
- 対象級に適した難易度か

### コスト追跡

実行終了時にトークン消費が出力される：

```
💰 推定トークン消費
   入力トークン: 12,345
   出力トークン: 4,567
   合計トークン: 16,912
```

語彙生成と短文生成で別APIキーを使うことで、それぞれのコストを正確に把握できます。

## 2. 短文生成（scripts/generate-sentences.js）

語彙ファイル（`vocab-{grade}-{timestamp}.json`）を読み込み、各熟語・訓読み語彙に短い例文を付与する。

### 実行

```bash
# 語彙ファイルを指定して短文生成
node scripts/generate-sentences.js --vocab=./js/grades/vocab-9-20260711-165613.json --limit=2 --yes

# 出力先も指定
node scripts/generate-sentences.js --vocab=./js/grades/vocab-9-20260711-165613.json --output=./js/grades/sentences-9.json --yes
```

### オプション

- `--vocab={path}`: 入力の語彙JSONパス（必須）
- `--grade={級}`: 対象級（語彙ファイルに含まれる場合は省略可）
- `--output={path}`: 出力先JSONパス
- `--limit={n}`: 先頭から n 件の漢字だけ生成（テスト用）
- `--sleep={ms}`: 各リクエスト間の待機時間（デフォルト 500ms）
- `--yes`: API呼び出し前の確認プロンプトをスキップ

### 検証

生成された例文は自動で以下をチェックされます：

- 対象単語を含むか
- 目標 10〜15文字、最大 20文字 に収まるか
- 卑猥・性的・暴力・犯罪・自殺・差別的な表現を含まないか
- JSON スキーマに沿っているか

長さや不適切表現が検出された場合、出力 JSON の `warnings_detail` に記録されます。

### 出力

`--output` を省略すると、`js/grades/sentences-{grade}-{YYYYMMSS-HHMMSS}.json` として新規ファイルが作成されます。

元の語彙データに `example` フィールドが追加された形で出力されます：

```json
{
  "word": "引力",
  "reading": "いんりょく",
  "meaning": "引き付ける力",
  "example": "地球の引力で物が落ちる。"
}
```

## 3. 短文を examples 形式に変換（scripts/merge-sentences.js）

`sentences-{grade}-{timestamp}.json` を読み込み、`examples-{grade}-{timestamp}.json` を生成する。`kentei-{grade}.json` から `examples` を分離した別ファイルとして出力する。

```bash
# 基本実行
node scripts/merge-sentences.js --sentences=js/grades/sentences-9-20260711-171953.json --yes

# 強制更新（ハッシュ比較をスキップ）
node scripts/merge-sentences.js --sentences=... --force --yes
```

### オプション

- `--sentences={path}`: 入力の sentences ファイル（必須）
- `--input={path}`: 入力の kentei ファイル（省略時は級から自動）
- `--output={path}`: 出力先（省略時は `examples-{grade}-{YYYYMMSS-HHMMSS}.json`）
- `--prev={path}`: 前回の examples ファイル（省略時は最新ファイルを自動検出）
- `--force`: ハッシュ比較をスキップして全漢字を更新
- `--yes`: 確認プロンプトをスキップ

### 増分マージ

`kentei-{grade}.json` のソースデータをハッシュ化し、前回出力ファイルと比較する。変更がない漢字の examples は再利用され、API コールを省略できる。

## 4. 日本語 meanings 生成（scripts/generate-meanings-ja.js）

`kentei-{grade}.json` の英語 `meanings` を基に、AI で日本語の `meanings_ja` を追加する。既存の `meanings_ja` を持つ漢字はスキップされる。

```bash
# 全漢字を対象に生成
node scripts/generate-meanings-ja.js --grade=9 --yes

# テスト用に3件だけ生成
node scripts/generate-meanings-ja.js --grade=9 --limit=3 --yes
```

### オプション

- `--grade={n}`: 対象級（デフォルト 10）
- `--input={path}`: 入力の kentei ファイル
- `--output={path}`: 出力先（省略時は `kentei-{grade}-ja-{timestamp}.json`）
- `--limit={n}`: 先頭から n 件の未設定漢字だけ生成（テスト用）
- `--batch-size={n}`: 1 回の API リクエストでまとめて処理する漢字数（デフォルト 1、10 程度推奨）
- `--sleep={ms}`: 各リクエスト間の待機時間（デフォルト 500ms）
- `--yes`: 確認プロンプトをスキップ

### 出力

英語 `meanings` はそのまま残し、新しいフィールド `meanings_ja` を追加します：

```json
{
  "kanji": "引",
  "meanings": ["pull", "quote", "refer to"],
  "meanings_ja": ["引く", "引き寄せる", "引用する"]
}
```

## 5. homophones 移行（scripts/migrate-homophones.js）

`kentei-{grade}.json` から `homophones` フィールドを抽出し、`word-relations.json` の `homophones` に集約する。同時に `homophones` を削除した新しい kentei ファイルを出力する。

```bash
node scripts/migrate-homophones.js --yes
```

### オプション

- `--input-dir={path}`: 入力 kentei ファイルのディレクトリ（デフォルト `js/grades`）
- `--output-dir={path}`: 出力先ディレクトリ（デフォルト `js/grades`）
- `--word-relations={path}`: word-relations.json のパス
- `--yes`: 確認プロンプトをスキップ

### 出力

```json
// word-relations.json
{
  "antonyms": [],
  "synonyms": [],
  "same_kun": [],
  "homophones": [
    { "kanji": "一", "homophones": ["壱", "乙", "亜", ...] }
  ]
}
```

## 6. 全級一括で meanings_ja 生成（scripts/generate-meanings-ja-all.js）

全級（10, 9, 8, 7, 6, 5, 4, 3, 2.5, 2, 1.5, 1）を順に処理し、`meanings_ja` が未設定の漢字を一括で生成する。

```bash
node scripts/generate-meanings-ja-all.js
```

- 各級の `kentei-{grade}.json` を入力として使用
- 生成後、最新の `kentei-{grade}-ja-{timestamp}.json` を `kentei-{grade}.json` にコピー
- 既に `meanings_ja` が設定済みの級はスキップ

## 7. homophones 削除版 kentei ファイルへの置き換え（scripts/replace-kentei-nohomo.js）

`kentei-{grade}-nohomo-{timestamp}.json` を `kentei-{grade}.json` にコピーする。

```bash
node scripts/replace-kentei-nohomo.js
```

## 8. 不要な中間ファイル整理（scripts/cleanup-intermediate.js）

`kentei-{grade}-nohomo-*.json` を削除し、`kentei-{grade}-ja-*.json` の古いものを整理して最新のみ残す。

```bash
node scripts/cleanup-intermediate.js
```

## 9. 漢字数・meanings_ja 状況の確認（scripts/count-kanji.js）

全級の漢字数と、`meanings_ja` が未設定の漢字数を表示する。

```bash
node scripts/count-kanji.js
```

```text
grade 1: 2535 件 （meanings_ja 未設定: 0 件）
...
total: 5515 件
```

## 10. ローカルデータ管理画面（admin-server.js）

ブラウザベースのローカル専用管理画面。漢字データ、例文、word-relations を一覧・編集・追加・削除できる。

```bash
npm run admin
```

ブラウザで `http://localhost:3456` を開く。

### 機能

- **漢字データ**: 級ごとの漢字一覧、検索・ソート、編集・追加・削除
- **例文一覧**: 全例文の一覧表示、長さ・不適切表現フィルタ、修正ボタンで漢字編集へ遷移
- **監査**: 15文字超・20文字超・不適切表現を含む例文を一覧表示
- **Word Relations**: `antonyms` / `synonyms` / `same_kun` / `homophones` の JSON 編集

### データ編集の流れ

1. `npm run admin` でサーバー起動
2. ブラウザで `http://localhost:3456` を開く
3. 画面からデータを編集
4. 「保存」ボタンで JSON ファイルに書き出し
5. Git コミット → 公開サーバーに同期

## 11. 今後追加予定

- `scripts/validate-vocab.js`: 既存語彙の再検証・一括チェック
