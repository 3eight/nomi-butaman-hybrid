# 能美豚饅 蒸しHUD（スマホ向けハイブリッド版）

GitHub Pages の静的フロント + Google Apps Script（GAS）+ Google スプレッドシート。
受渡完了ごとに記録を蓄積し、**同じ曜日・時間帯の実績が3回以上**になると **40分後の蒸し目安** を表示します。不足時は「学習中」。

## 画面（タブで切替）

| タブ | 内容 | 直接開くURL |
|---|---|---|
| キッチン | 次に蒸す数（最大表示）、直近30分・今日の受渡数 | `…/#kitchen` |
| 会計 | 受渡の記録（数量・方法）、最近の受渡 | `…/#register` |

最後に選んだタブは端末ごとに記憶されます。

## 構成

```
docs/                 GitHub Pages で公開するフォルダ（Settings → Pages → /docs）
  index.html          画面（「次に蒸す数」を最大表示）
  styles.css          赤・金のHUD調（コントラスト比・タップ領域を優先）
  config.js           ★店舗設定（GAS URL・商品・受渡方法）
  core.js             共通ロジック（時間帯判定・検証・蒸し目安・ナレッジ集計）※正本
  sync.js             端末内保存＋送信キュー＋GAS同期
  app.js              画面制御
  sw.js               オフライン起動用サービスワーカー
gas/
  Code.gs             GAS API（コマンド単位・LockService・重複防止）
  Core.gs             docs/core.js の自動コピー（npm run sync:gas）
  appsscript.json     タイムゾーン Asia/Tokyo、ウェブアプリ設定
tests/                node:test によるテスト（依存パッケージなし）
```

## 蒸し目安の計算

1. 目標時刻 = 現在 + 40分。その **曜日 × 30分の時間帯**（例: 土 11:30-12:00）を対象にする
2. 直近56日の同じ曜日・時間帯の記録を集める（当日分は途中経過なので除外）
3. 異なる日付が3日以上 → 商品ごとに「1日あたり平均数量」を切り上げて合計を表示
4. 3日未満 → 「学習中（あと N 回）」

パラメータは `docs/config.js`（`leadMinutes` / `slotMinutes` / `minSamples` / `lookbackDays`）で変更できます。

## 回線が弱い・圏外のとき

- 受渡完了は **まず端末内に保存** し、送信キューに積みます（画面上は「未送信」）
- 電波復帰・画面復帰・2分ごと・「今すぐ同期」で自動再送。最大50件を1リクエストにまとめます
- 記録IDで重複排除されるため、通信が途中で切れて再送しても二重計上されません
- サービスワーカーで画面ファイルをキャッシュ（LINE内ブラウザ等で非対応でも記録・再送は動作）

## GAS API（POST 本文は JSON、Content-Type: text/plain）

| command | 内容 | ロック |
|---|---|---|
| `ping` | 疎通確認 | - |
| `recordDelivery` / `recordDeliveries` | 受渡記録の追記（最大50件） | ✔ |
| `listDeliveries` | 直近N日（最大90日）の記録取得 | - |
| `getForecast` | サーバー側で蒸し目安を計算 | - |
| `rebuildKnowledge` | 「販売ナレッジ」シート（曜日×時間帯×商品）を再集計 | ✔ |

- 書き込みは `LockService.getScriptLock().tryLock(10000)`。取れなければ `busy`（再送対象）
- 重複防止: CacheService（6時間）＋ シートA列の記録ID照合
- 曜日・時間帯はサーバー側で受渡日時から再計算。数式インジェクション対策済み

## 公開手順（未実施・手動で行ってください）

1. スプレッドシートを作成 → 拡張機能 → Apps Script に `gas/` の3ファイルを貼り付け
2. （任意）スクリプトプロパティ `SHARED_KEY` を設定
3. デプロイ → ウェブアプリ（実行ユーザー: 自分 / アクセス: 全員）→ URL を `docs/config.js` の `gasUrl` に設定
4. （任意）`rebuildKnowledgeTrigger` を毎晩の時間主導トリガーに登録
5. GitHub に push → Settings → Pages → Branch: main / `/docs`
6. LINE で共有する URL は末尾に `?openExternalBrowser=1` を付けると Safari/Chrome で開き、オフライン起動が安定します

> [!NOTE]
> `config.js` と `SHARED_KEY` は公開ページから見えます。いたずら防止程度の効果で、認証ではありません。

## 開発

```sh
npm test            # Core.gs 同期チェック + 全テスト
npm run sync:gas    # docs/core.js を gas/Core.gs へコピー
npm run serve       # http://localhost:8080 でローカル確認
```
