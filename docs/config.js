/*
 * 店舗ごとの設定。公開前にここだけ編集してください。
 * 注意: このファイルは GitHub Pages で誰でも閲覧できます。秘密情報は入れないこと。
 */
window.NOMI_CONFIG = {
  // GAS ウェブアプリの URL（https://script.google.com/macros/s/XXXX/exec）。空なら端末内のみで動作
  gasUrl: '',
  // GAS のスクリプトプロパティ SHARED_KEY と同じ値（いたずら防止用。公開されるので秘密ではありません）
  sharedKey: '',

  // 商品（id は英数字・_・- のみ）。1つだけなら商品選択欄は表示されません
  products: [
    { id: 'butaman', name: '豚饅' }
  ],
  // 受渡方法
  methods: ['店頭', '予約受取', '配達'],
  // 数量のクイックボタン
  quickQuantities: [1, 2, 5, 10],

  leadMinutes: 40,   // 何分後の蒸し目安か
  slotMinutes: 30,   // 時間帯の幅
  minSamples: 3,     // 目安を出すのに必要な同曜日・同時間帯の実績回数
  lookbackDays: 56,  // 何日前までの実績を使うか
  timeoutMs: 15000   // 携帯回線向けの通信タイムアウト
};
