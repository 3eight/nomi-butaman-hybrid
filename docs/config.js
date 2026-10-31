/*
 * 店舗ごとの設定。公開前にここだけ編集してください。
 * 注意: このファイルは GitHub Pages で誰でも閲覧できます。秘密情報は入れないこと。
 */
window.NOMI_CONFIG = {
  // GAS ウェブアプリの URL（https://script.google.com/macros/s/XXXX/exec）。空なら端末内のみで動作
  gasUrl: 'https://script.google.com/macros/s/AKfycbwb_a0_MIFrxU8oc7T9tWH3WJFtMvoaZ4qbTgBDIyr9trjSQFvvnlQohfSQscHBCoLQ/exec',
  // GAS のスクリプトプロパティ SHARED_KEY と同じ値（いたずら防止用。公開されるので秘密ではありません）
  sharedKey: '',

  // 商品・価格・サービス設定はアプリの「商品」タブで登録します（全端末で共有）

  steamMinutes: 40,        // 冷凍から蒸し上がりまで（本人運用値）
  lossYenPerPiece: 250,    // 出店者負担のロス単価（確定）
  // 段: 通常1セット目1〜4、2セット目5〜8（5個/段）、電気9〜12（6個/段・実容量未確認）
  tiers: null,             // null なら既定（core.js の defaultTiers）

  leadMinutes: 40,   // 何分後の蒸し目安か
  slotMinutes: 30,   // 時間帯の幅
  minSamples: 3,     // 目安を出すのに必要な同曜日・同時間帯の実績回数
  lookbackDays: 56,  // 何日前までの実績を使うか
  timeoutMs: 15000,  // 携帯回線向けの通信タイムアウト
  pollMs: 15000      // 他のスマホの操作を取り込む間隔
};
