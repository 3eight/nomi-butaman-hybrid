/**
 * 能美豚饅 蒸し・会計・注文管理システム (v0.2)
 * データモデル・定数・初期設定定義
 */

export const ProductCategory = Object.freeze({
  MAN: 'MAN',   // まん類（有料5個ごとに1個無料サービスの集計・選択対象）
  SIDE: 'SIDE', // ポテト等サイドメニュー（無料サービスの母数・選択対象外）
});

export const CookingMethod = Object.freeze({
  STEAM: 'STEAM', // 蒸し
  FRY: 'FRY',     // 揚げ（※揚げ工程詳細は現場未確認）
});

export const PaymentMethod = Object.freeze({
  CASH: 'CASH',             // 現金
  PAYPAY: 'PAYPAY',         // PayPay（記録のみ・決済代行しない）
  TOCHITSUKA: 'TOCHITSUKA', // トチツーカ（記録のみ・決済代行しない）
});

export const PaymentStatus = Object.freeze({
  UNPAID: 'UNPAID',                                           // 未払い（後払い受付時など）
  PAID: 'PAID',                                               // 支払完了
  ADDITIONAL_COLLECTION_PENDING: 'ADDITIONAL_COLLECTION_PENDING', // 注文変更による差額徴収待ち
  REFUND_PENDING: 'REFUND_PENDING',                           // 注文変更・キャンセルによる返金待ち
  ZERO_DUE: 'ZERO_DUE',                                       // 支払不要（0円）
});

export const FulfillmentStatus = Object.freeze({
  WAITING: 'WAITING',     // お渡し待ち
  PARTIAL: 'PARTIAL',     // 一部お渡し済み
  DELIVERED: 'DELIVERED', // お渡し完了
  CANCELLED: 'CANCELLED', // キャンセル
});

export const BatchState = Object.freeze({
  STEAMING: 'STEAMING',               // 蒸し中（タイマー満了後・調理未確認の状態も含む）
  CONFIRMED_READY: 'CONFIRMED_READY', // 調理確認済み（引渡し・取り出し案内可能）
});

export const WasteReason = Object.freeze({
  DEFECT_HQ: 'DEFECT_HQ',                 // 商品不良 = 本部負担（出店者負担 0円）
  NEGLIGENCE_VENDOR: 'NEGLIGENCE_VENDOR', // 蒸しすぎ等過失 = 出店者負担（250円/個）
});

export const ExpenseStatus = Object.freeze({
  UNENTERED: 'UNENTERED', // 未入力（0円確定として扱わない）
  CONFIRMED: 'CONFIRMED', // 入力確定（0円確定を含む）
});

export const SteamerType = Object.freeze({
  REGULAR: 'REGULAR',   // 通常せいろ（5個×4段×2セット）
  ELECTRIC: 'ELECTRIC', // 電気せいろ（6個×4段 ※容量未確認）
});

export const AdviceLevel = Object.freeze({
  ADD_MORE: 'ADD_MORE',       // 追加蒸し推奨
  SMALL_BATCH: 'SMALL_BATCH', // 少量追加推奨
  STOP: 'STOP',               // 追加停止推奨
});

/**
 * 客の特徴タグ候補（数タップで任意選択する案・必須にしない）
 */
export const DEFAULT_CUSTOMER_FEATURE_SUGGESTIONS = Object.freeze([
  '赤系服', '黒系服', '白系服', '青系服',
  '帽子', 'メガネ', 'リュック', 'ベビーカー',
  'お子様連れ', '2人組', 'グループ', '常連様',
]);

/**
 * SKUキー（商品ID × 調理方法）を生成するヘルパー
 */
export function makeSkuKey(productId, cookingMethod) {
  return `${productId}__${cookingMethod}`;
}

export function parseSkuKey(skuKey) {
  const [productId, cookingMethod] = skuKey.split('__');
  return { productId, cookingMethod };
}

/**
 * デフォルトのイベント初期設定を生成する
 * - 豚まん500円/50%は過去条件で再確認が必要（unverified: true）
 * - ポテト配分は本部50%・出店者50%、原価未精査（costUnverified: true）
 * - 電気せいろ6個×4段は容量未確認（capacityVerified: false）
 */
export function createDefaultEventConfig(overrides = {}) {
  const defaultCatalog = [
    {
      productId: 'butaman',
      name: '豚まん',
      category: ProductCategory.MAN,
      allowedMethods: [CookingMethod.STEAM, CookingMethod.FRY],
      unitPrice: 500,
      hqShareRate: 0.5,
      vendorShareRate: 0.5,
      conditionUnverified: true, // 500円/50%は過去条件で再確認が必要
      costUnverified: true,
      enabled: true,
    },
    {
      productId: 'anbataman',
      name: 'あんバタまん',
      category: ProductCategory.MAN,
      allowedMethods: [CookingMethod.STEAM, CookingMethod.FRY],
      unitPrice: 500,
      hqShareRate: 0.5,
      vendorShareRate: 0.5,
      conditionUnverified: true,
      costUnverified: true,
      enabled: true,
    },
    {
      productId: 'potato',
      name: 'ポテト',
      category: ProductCategory.SIDE,
      allowedMethods: [CookingMethod.FRY],
      unitPrice: 400,
      hqShareRate: 0.5,
      vendorShareRate: 0.5,
      conditionUnverified: false, // 本部50%・出店者50%は確定
      costUnverified: true,       // 原価未精査
      enabled: true,
    },
  ];

  // 通常せいろ: 5個×4段×2セット (段番号案 1〜4, 5〜8)
  // 電気せいろ: 6個×4段×1セット (段番号案 9〜12, 容量未確認)
  const defaultTiers = [
    // セット1 (1〜4)
    { tierNumber: 1, setId: 'regular-set-1', steamerType: SteamerType.REGULAR, capacity: 5, capacityVerified: true, numberingProvisional: true },
    { tierNumber: 2, setId: 'regular-set-1', steamerType: SteamerType.REGULAR, capacity: 5, capacityVerified: true, numberingProvisional: true },
    { tierNumber: 3, setId: 'regular-set-1', steamerType: SteamerType.REGULAR, capacity: 5, capacityVerified: true, numberingProvisional: true },
    { tierNumber: 4, setId: 'regular-set-1', steamerType: SteamerType.REGULAR, capacity: 5, capacityVerified: true, numberingProvisional: true },
    // セット2 (5〜8)
    { tierNumber: 5, setId: 'regular-set-2', steamerType: SteamerType.REGULAR, capacity: 5, capacityVerified: true, numberingProvisional: true },
    { tierNumber: 6, setId: 'regular-set-2', steamerType: SteamerType.REGULAR, capacity: 5, capacityVerified: true, numberingProvisional: true },
    { tierNumber: 7, setId: 'regular-set-2', steamerType: SteamerType.REGULAR, capacity: 5, capacityVerified: true, numberingProvisional: true },
    { tierNumber: 8, setId: 'regular-set-2', steamerType: SteamerType.REGULAR, capacity: 5, capacityVerified: true, numberingProvisional: true },
    // 電気せいろ (9〜12)
    { tierNumber: 9, setId: 'electric-set-1', steamerType: SteamerType.ELECTRIC, capacity: 6, capacityVerified: false, numberingProvisional: true },
    { tierNumber: 10, setId: 'electric-set-1', steamerType: SteamerType.ELECTRIC, capacity: 6, capacityVerified: false, numberingProvisional: true },
    { tierNumber: 11, setId: 'electric-set-1', steamerType: SteamerType.ELECTRIC, capacity: 6, capacityVerified: false, numberingProvisional: true },
    { tierNumber: 12, setId: 'electric-set-1', steamerType: SteamerType.ELECTRIC, capacity: 6, capacityVerified: false, numberingProvisional: true },
  ];

  return {
    eventId: overrides.eventId ?? 'event-2026-11-01',
    eventName: overrides.eventName ?? '能美豚饅 出店イベント',
    serviceEnabled: overrides.serviceEnabled ?? true, // イベント単位サービスON/OFF
    serviceEveryNPaidMan: overrides.serviceEveryNPaidMan ?? 5, // 有料まん5個ごと
    serviceFreeCountPerUnit: overrides.serviceFreeCountPerUnit ?? 1, // 1個サービス（本部負担）
    defaultSteamDurationMinutes: overrides.defaultSteamDurationMinutes ?? 40, // 蒸し時間約40分
    vendorNegligencePenaltyPerUnit: overrides.vendorNegligencePenaltyPerUnit ?? 250, // 過失廃棄250円/個
    catalog: overrides.catalog ?? defaultCatalog,
    tiers: overrides.tiers ?? defaultTiers,
    unverifiedNotes: {
      butamanPriceAndShare: '豚まん500円/50%は過去条件のため再確認が必要',
      potatoCost: 'ポテト原価未精査（本部50%・出店者50%配分は確定）',
      electricSteamerCapacity: '電気せいろ6個×4段は容量未確認',
      tierNumbering: '1〜4 / 5〜8 / 9〜12 は段番号案であり確定ではない',
      fryingProcess: '揚げ工程の詳細運用は未確認',
      multiDeviceSyncAndNotification: '複数スマホ同期方式・通信切断時・画面非表示中の通知は未検証',
    },
  };
}
