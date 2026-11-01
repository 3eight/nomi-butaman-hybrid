/**
 * 能美豚饅 統合管理システム - GitHub Pages 自己完結バンドル
 * 生成日時: 2026-11-01T07:47:13.868Z
 */

// === 1. Models ===
/**
 * 能美豚饅 蒸し・会計・注文管理システム (v0.2)
 * データモデル・定数・初期設定定義
 */

const ProductCategory = Object.freeze({
  MAN: 'MAN',   // まん類（有料5個ごとに1個無料サービスの集計・選択対象）
  SIDE: 'SIDE', // ポテト等サイドメニュー（無料サービスの母数・選択対象外）
});

const CookingMethod = Object.freeze({
  STEAM: 'STEAM', // 蒸し
  FRY: 'FRY',     // 揚げ（※揚げ工程詳細は現場未確認）
});

const PaymentMethod = Object.freeze({
  CASH: 'CASH',             // 現金
  PAYPAY: 'PAYPAY',         // PayPay（記録のみ・決済代行しない）
  TOCHITSUKA: 'TOCHITSUKA', // トチツーカ（記録のみ・決済代行しない）
});

const PaymentStatus = Object.freeze({
  UNPAID: 'UNPAID',                                           // 未払い（後払い受付時など）
  PAID: 'PAID',                                               // 支払完了
  ADDITIONAL_COLLECTION_PENDING: 'ADDITIONAL_COLLECTION_PENDING', // 注文変更による差額徴収待ち
  REFUND_PENDING: 'REFUND_PENDING',                           // 注文変更・キャンセルによる返金待ち
  ZERO_DUE: 'ZERO_DUE',                                       // 支払不要（0円）
});

const FulfillmentStatus = Object.freeze({
  WAITING: 'WAITING',     // お渡し待ち
  PARTIAL: 'PARTIAL',     // 一部お渡し済み
  DELIVERED: 'DELIVERED', // お渡し完了
  CANCELLED: 'CANCELLED', // キャンセル
});

const BatchState = Object.freeze({
  STEAMING: 'STEAMING',               // 蒸し中（タイマー満了後・調理未確認の状態も含む）
  CONFIRMED_READY: 'CONFIRMED_READY', // 調理確認済み（引渡し・取り出し案内可能）
});

const WasteReason = Object.freeze({
  DEFECT_HQ: 'DEFECT_HQ',                 // 商品不良 = 本部負担（出店者負担 0円）
  NEGLIGENCE_VENDOR: 'NEGLIGENCE_VENDOR', // 蒸しすぎ等過失 = 出店者負担（250円/個）
});

const ExpenseStatus = Object.freeze({
  UNENTERED: 'UNENTERED', // 未入力（0円確定として扱わない）
  CONFIRMED: 'CONFIRMED', // 入力確定（0円確定を含む）
});

const SteamerType = Object.freeze({
  REGULAR: 'REGULAR',   // 通常せいろ（5個×4段×2セット）
  ELECTRIC: 'ELECTRIC', // 電気せいろ（6個×5段＝30個）
});

const AdviceLevel = Object.freeze({
  ADD_MORE: 'ADD_MORE',       // 追加蒸し推奨
  SMALL_BATCH: 'SMALL_BATCH', // 少量追加推奨
  STOP: 'STOP',               // 追加停止推奨
});

/**
 * 客の特徴タグ候補（数タップで任意選択する案・必須にしない）
 */
const DEFAULT_CUSTOMER_FEATURE_SUGGESTIONS = Object.freeze([
  '赤系服', '黒系服', '白系服', '青系服',
  '帽子', 'メガネ', 'リュック', 'ベビーカー',
  'お子様連れ', '2人組', 'グループ', '常連様',
]);

/**
 * SKUキー（商品ID × 調理方法）を生成するヘルパー
 */
function makeSkuKey(productId, cookingMethod) {
  return `${productId}__${cookingMethod}`;
}

function parseSkuKey(skuKey) {
  const [productId, cookingMethod] = skuKey.split('__');
  return { productId, cookingMethod };
}

/**
 * デフォルトのイベント初期設定を生成する
 * - 豚まん500円/50%は過去条件で再確認が必要（unverified: true）
 * - ポテト配分は本部50%・出店者50%、原価未精査（costUnverified: true）
 * - 電気せいろは5段で6個ずつ（計30個）確定（capacityVerified: true）
 */
function createDefaultEventConfig(overrides = {}) {
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
  // 電気せいろ: 6個×5段×1セット (段番号案 9〜13, 確定)
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
    // 電気せいろ (9〜13): 5段×各6個
    { tierNumber: 9, setId: 'electric-set-1', steamerType: SteamerType.ELECTRIC, capacity: 6, capacityVerified: true, numberingProvisional: true },
    { tierNumber: 10, setId: 'electric-set-1', steamerType: SteamerType.ELECTRIC, capacity: 6, capacityVerified: true, numberingProvisional: true },
    { tierNumber: 11, setId: 'electric-set-1', steamerType: SteamerType.ELECTRIC, capacity: 6, capacityVerified: true, numberingProvisional: true },
    { tierNumber: 12, setId: 'electric-set-1', steamerType: SteamerType.ELECTRIC, capacity: 6, capacityVerified: true, numberingProvisional: true },
    { tierNumber: 13, setId: 'electric-set-1', steamerType: SteamerType.ELECTRIC, capacity: 6, capacityVerified: true, numberingProvisional: true },
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
      electricSteamerCapacity: '電気せいろは5段で6個ずつ（計30個）確定',
      tierNumbering: '1〜4 / 5〜8 / 9〜13 は段番号案であり確定ではない',
      fryingProcess: '揚げ工程の詳細運用は未確認',
      multiDeviceSyncAndNotification: '複数スマホ同期方式・通信切断時・画面非表示中の通知は未検証',
    },
  };
}


// === 2. Service Calculator ===
/**
 * 能美豚饅 蒸し・会計・注文管理システム (v0.2)
 * 無料サービス計算・辞退・本部負担算出ロジック
 *
 * 確定仕様:
 * - 有料まん類(MAN)の合計5個ごとに本部負担で1個サービス（有料数のみで算出、無料品やポテト等は母数に含めない）
 * - 無料品も「まんの種類×蒸し/揚げ」を選べる
 * - イベント単位でサービスON/OFF可能
 * - サービスONでも注文単位で全部または一部を辞退可能
 * - 辞退分は在庫引き当て/減算せず、本部負担のサービス費用にも計上しない
 */



/**
 * 商品カタログをMap化して取得する
 */
function getCatalogMap(eventConfig) {
  const map = new Map();
  for (const item of eventConfig.catalog) {
    map.set(item.productId, item);
  }
  return map;
}

/**
 * 有料明細から「有料まん類合計数」と「付与可能な無料サービス枠数（最大値）」を計算する
 * @param {Array<{productId: string, cookingMethod: string, qty: number}>} paidItems
 * @param {object} eventConfig
 */
function calculateServiceEntitlement(paidItems, eventConfig) {
  const catalogMap = getCatalogMap(eventConfig);
  let paidManTotalQty = 0;
  let paidSideTotalQty = 0;

  for (const item of paidItems) {
    if (!item || item.qty <= 0) continue;
    const product = catalogMap.get(item.productId);
    if (!product || !product.enabled) {
      throw new Error(`取扱対象外または無効な商品です: ${item.productId}`);
    }
    if (!product.allowedMethods.includes(item.cookingMethod)) {
      throw new Error(`商品「${product.name}」は調理方法「${item.cookingMethod}」に対応していません`);
    }
    if (product.category === ProductCategory.MAN) {
      paidManTotalQty += item.qty;
    } else {
      paidSideTotalQty += item.qty;
    }
  }

  if (!eventConfig.serviceEnabled) {
    return {
      serviceEnabled: false,
      paidManTotalQty,
      paidSideTotalQty,
      entitledFreeQty: 0,
    };
  }

  const step = eventConfig.serviceEveryNPaidMan ?? 5;
  const perUnit = eventConfig.serviceFreeCountPerUnit ?? 1;
  const entitledFreeQty = Math.floor(paidManTotalQty / step) * perUnit;

  return {
    serviceEnabled: true,
    paidManTotalQty,
    paidSideTotalQty,
    entitledFreeQty,
  };
}

/**
 * 注文の有料明細・無料選択内訳・辞退設定を検証し、正規化した明細・金額・本部負担サービス費用・必要在庫数を算出する
 *
 * @param {object} params
 * @param {Array<{productId: string, cookingMethod: string, qty: number}>} params.paidItems 有料商品の明細
 * @param {Array<{productId: string, cookingMethod: string, qty: number}>} [params.freeItems] 無料サービスとして選択した内訳
 * @param {boolean} [params.declineAllService] 注文単位で無料サービスを全辞退するか
 * @param {number} [params.declinedFreeQty] 明示的に辞退した個数（省略時は entitledFreeQty - selectedFreeQty を自動辞退扱い）
 * @param {object} eventConfig イベント設定
 */
function evaluateOrderItemsAndService({
  paidItems = [],
  freeItems = [],
  declineAllService = false,
  declinedFreeQty = null,
}, eventConfig) {
  const catalogMap = getCatalogMap(eventConfig);
  const entitlement = calculateServiceEntitlement(paidItems, eventConfig);

  // 有料明細の正規化と金額計算
  const normalizedPaidItems = [];
  let totalPaidAmount = 0;

  for (const item of paidItems) {
    if (!item || item.qty <= 0) continue;
    const product = catalogMap.get(item.productId);
    const subtotal = product.unitPrice * item.qty;
    totalPaidAmount += subtotal;
    normalizedPaidItems.push({
      productId: item.productId,
      productName: product.name,
      category: product.category,
      cookingMethod: item.cookingMethod,
      skuKey: makeSkuKey(item.productId, item.cookingMethod),
      qty: item.qty,
      unitPrice: product.unitPrice,
      subtotal,
      isFreeService: false,
    });
  }

  // 無料明細の検証と正規化
  const effectiveFreeItemsInput = declineAllService ? [] : (freeItems || []);
  const normalizedFreeItems = [];
  let selectedFreeQty = 0;
  let hqServiceCostAmount = 0; // 本部負担サービス費用（実際に提供される無料分のみ計上、辞退分は計上しない）

  for (const item of effectiveFreeItemsInput) {
    if (!item || item.qty <= 0) continue;
    const product = catalogMap.get(item.productId);
    if (!product || !product.enabled) {
      throw new Error(`無料サービス対象外または無効な商品です: ${item.productId}`);
    }
    if (product.category !== ProductCategory.MAN) {
      throw new Error(`無料サービスには「まん類(MAN)」のみ選択可能です（指定: ${product.name}）`);
    }
    if (!product.allowedMethods.includes(item.cookingMethod)) {
      throw new Error(`無料サービス商品「${product.name}」は調理方法「${item.cookingMethod}」に対応していません`);
    }
    selectedFreeQty += item.qty;
    const equivalentValue = product.unitPrice * item.qty;
    hqServiceCostAmount += equivalentValue;
    normalizedFreeItems.push({
      productId: item.productId,
      productName: product.name,
      category: product.category,
      cookingMethod: item.cookingMethod,
      skuKey: makeSkuKey(item.productId, item.cookingMethod),
      qty: item.qty,
      unitPrice: 0,
      referenceUnitPrice: product.unitPrice,
      hqBurdenAmount: equivalentValue, // 本部負担額
      isFreeService: true,
    });
  }

  if (selectedFreeQty > entitlement.entitledFreeQty) {
    throw new Error(
      `無料サービスの選択個数(${selectedFreeQty}個)が付与可能枠(${entitlement.entitledFreeQty}個)を超えています`
    );
  }

  const actualDeclinedFreeQty = entitlement.entitledFreeQty - selectedFreeQty;
  if (declinedFreeQty !== null && declinedFreeQty !== actualDeclinedFreeQty) {
    throw new Error(
      `指定された辞退個数(${declinedFreeQty}個)と、付与枠(${entitlement.entitledFreeQty}個)−選択個数(${selectedFreeQty}個)が一致しません`
    );
  }

  // 在庫引き当て・お渡し対象となる必要数量（SKU別）
  // ※辞退分 (actualDeclinedFreeQty) は含めない（在庫計上しない）
  const requiredBySku = {};
  for (const p of normalizedPaidItems) {
    requiredBySku[p.skuKey] = (requiredBySku[p.skuKey] || 0) + p.qty;
  }
  for (const f of normalizedFreeItems) {
    requiredBySku[f.skuKey] = (requiredBySku[f.skuKey] || 0) + f.qty;
  }

  return {
    paidManTotalQty: entitlement.paidManTotalQty,
    paidSideTotalQty: entitlement.paidSideTotalQty,
    entitledFreeQty: entitlement.entitledFreeQty,
    selectedFreeQty,
    declinedFreeQty: actualDeclinedFreeQty, // 辞退分（在庫・本部負担費用ともに計上しない）
    paidItems: normalizedPaidItems,
    freeItems: normalizedFreeItems,
    totalAmount: totalPaidAmount,
    hqServiceCostAmount, // 本部負担として計上するサービス金額（辞退分は0円）
    requiredBySku,       // 物理在庫として必要なSKU別合計数量（有料＋実選択無料分のみ）
  };
}


// === 3. Store Manager ===
/**
 * 能美豚饅 店舗マネージャー (v0.3 - 4画面タブ＆目標管理対応)
 */

import {
  BatchState,
  CookingMethod,
  FulfillmentStatus,
  PaymentStatus,
  ExpenseStatus,
  WasteReason,
  AdviceLevel,
  makeSkuKey,
  createDefaultEventConfig,
} from './models.js';


class StoreManager {
  /**
   * @param {object} [eventConfig]
   */
  constructor(eventConfig = createDefaultEventConfig()) {
    this.eventConfig = eventConfig;
    this.tiers = new Map();
    for (const tierDef of this.eventConfig.tiers) {
      this.tiers.set(tierDef.tierNumber, {
        ...tierDef,
        batches: [], // 段内の投入バッチ配列
      });
    }

    // 揚げ商品など、せいろ外の調理済み・待機在庫
    this.nonSteamerReadyStock = new Map(); // skuKey -> remainingQty

    this.orders = new Map(); // orderId -> Order
    this.orderSeq = 0;
    this.batchSeq = 0;
    this.correctionSeq = 0;
    this.wasteSeq = 0;

    // 取り出し訂正履歴
    this.tierCorrectionHistory = [];
    // 廃棄記録
    this.wasteRecords = [];
    // 経費
    this.expenseState = {
      status: ExpenseStatus.UNENTERED,
      amount: null,
      items: [],
      note: '',
      updatedAt: null,
    };

    // 営業目標・初期在庫設定
    this.businessPlan = {
      businessHours: {
        startTime: '10:00',
        endTime: '17:00',
      },
      targetSalesCount: {
        butaman: 150,
        anbataman: 80,
        potato: 100,
      },
      initialInventory: {
        butaman: 200,
        anbataman: 100,
        potato: 120,
      },
      forecastHourlyRate: 20, // 1時間あたりの標準想定販売数
    };

    // 状態変更の改訂番号
    this.revision = 1;
    this.kitchenRevision = 0;
    this.orderRevision = 0;
    this.lastUpdatedAt = new Date().toISOString();
  }

  _bumpRevision(timestamp = new Date().toISOString()) {
    this.revision += 1;
    this.lastUpdatedAt = new Date(timestamp).toISOString();
  }

  exportSnapshot() {
    const tiersData = [];
    for (const [tierNumber, tier] of this.tiers.entries()) {
      tiersData.push([tierNumber, structuredClone(tier)]);
    }
    return {
      version: '0.3.0',
      revision: this.revision,
      kitchenRevision: this.kitchenRevision,
      orderRevision: this.orderRevision,
      lastUpdatedAt: this.lastUpdatedAt,
      eventConfig: structuredClone(this.eventConfig),
      businessPlan: structuredClone(this.businessPlan),
      tiers: tiersData,
      nonSteamerReadyStock: Array.from(this.nonSteamerReadyStock.entries()),
      orders: Array.from(this.orders.entries()).map(([k, v]) => [k, structuredClone(v)]),
      orderSeq: this.orderSeq,
      batchSeq: this.batchSeq,
      correctionSeq: this.correctionSeq,
      wasteSeq: this.wasteSeq,
      tierCorrectionHistory: structuredClone(this.tierCorrectionHistory),
      wasteRecords: structuredClone(this.wasteRecords),
      expenseState: structuredClone(this.expenseState),
    };
  }

  importSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
      throw new Error('不正なスナップショットデータです');
    }
    this.revision = snapshot.revision ?? 1;
    this.kitchenRevision = snapshot.kitchenRevision ?? 0;
    this.orderRevision = snapshot.orderRevision ?? 0;
    this.lastUpdatedAt = snapshot.lastUpdatedAt ?? new Date().toISOString();
    if (snapshot.eventConfig) {
      this.eventConfig = structuredClone(snapshot.eventConfig);
    }
    if (snapshot.businessPlan) {
      this.businessPlan = structuredClone(snapshot.businessPlan);
    }
    this.tiers = new Map(structuredClone(snapshot.tiers || []));
    this.nonSteamerReadyStock = new Map(structuredClone(snapshot.nonSteamerReadyStock || []));
    this.orders = new Map(structuredClone(snapshot.orders || []));
    this.orderSeq = snapshot.orderSeq ?? 0;
    this.batchSeq = snapshot.batchSeq ?? 0;
    this.correctionSeq = snapshot.correctionSeq ?? 0;
    this.wasteSeq = snapshot.wasteSeq ?? 0;
    this.tierCorrectionHistory = structuredClone(snapshot.tierCorrectionHistory || []);
    this.wasteRecords = structuredClone(snapshot.wasteRecords || []);
    this.expenseState = structuredClone(
      snapshot.expenseState || {
        status: ExpenseStatus.UNENTERED,
        amount: null,
        items: [],
        note: '',
        updatedAt: null,
      }
    );

    // デフォルトで定義されている tiers の欠落・容量更新があれば安全に補完・同期（バージョンアップ対応）
    const defaultCfg = createDefaultEventConfig();
    if (!this.eventConfig.tiers) this.eventConfig.tiers = [];
    for (const defTier of defaultCfg.tiers) {
      const idx = this.eventConfig.tiers.findIndex((t) => t.tierNumber === defTier.tierNumber);
      if (idx === -1) {
        this.eventConfig.tiers.push(structuredClone(defTier));
      } else if (defTier.setId === 'electric-set-1') {
        this.eventConfig.tiers[idx].capacity = defTier.capacity;
        this.eventConfig.tiers[idx].capacityVerified = defTier.capacityVerified;
      }

      if (!this.tiers.has(defTier.tierNumber)) {
        this.tiers.set(defTier.tierNumber, { ...structuredClone(defTier), batches: [] });
      } else if (defTier.setId === 'electric-set-1') {
        const t = this.tiers.get(defTier.tierNumber);
        t.capacity = defTier.capacity;
        t.capacityVerified = defTier.capacityVerified;
      }
    }

    this._rebalanceReservations();
    return this;
  }

  /**
   * 営業予定・商品価格・在庫等の設定を更新する
   */
  updateBusinessPlan(partialPlan, updatedAt = new Date().toISOString()) {
    if (partialPlan.businessHours) {
      this.businessPlan.businessHours = {
        ...this.businessPlan.businessHours,
        ...partialPlan.businessHours,
      };
    }
    if (partialPlan.targetSalesCount) {
      this.businessPlan.targetSalesCount = {
        ...this.businessPlan.targetSalesCount,
        ...partialPlan.targetSalesCount,
      };
    }
    if (partialPlan.initialInventory) {
      this.businessPlan.initialInventory = {
        ...this.businessPlan.initialInventory,
        ...partialPlan.initialInventory,
      };
    }
    if (typeof partialPlan.forecastHourlyRate === 'number' && partialPlan.forecastHourlyRate >= 0) {
      this.businessPlan.forecastHourlyRate = partialPlan.forecastHourlyRate;
    }
    this._bumpRevision(updatedAt);
    return structuredClone(this.businessPlan);
  }

  updateEventConfig(partialConfig, updatedAt = new Date().toISOString()) {
    if (typeof partialConfig.serviceEnabled === 'boolean') {
      this.eventConfig.serviceEnabled = partialConfig.serviceEnabled;
    }
    if (typeof partialConfig.defaultSteamDurationMinutes === 'number' && partialConfig.defaultSteamDurationMinutes > 0) {
      this.eventConfig.defaultSteamDurationMinutes = partialConfig.defaultSteamDurationMinutes;
    }
    if (typeof partialConfig.vendorNegligencePenaltyPerUnit === 'number' && partialConfig.vendorNegligencePenaltyPerUnit >= 0) {
      this.eventConfig.vendorNegligencePenaltyPerUnit = partialConfig.vendorNegligencePenaltyPerUnit;
    }
    if (Array.isArray(partialConfig.catalog)) {
      this.eventConfig.catalog = structuredClone(partialConfig.catalog);
    }
    if (Array.isArray(partialConfig.tiers)) {
      this.eventConfig.tiers = structuredClone(partialConfig.tiers);
      for (const tierDef of this.eventConfig.tiers) {
        const existing = this.tiers.get(tierDef.tierNumber);
        if (existing) {
          existing.capacity = tierDef.capacity;
          existing.capacityVerified = tierDef.capacityVerified;
          existing.numberingProvisional = tierDef.numberingProvisional;
        } else {
          this.tiers.set(tierDef.tierNumber, { ...tierDef, batches: [] });
        }
      }
    }
    this._bumpRevision(updatedAt);
    return structuredClone(this.eventConfig);
  }

  cancelOrder(orderId, { reason = 'お客様都合キャンセル', cancelledAt = new Date().toISOString() } = {}) {
    const order = this._getOrderOrThrow(orderId);
    if (order.fulfillmentStatus === FulfillmentStatus.DELIVERED) {
      throw new Error(`お渡し完了済みの注文はキャンセルできません: ${orderId}`);
    }
    if (order.fulfillmentStatus === FulfillmentStatus.CANCELLED) {
      return this.getOrder(orderId);
    }

    order.fulfillmentStatus = FulfillmentStatus.CANCELLED;
    order.totalAmount = 0;
    order.hqServiceCostAmount = 0;
    order.reservations = [];
    order.updatedAt = new Date(cancelledAt).toISOString();

    this._updateOrderPaymentStatus(order);
    const guidance = this.getPaymentGuidance(orderId);

    order.history.push({
      timestamp: new Date(cancelledAt).toISOString(),
      type: 'ORDER_CANCELLED',
      reason,
      paymentStatus: order.paymentStatus,
      summary: `注文キャンセル（理由: ${reason} / 会計状態: ${order.paymentStatus}）`,
    });

    this._rebalanceReservations();
    this._bumpRevision(cancelledAt);

    return {
      order: this.getOrder(orderId),
      paymentGuidance: guidance,
    };
  }

  getAllOrders() {
    return Array.from(this.orders.values())
      .map((o) => structuredClone(o))
      .sort((a, b) => b.orderNumber - a.orderNumber);
  }

  // ===========================================================================
  // 1. せいろ・蒸しバッチ管理
  // ===========================================================================

  getTierCurrentOccupancy(tierNumber) {
    const tier = this._getTierOrThrow(tierNumber);
    return tier.batches.reduce((sum, b) => sum + b.remainingQty, 0);
  }

  loadSteamerBatch({
    tierNumber,
    productId,
    qty,
    startedAt = new Date().toISOString(),
    durationMinutes = this.eventConfig.defaultSteamDurationMinutes,
    slotPositions = null,
    note = '',
  }) {
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new Error(`投入個数は1以上の整数である必要があります: ${qty}`);
    }
    const tier = this._getTierOrThrow(tierNumber);
    const catalogMap = getCatalogMap(this.eventConfig);
    const product = catalogMap.get(productId);
    if (!product || !product.enabled) {
      throw new Error(`無効な商品です: ${productId}`);
    }
    if (!product.allowedMethods.includes(CookingMethod.STEAM)) {
      throw new Error(`商品「${product.name}」は蒸し調理に対応していません`);
    }

    const currentOccupancy = this.getTierCurrentOccupancy(tierNumber);
    if (currentOccupancy + qty > tier.capacity) {
      throw new Error(
        `段番号 ${tierNumber} の容量超過です（定員:${tier.capacity}個, 現在:${currentOccupancy}個, 追加:${qty}個）`
      );
    }

    const usedSlots = new Set();
    for (const b of tier.batches) {
      if (b.remainingQty > 0 && Array.isArray(b.slotPositions)) {
        for (const pos of b.slotPositions) usedSlots.add(pos);
      }
    }
    let resolvedSlots = slotPositions;
    if (!resolvedSlots) {
      resolvedSlots = [];
      for (let s = 1; s <= tier.capacity && resolvedSlots.length < qty; s++) {
        if (!usedSlots.has(s)) {
          resolvedSlots.push(s);
        }
      }
      while (resolvedSlots.length < qty) {
        resolvedSlots.push(`slot-${resolvedSlots.length + 1}`);
      }
    }

    const startMs = new Date(startedAt).getTime();
    const readyMs = startMs + durationMinutes * 60 * 1000;

    this.batchSeq += 1;
    const batch = {
      batchId: `BATCH-${String(this.batchSeq).padStart(4, '0')}`,
      tierNumber,
      productId,
      productName: product.name,
      cookingMethod: CookingMethod.STEAM,
      skuKey: makeSkuKey(productId, CookingMethod.STEAM),
      initialQty: qty,
      remainingQty: qty,
      slotPositions: resolvedSlots,
      startedAt: new Date(startMs).toISOString(),
      readyAt: new Date(readyMs).toISOString(),
      durationMinutes,
      state: BatchState.STEAMING,
      confirmedReadyAt: null,
      isMidStreamAddition: currentOccupancy > 0,
      note,
    };

    tier.batches.push(batch);
    this._rebalanceReservations();
    this._bumpRevision(startedAt);
    return structuredClone(batch);
  }

  getSteamerTiersSnapshot(now = new Date().toISOString()) {
    const nowMs = new Date(now).getTime();
    const reservedByBatch = this._getReservedQtyByBatchMap();

    const result = [];
    for (const [tierNumber, tier] of this.tiers.entries()) {
      const activeBatches = tier.batches
        .filter((b) => b.remainingQty > 0)
        .map((b) => {
          const readyMs = new Date(b.readyAt).getTime();
          const remainingSeconds = Math.max(0, Math.ceil((readyMs - nowMs) / 1000));
          const isTimerExpired = nowMs >= readyMs;
          const reservedQty = reservedByBatch.get(b.batchId) || 0;
          const unreservedQty = Math.max(0, b.remainingQty - reservedQty);

          return {
            ...structuredClone(b),
            isTimerExpired,
            remainingSeconds,
            isCookingConfirmed: b.state === BatchState.CONFIRMED_READY,
            reservedQty,
            unreservedQty,
          };
        });

      const totalRemainingQty = activeBatches.reduce((s, b) => s + b.remainingQty, 0);
      const confirmedReadyQty = activeBatches
        .filter((b) => b.state === BatchState.CONFIRMED_READY)
        .reduce((s, b) => s + b.remainingQty, 0);
      const steamingQty = activeBatches
        .filter((b) => b.state === BatchState.STEAMING)
        .reduce((s, b) => s + b.remainingQty, 0);

      result.push({
        tierNumber,
        setId: tier.setId,
        steamerType: tier.steamerType,
        capacity: tier.capacity,
        capacityVerified: tier.capacityVerified,
        numberingProvisional: tier.numberingProvisional,
        isEstimatedInventory: true,
        totalRemainingQty,
        confirmedReadyQty,
        steamingQty,
        availableEmptySlots: tier.capacity - totalRemainingQty,
        batches: activeBatches,
      });
    }
    return result;
  }

  confirmBatchCookingReady(batchId, confirmedAt = new Date().toISOString()) {
    const { batch } = this._findBatchOrThrow(batchId);
    if (batch.remainingQty <= 0) {
      throw new Error(`すでに残数0のバッチは調理確認できません: ${batchId}`);
    }
    batch.state = BatchState.CONFIRMED_READY;
    batch.confirmedReadyAt = new Date(confirmedAt).toISOString();

    this._rebalanceReservations();
    this._bumpRevision(confirmedAt);
    return structuredClone(batch);
  }

  /**
   * スロット直接タップ用：指定段・スロットから豚まんを取り出して空き枠にする
   */
  removeSlotItem({ tierNumber, slotIndex, updatedAt = new Date().toISOString() }) {
    const tier = this._getTierOrThrow(tierNumber);
    for (let i = 0; i < tier.batches.length; i++) {
      const b = tier.batches[i];
      if (b.remainingQty > 0 && Array.isArray(b.slotPositions) && b.slotPositions.includes(slotIndex)) {
        b.remainingQty -= 1;
        b.slotPositions = b.slotPositions.filter((p) => p !== slotIndex);
        this._rebalanceReservations();
        this._bumpRevision(updatedAt);
        return { removed: true, batchId: b.batchId, remainingQty: b.remainingQty, state: b.state };
      }
    }
    return { removed: false };
  }

  /**
   * 段への一括投入（空いている全スロットに投入）
   */
  loadTierFull({ tierNumber, productId = 'butaman', durationMinutes = 40, startedAt = new Date().toISOString() }) {
    const tier = this._getTierOrThrow(tierNumber);
    const currentOccupancy = this.getTierCurrentOccupancy(tierNumber);
    const needed = tier.capacity - currentOccupancy;
    if (needed <= 0) return null;
    return this.loadSteamerBatch({
      tierNumber,
      productId,
      qty: needed,
      durationMinutes,
      startedAt,
    });
  }

  addNonSteamerReadyStock(productId, cookingMethod, qty) {
    if (qty <= 0) throw new Error('追加数量は1以上である必要があります');
    const skuKey = makeSkuKey(productId, cookingMethod);
    const current = this.nonSteamerReadyStock.get(skuKey) || 0;
    this.nonSteamerReadyStock.set(skuKey, current + qty);
    this._rebalanceReservations();
    this._bumpRevision();
    return this.nonSteamerReadyStock.get(skuKey);
  }

  // ===========================================================================
  // 2. 注文・会計管理
  // ===========================================================================

  createOrder({
    paidItems,
    freeItems = [],
    declineAllService = false,
    declinedFreeQty = null,
    customerFeatures = [],
    customerNote = '',
    paymentInput = null,
    createdAt = new Date().toISOString(),
  }) {
    const evalResult = evaluateOrderItemsAndService(
      { paidItems, freeItems, declineAllService, declinedFreeQty },
      this.eventConfig
    );

    this.orderSeq += 1;
    const orderId = `ORD-${String(this.orderSeq).padStart(4, '0')}`;
    const orderNumber = this.orderSeq;

    const deliveredBySku = {};
    for (const skuKey of Object.keys(evalResult.requiredBySku)) {
      deliveredBySku[skuKey] = 0;
    }

    const order = {
      orderId,
      orderNumber,
      createdAt: new Date(createdAt).toISOString(),
      updatedAt: new Date(createdAt).toISOString(),
      paidItems: evalResult.paidItems,
      freeItems: evalResult.freeItems,
      paidManTotalQty: evalResult.paidManTotalQty,
      paidSideTotalQty: evalResult.paidSideTotalQty,
      entitledFreeQty: evalResult.entitledFreeQty,
      selectedFreeQty: evalResult.selectedFreeQty,
      declinedFreeQty: evalResult.declinedFreeQty,
      declineAllService: Boolean(declineAllService),
      totalAmount: evalResult.totalAmount,
      hqServiceCostAmount: evalResult.hqServiceCostAmount,
      requiredBySku: evalResult.requiredBySku,
      deliveredBySku,
      paymentStatus: evalResult.totalAmount === 0 ? PaymentStatus.ZERO_DUE : PaymentStatus.UNPAID,
      paidAmount: 0,
      refundedAmount: 0,
      paymentRecords: [],
      fulfillmentStatus: FulfillmentStatus.WAITING,
      deliveredAt: null,
      reservations: [],
      deliveryPickLogs: [],
      customerFeatures: Array.isArray(customerFeatures) ? [...customerFeatures] : [],
      customerNote: customerNote || '',
      history: [
        {
          timestamp: new Date(createdAt).toISOString(),
          type: 'ORDER_CREATED',
          summary: `注文 #${orderNumber} 作成（合計 ${evalResult.totalAmount}円, 無料枠 ${evalResult.entitledFreeQty}個中 選択${evalResult.selectedFreeQty}個 / 辞退${evalResult.declinedFreeQty}個）`,
        },
      ],
    };

    this.orders.set(orderId, order);

    if (paymentInput && paymentInput.amount > 0) {
      this.recordPayment(orderId, {
        method: paymentInput.method,
        amount: paymentInput.amount,
        recordedAt: paymentInput.paidAt || createdAt,
      });
    } else {
      this._updateOrderPaymentStatus(order);
    }

    this._rebalanceReservations();
    this._bumpRevision(createdAt);

    return this.getOrder(orderId);
  }

  modifyOrder(orderId, {
    paidItems,
    freeItems = [],
    declineAllService = false,
    declinedFreeQty = null,
    modifiedAt = new Date().toISOString(),
    reason = '数量・内容変更',
  }) {
    const order = this._getOrderOrThrow(orderId);
    if (order.fulfillmentStatus === FulfillmentStatus.CANCELLED) {
      throw new Error(`キャンセル済みの注文は変更できません: ${orderId}`);
    }

    const evalResult = evaluateOrderItemsAndService(
      { paidItems, freeItems, declineAllService, declinedFreeQty },
      this.eventConfig
    );

    for (const [skuKey, alreadyDelivered] of Object.entries(order.deliveredBySku)) {
      const newReq = evalResult.requiredBySku[skuKey] || 0;
      if (newReq < alreadyDelivered) {
        throw new Error(
          `SKU(${skuKey}) は既に ${alreadyDelivered}個 お渡し済みのため、${newReq}個 への削減はできません`
        );
      }
    }

    const prevTotalAmount = order.totalAmount;
    const prevPaidItems = structuredClone(order.paidItems);
    const prevFreeItems = structuredClone(order.freeItems);

    order.paidItems = evalResult.paidItems;
    order.freeItems = evalResult.freeItems;
    order.paidManTotalQty = evalResult.paidManTotalQty;
    order.paidSideTotalQty = evalResult.paidSideTotalQty;
    order.entitledFreeQty = evalResult.entitledFreeQty;
    order.selectedFreeQty = evalResult.selectedFreeQty;
    order.declinedFreeQty = evalResult.declinedFreeQty;
    order.declineAllService = Boolean(declineAllService);
    order.totalAmount = evalResult.totalAmount;
    order.hqServiceCostAmount = evalResult.hqServiceCostAmount;
    order.requiredBySku = evalResult.requiredBySku;
    order.updatedAt = new Date(modifiedAt).toISOString();

    for (const skuKey of Object.keys(evalResult.requiredBySku)) {
      if (!(skuKey in order.deliveredBySku)) {
        order.deliveredBySku[skuKey] = 0;
      }
    }

    this._updateOrderPaymentStatus(order);
    this._updateOrderFulfillmentStatus(order);

    const guidance = this.getPaymentGuidance(orderId);

    order.history.push({
      timestamp: new Date(modifiedAt).toISOString(),
      type: 'ORDER_MODIFIED',
      reason,
      prevTotalAmount,
      newTotalAmount: order.totalAmount,
      prevPaidItems,
      newPaidItems: structuredClone(order.paidItems),
      prevFreeItems,
      newFreeItems: structuredClone(order.freeItems),
      paymentStatusAfterModification: order.paymentStatus,
      guidanceSummary: guidance.message,
    });

    this._rebalanceReservations();
    this._bumpRevision(modifiedAt);

    return {
      order: this.getOrder(orderId),
      paymentGuidance: guidance,
    };
  }

  getPaymentGuidance(orderId) {
    const order = this._getOrderOrThrow(orderId);
    const netPaid = order.paidAmount - order.refundedAmount;
    const diff = order.totalAmount - netPaid;

    let actionRequired = 'NONE';
    let additionalCollectionDue = 0;
    let refundDue = 0;
    let message = '会計完了済みです';

    if (diff > 0) {
      actionRequired = netPaid === 0 ? 'INITIAL_PAYMENT' : 'ADDITIONAL_COLLECTION';
      additionalCollectionDue = diff;
      message = netPaid === 0
        ? `お会計 ${diff}円 のお支払い案内中（未入金）`
        : `注文変更に伴う追加徴収 ${diff}円 の案内中`;
    } else if (diff < 0) {
      actionRequired = 'REFUND';
      refundDue = Math.abs(diff);
      message = `注文変更に伴うご返金 ${refundDue}円 の案内中（返金待ち）`;
    }

    return {
      orderId: order.orderId,
      orderNumber: order.orderNumber,
      totalAmount: order.totalAmount,
      paidAmount: order.paidAmount,
      refundedAmount: order.refundedAmount,
      netPaidAmount: netPaid,
      paymentStatus: order.paymentStatus,
      actionRequired,
      additionalCollectionDue,
      refundDue,
      isCompletedByGuidanceDisplay: false,
      message,
    };
  }

  recordPayment(orderId, { method, amount, recordedAt = new Date().toISOString(), note = '' }) {
    const order = this._getOrderOrThrow(orderId);
    if (!Object.values({ CASH: 'CASH', PAYPAY: 'PAYPAY', TOCHITSUKA: 'TOCHITSUKA' }).includes(method)) {
      throw new Error(`未対応の支払手段です: ${method}`);
    }
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error(`入金額は1円以上の整数である必要があります: ${amount}`);
    }

    order.paidAmount += amount;
    order.paymentRecords.push({
      type: 'PAYMENT',
      method,
      amount,
      recordedAt: new Date(recordedAt).toISOString(),
      note,
    });
    order.updatedAt = new Date(recordedAt).toISOString();

    this._updateOrderPaymentStatus(order);

    order.history.push({
      timestamp: new Date(recordedAt).toISOString(),
      type: 'PAYMENT_RECORDED',
      method,
      amount,
      paymentStatus: order.paymentStatus,
      summary: `入金記録: ${method} ${amount}円（状態: ${order.paymentStatus}）`,
    });

    this._bumpRevision(recordedAt);
    return this.getOrder(orderId);
  }

  recordRefund(orderId, { method, amount, recordedAt = new Date().toISOString(), note = '' }) {
    const order = this._getOrderOrThrow(orderId);
    if (!Object.values({ CASH: 'CASH', PAYPAY: 'PAYPAY', TOCHITSUKA: 'TOCHITSUKA' }).includes(method)) {
      throw new Error(`未対応の返金手段です: ${method}`);
    }
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error(`返金額は1円以上の整数である必要があります: ${amount}`);
    }
    const netPaid = order.paidAmount - order.refundedAmount;
    const expectedRefund = netPaid - order.totalAmount;
    if (expectedRefund <= 0) {
      throw new Error(`現在この注文に返金待ち残高はありません`);
    }
    if (amount > expectedRefund) {
      throw new Error(`返金額(${amount}円)が要返金額(${expectedRefund}円)を超えています`);
    }

    order.refundedAmount += amount;
    order.paymentRecords.push({
      type: 'REFUND',
      method,
      amount,
      recordedAt: new Date(recordedAt).toISOString(),
      note,
    });
    order.updatedAt = new Date(recordedAt).toISOString();

    this._updateOrderPaymentStatus(order);

    order.history.push({
      timestamp: new Date(recordedAt).toISOString(),
      type: 'REFUND_RECORDED',
      method,
      amount,
      paymentStatus: order.paymentStatus,
      summary: `返金記録: ${method} ${amount}円（状態: ${order.paymentStatus}）`,
    });

    this._bumpRevision(recordedAt);
    return this.getOrder(orderId);
  }

  updateCustomerFeatures(orderId, { customerFeatures, customerNote }) {
    const order = this._getOrderOrThrow(orderId);
    if (Array.isArray(customerFeatures)) {
      order.customerFeatures = [...customerFeatures];
    }
    if (typeof customerNote === 'string') {
      order.customerNote = customerNote;
    }
    this._bumpRevision();
    return this.getOrder(orderId);
  }

  // ===========================================================================
  // 3. 予約・受渡・段取り出し案内・訂正
  // ===========================================================================

  getPickSuggestionsForOrder(orderId) {
    const order = this._getOrderOrThrow(orderId);
    this._rebalanceReservations();

    const suggestions = [];
    const shortages = [];

    for (const [skuKey, requiredQty] of Object.entries(order.requiredBySku)) {
      const deliveredQty = order.deliveredBySku[skuKey] || 0;
      const neededQty = Math.max(0, requiredQty - deliveredQty);
      if (neededQty === 0) continue;

      const [, cookingMethod] = skuKey.split('__');
      if (cookingMethod === CookingMethod.STEAM) {
        const readyReservations = order.reservations.filter(
          (r) => r.skuKey === skuKey && r.batchState === BatchState.CONFIRMED_READY
        );
        const readyAllocatedQty = readyReservations.reduce((s, r) => s + r.qty, 0);

        for (const r of readyReservations) {
          suggestions.push({
            skuKey,
            productId: r.productId,
            productName: r.productName,
            cookingMethod,
            tierNumber: r.tierNumber,
            batchId: r.batchId,
            slotPositions: r.slotPositions,
            pickQty: r.qty,
            isCookingConfirmed: true,
          });
        }

        if (readyAllocatedQty < neededQty) {
          const steamingReservations = order.reservations.filter(
            (r) => r.skuKey === skuKey && r.batchState === BatchState.STEAMING
          );
          const steamingAllocatedQty = steamingReservations.reduce((s, r) => s + r.qty, 0);
          shortages.push({
            skuKey,
            neededQty,
            readyAllocatedQty,
            steamingReservedQty: steamingAllocatedQty,
            unallocatedShortageQty: Math.max(0, neededQty - readyAllocatedQty - steamingAllocatedQty),
          });
        }
      } else {
        const readyStock = this.nonSteamerReadyStock.get(skuKey) || 0;
        const pickable = Math.min(neededQty, readyStock);
        if (pickable > 0) {
          suggestions.push({
            skuKey,
            cookingMethod,
            tierNumber: null,
            batchId: null,
            pickQty: pickable,
            isCookingConfirmed: true,
          });
        }
        if (pickable < neededQty) {
          shortages.push({
            skuKey,
            neededQty,
            readyAllocatedQty: pickable,
            steamingReservedQty: 0,
            unallocatedShortageQty: neededQty - pickable,
          });
        }
      }
    }

    return {
      orderId: order.orderId,
      orderNumber: order.orderNumber,
      canCompleteImmediately: shortages.length === 0,
      suggestions,
      shortages,
    };
  }

  completeOrderDelivery(orderId, { deliveredAt = new Date().toISOString() } = {}) {
    const order = this._getOrderOrThrow(orderId);
    if (order.fulfillmentStatus === FulfillmentStatus.DELIVERED) {
      throw new Error(`注文 ${orderId} は既にお渡し完了しているため、二重減算できません`);
    }
    if (order.fulfillmentStatus === FulfillmentStatus.CANCELLED) {
      throw new Error(`キャンセル済みの注文はお渡し完了できません: ${orderId}`);
    }

    const pickPlan = this.getPickSuggestionsForOrder(orderId);
    if (!pickPlan.canCompleteImmediately) {
      throw new Error(
        `調理確認済みの引渡し可能在庫が不足しているためお渡し完了できません: ${JSON.stringify(pickPlan.shortages)}`
      );
    }

    const executedPicks = [];
    for (const suggestion of pickPlan.suggestions) {
      if (suggestion.cookingMethod === CookingMethod.STEAM) {
        const { batch } = this._findBatchOrThrow(suggestion.batchId);
        if (batch.state !== BatchState.CONFIRMED_READY) {
          throw new Error(`調理未確認のバッチ(${batch.batchId})からはお渡し減算できません`);
        }
        if (batch.remainingQty < suggestion.pickQty) {
          throw new Error(`バッチ(${batch.batchId})の残数不足です`);
        }
        batch.remainingQty -= suggestion.pickQty;

        const pickLog = {
          pickLogId: `PICK-${order.orderNumber}-${executedPicks.length + 1}`,
          orderId: order.orderId,
          orderNumber: order.orderNumber,
          skuKey: suggestion.skuKey,
          productId: batch.productId,
          productName: batch.productName,
          tierNumber: batch.tierNumber,
          batchId: batch.batchId,
          qty: suggestion.pickQty,
          deliveredAt: new Date(deliveredAt).toISOString(),
        };
        order.deliveryPickLogs.push(pickLog);
        executedPicks.push(pickLog);
      } else {
        const current = this.nonSteamerReadyStock.get(suggestion.skuKey) || 0;
        if (current < suggestion.pickQty) {
          throw new Error(`在庫(${suggestion.skuKey})が不足しています`);
        }
        this.nonSteamerReadyStock.set(suggestion.skuKey, current - suggestion.pickQty);
        const pickLog = {
          pickLogId: `PICK-${order.orderNumber}-${executedPicks.length + 1}`,
          orderId: order.orderId,
          orderNumber: order.orderNumber,
          skuKey: suggestion.skuKey,
          tierNumber: null,
          batchId: null,
          qty: suggestion.pickQty,
          deliveredAt: new Date(deliveredAt).toISOString(),
        };
        order.deliveryPickLogs.push(pickLog);
        executedPicks.push(pickLog);
      }

      order.deliveredBySku[suggestion.skuKey] =
        (order.deliveredBySku[suggestion.skuKey] || 0) + suggestion.pickQty;
    }

    order.reservations = [];
    order.deliveredAt = new Date(deliveredAt).toISOString();
    order.updatedAt = new Date(deliveredAt).toISOString();
    this._updateOrderFulfillmentStatus(order);

    order.history.push({
      timestamp: new Date(deliveredAt).toISOString(),
      type: 'DELIVERY_COMPLETED',
      picks: structuredClone(executedPicks),
      summary: `お渡し完了（自動減算: ${executedPicks
        .map((p) => (p.tierNumber ? `${p.tierNumber}段目×${p.qty}個` : `${p.skuKey}×${p.qty}個`))
        .join(', ')}）`,
    });

    this._rebalanceReservations();
    this._bumpRevision(deliveredAt);

    return {
      order: this.getOrder(orderId),
      executedPicks,
    };
  }

  correctTierPick({
    orderId = null,
    fromTierNumber,
    toTierNumber,
    productId = null,
    qty = 1,
    correctedAt = new Date().toISOString(),
    reason = '別段からの取り出しによる段付け替え訂正',
  }) {
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new Error(`訂正個数は1以上の整数である必要があります: ${qty}`);
    }
    if (fromTierNumber === toTierNumber) {
      throw new Error('訂正元の段と訂正先の段が同じです');
    }

    const targetOrder = orderId
      ? this._getOrderOrThrow(orderId)
      : this._getLatestDeliveredOrderOrThrow();

    const pickLog = targetOrder.deliveryPickLogs.find(
      (log) =>
        log.tierNumber === fromTierNumber &&
        log.qty >= qty &&
        (productId === null || log.productId === productId)
    );
    if (!pickLog) {
      throw new Error(
        `注文(${targetOrder.orderId})に段番号 ${fromTierNumber} から ${qty}個以上取り出した記録が見つかりません`
      );
    }

    const { batch: fromBatch, tier: fromTier } = this._findBatchOrThrow(pickLog.batchId);
    const toTier = this._getTierOrThrow(toTierNumber);

    const toBatch = toTier.batches.find(
      (b) =>
        b.skuKey === pickLog.skuKey &&
        b.state === BatchState.CONFIRMED_READY &&
        b.remainingQty >= qty
    );
    if (!toBatch) {
      throw new Error(
        `訂正先の段番号 ${toTierNumber} に、商品(${pickLog.skuKey})の調理確認済み残数(${qty}個以上)がありません`
      );
    }

    const fromOccupancy = this.getTierCurrentOccupancy(fromTier.tierNumber);
    if (fromOccupancy + qty > fromTier.capacity) {
      throw new Error(`訂正元の段番号 ${fromTierNumber} の定員を超えるため残数を戻せません`);
    }

    fromBatch.remainingQty += qty;
    toBatch.remainingQty -= qty;

    if (pickLog.qty === qty) {
      pickLog.tierNumber = toTierNumber;
      pickLog.batchId = toBatch.batchId;
      pickLog.correctedAt = new Date(correctedAt).toISOString();
    } else {
      pickLog.qty -= qty;
      targetOrder.deliveryPickLogs.push({
        pickLogId: `${pickLog.pickLogId}-CORR`,
        orderId: targetOrder.orderId,
        orderNumber: targetOrder.orderNumber,
        skuKey: pickLog.skuKey,
        productId: pickLog.productId,
        productName: pickLog.productName,
        tierNumber: toTierNumber,
        batchId: toBatch.batchId,
        qty,
        deliveredAt: pickLog.deliveredAt,
        correctedAt: new Date(correctedAt).toISOString(),
      });
    }

    this.correctionSeq += 1;
    const correctionRecord = {
      correctionId: `CORR-${String(this.correctionSeq).padStart(4, '0')}`,
      orderId: targetOrder.orderId,
      orderNumber: targetOrder.orderNumber,
      skuKey: pickLog.skuKey,
      productId: pickLog.productId,
      qty,
      fromTierNumber,
      fromBatchId: fromBatch.batchId,
      toTierNumber,
      toBatchId: toBatch.batchId,
      reason,
      correctedAt: new Date(correctedAt).toISOString(),
    };

    this.tierCorrectionHistory.push(correctionRecord);
    targetOrder.history.push({
      timestamp: new Date(correctedAt).toISOString(),
      type: 'TIER_PICK_CORRECTED',
      correction: structuredClone(correctionRecord),
      summary: `段取り出し訂正: ${fromTierNumber}段目 → ${toTierNumber}段目 (${qty}個付け替え)`,
    });

    this._rebalanceReservations();
    this._bumpRevision(correctedAt);

    return structuredClone(correctionRecord);
  }

  // ===========================================================================
  // 4. 待ち注文・廃棄・経費・データ管理／予想進捗（％）
  // ===========================================================================

  getWaitingOrders() {
    const list = [];
    for (const order of this.orders.values()) {
      const isFulfillmentPending =
        order.fulfillmentStatus === FulfillmentStatus.WAITING ||
        order.fulfillmentStatus === FulfillmentStatus.PARTIAL;
      const isPaymentPending =
        order.paymentStatus === PaymentStatus.UNPAID ||
        order.paymentStatus === PaymentStatus.ADDITIONAL_COLLECTION_PENDING ||
        order.paymentStatus === PaymentStatus.REFUND_PENDING;

      if (order.fulfillmentStatus !== FulfillmentStatus.CANCELLED && (isFulfillmentPending || isPaymentPending)) {
        list.push(this.getOrder(order.orderId));
      }
    }
    return list;
  }

  recordWaste({
    productId,
    cookingMethod = CookingMethod.STEAM,
    qty,
    reasonType,
    batchId = null,
    note = '',
    recordedAt = new Date().toISOString(),
  }) {
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new Error(`廃棄個数は1以上の整数である必要があります: ${qty}`);
    }
    if (reasonType !== WasteReason.DEFECT_HQ && reasonType !== WasteReason.NEGLIGENCE_VENDOR) {
      throw new Error(`不正な廃棄区分です: ${reasonType}`);
    }

    if (batchId) {
      const { batch } = this._findBatchOrThrow(batchId);
      if (batch.remainingQty < qty) {
        throw new Error(`廃棄対象バッチ(${batchId})の残数(${batch.remainingQty})が廃棄数(${qty})より少ないです`);
      }
      batch.remainingQty -= qty;
    }

    const penaltyPerUnit =
      reasonType === WasteReason.NEGLIGENCE_VENDOR
        ? this.eventConfig.vendorNegligencePenaltyPerUnit
        : 0;
    const vendorPenaltyAmount = penaltyPerUnit * qty;

    this.wasteSeq += 1;
    const record = {
      wasteId: `WASTE-${String(this.wasteSeq).padStart(4, '0')}`,
      productId,
      cookingMethod,
      qty,
      reasonType,
      burdenParty: reasonType === WasteReason.DEFECT_HQ ? 'HQ' : 'VENDOR',
      vendorPenaltyUnitAmount: penaltyPerUnit,
      vendorPenaltyAmount,
      batchId,
      note,
      recordedAt: new Date(recordedAt).toISOString(),
    };

    this.wasteRecords.push(record);
    this._rebalanceReservations();
    this._bumpRevision(recordedAt);
    return structuredClone(record);
  }

  setExpense({ amount = null, items = [], note = '', clearToUnentered = false, updatedAt = new Date().toISOString() }) {
    if (clearToUnentered || amount === null || amount === undefined) {
      this.expenseState = {
        status: ExpenseStatus.UNENTERED,
        amount: null,
        items: [],
        note: note || '',
        updatedAt: new Date(updatedAt).toISOString(),
      };
      this._bumpRevision(updatedAt);
      return structuredClone(this.expenseState);
    }

    if (typeof amount !== 'number' || amount < 0) {
      throw new Error(`経費金額は0以上の数値である必要があります: ${amount}`);
    }

    this.expenseState = {
      status: ExpenseStatus.CONFIRMED,
      amount,
      items: structuredClone(items),
      note: note || '',
      updatedAt: new Date(updatedAt).toISOString(),
    };
    this._bumpRevision(updatedAt);
    return structuredClone(this.expenseState);
  }

  getSettlementSummary() {
    const catalogMap = getCatalogMap(this.eventConfig);
    let grossSalesAmount = 0;
    let hqGrossShareAmount = 0;
    let vendorGrossShareAmount = 0;

    let totalEntitledFreeQty = 0;
    let totalProvidedFreeQty = 0;
    let totalDeclinedFreeQty = 0;
    let hqFreeServiceCostAmount = 0;

    for (const order of this.orders.values()) {
      if (order.fulfillmentStatus === FulfillmentStatus.CANCELLED) continue;

      totalEntitledFreeQty += order.entitledFreeQty;
      totalProvidedFreeQty += order.selectedFreeQty;
      totalDeclinedFreeQty += order.declinedFreeQty;
      hqFreeServiceCostAmount += order.hqServiceCostAmount;

      for (const item of order.paidItems) {
        const product = catalogMap.get(item.productId);
        grossSalesAmount += item.subtotal;
        hqGrossShareAmount += Math.round(item.subtotal * (product?.hqShareRate ?? 0.5));
        vendorGrossShareAmount += Math.round(item.subtotal * (product?.vendorShareRate ?? 0.5));
      }
    }

    const defectHqWasteQty = this.wasteRecords
      .filter((w) => w.reasonType === WasteReason.DEFECT_HQ)
      .reduce((s, w) => s + w.qty, 0);
    const negligenceVendorWasteQty = this.wasteRecords
      .filter((w) => w.reasonType === WasteReason.NEGLIGENCE_VENDOR)
      .reduce((s, w) => s + w.qty, 0);
    const negligenceVendorPenaltyAmount = this.wasteRecords
      .filter((w) => w.reasonType === WasteReason.NEGLIGENCE_VENDOR)
      .reduce((s, w) => s + w.vendorPenaltyAmount, 0);

    const isExpenseEntered = this.expenseState.status === ExpenseStatus.CONFIRMED;

    return {
      grossSalesAmount,
      hqGrossShareAmount,
      vendorGrossShareAmount,
      serviceSummary: {
        totalEntitledFreeQty,
        totalProvidedFreeQty,
        totalDeclinedFreeQty,
        hqFreeServiceCostAmount,
      },
      wasteSummary: {
        defectHqWasteQty,
        negligenceVendorWasteQty,
        negligenceVendorPenaltyAmount,
      },
      expenseSummary: {
        status: this.expenseState.status,
        isZeroConfirmed: isExpenseEntered && this.expenseState.amount === 0,
        amount: this.expenseState.amount,
      },
      vendorNetBeforeExpense: vendorGrossShareAmount - negligenceVendorPenaltyAmount,
      vendorNetAfterExpense: isExpenseEntered
        ? vendorGrossShareAmount - negligenceVendorPenaltyAmount - this.expenseState.amount
        : null,
      unverifiedFlags: {
        butamanPriceAndShareUnverified: true,
        potatoCostUnverified: true,
      },
    };
  }

  /**
   * データ管理画面用：目標・実績進捗率(%)・販売予想個数分析
   */
  getAnalyticsDashboard() {
    const settlement = this.getSettlementSummary();
    const target = this.businessPlan.targetSalesCount;
    const initial = this.businessPlan.initialInventory;

    // 商品別実績販売個数
    const actualSold = { butaman: 0, anbataman: 0, potato: 0 };
    for (const order of this.orders.values()) {
      if (order.fulfillmentStatus === FulfillmentStatus.CANCELLED) continue;
      for (const item of order.paidItems) {
        if (actualSold[item.productId] !== undefined) {
          actualSold[item.productId] += item.qty;
        }
      }
      for (const item of order.freeItems) {
        if (actualSold[item.productId] !== undefined) {
          actualSold[item.productId] += item.qty;
        }
      }
    }

    // 商品別分析
    const productStats = {};
    for (const prod of this.eventConfig.catalog) {
      const pid = prod.productId;
      const sold = actualSold[pid] || 0;
      const targetCount = target[pid] || 100;
      const initStock = initial[pid] || 150;

      // 目標達成率（％）
      const progressPercent = Math.min(999, Math.round((sold / Math.max(1, targetCount)) * 100));

      // 廃棄数
      const wasteQty = this.wasteRecords
        .filter((w) => w.productId === pid)
        .reduce((sum, w) => sum + w.qty, 0);

      // 残り在庫推計
      const remainingStock = Math.max(0, initStock - sold - wasteQty);
      const inventoryConsumePercent = Math.min(100, Math.round(((sold + wasteQty) / Math.max(1, initStock)) * 100));

      productStats[pid] = {
        name: prod.name,
        unitPrice: prod.unitPrice,
        soldCount: sold,
        targetCount,
        progressPercent,
        initialInventory: initStock,
        wasteCount: wasteQty,
        remainingInventory: remainingStock,
        inventoryConsumePercent,
      };
    }

    // 全体予想と助言
    const totalSold = Object.values(actualSold).reduce((a, b) => a + b, 0);
    const totalTarget = Object.values(target).reduce((a, b) => a + b, 0);
    const overallProgressPercent = Math.min(999, Math.round((totalSold / Math.max(1, totalTarget)) * 100));

    // 蒸し器の助言
    const steamAdvice = this.getSteamingAdvice({ forecastNextHourDemandQty: this.businessPlan.forecastHourlyRate });

    return {
      businessHours: this.businessPlan.businessHours,
      overallProgressPercent,
      totalSold,
      totalTarget,
      settlement,
      productStats,
      steamAdvice,
    };
  }

  getSteamingAdvice({ forecastNextHourDemandQty = 15 } = {}) {
    let waitingRequiredSteamQty = 0;
    let deliveredSteamQty = 0;

    for (const order of this.orders.values()) {
      if (order.fulfillmentStatus === FulfillmentStatus.CANCELLED) continue;
      for (const [skuKey, reqQty] of Object.entries(order.requiredBySku)) {
        const [, method] = skuKey.split('__');
        if (method !== CookingMethod.STEAM) continue;
        const deliv = order.deliveredBySku[skuKey] || 0;
        waitingRequiredSteamQty += Math.max(0, reqQty - deliv);
        deliveredSteamQty += deliv;
      }
    }

    let confirmedReadySteamQty = 0;
    let steamingInProgressQty = 0;
    for (const tier of this.tiers.values()) {
      for (const b of tier.batches) {
        if (b.remainingQty <= 0) continue;
        if (b.state === BatchState.CONFIRMED_READY) {
          confirmedReadySteamQty += b.remainingQty;
        } else {
          steamingInProgressQty += b.remainingQty;
        }
      }
    }

    const totalPipelineSupplyQty = confirmedReadySteamQty + steamingInProgressQty;
    const netAvailableAfterWaitingActuals = totalPipelineSupplyQty - waitingRequiredSteamQty;

    const projectedShortageOrSurplus = netAvailableAfterWaitingActuals - forecastNextHourDemandQty;

    let recommendation = AdviceLevel.SMALL_BATCH;
    let reason = '';
    if (projectedShortageOrSurplus <= -5) {
      recommendation = AdviceLevel.ADD_MORE;
      reason = '実績の有効供給数に対し、予測需要が5個以上不足しています（追加蒸し推奨）';
    } else if (projectedShortageOrSurplus >= 10) {
      recommendation = AdviceLevel.STOP;
      reason = '実績の有効供給数が予測需要に対し10個以上余剰です（蒸しすぎ防止のため停止推奨）';
    } else {
      recommendation = AdviceLevel.SMALL_BATCH;
      reason = '需要と供給が概ね均衡しています（状況を見ながら少量追加）';
    }

    return {
      actuals: {
        deliveredSteamQty,
        waitingRequiredSteamQty,
        confirmedReadySteamQty,
        steamingInProgressQty,
        totalPipelineSupplyQty,
        netAvailableAfterWaitingActuals,
      },
      forecast: {
        forecastNextHourDemandQty,
        projectedBalanceQty: projectedShortageOrSurplus,
      },
      recommendation,
      reason,
    };
  }

  getOrder(orderId) {
    const order = this._getOrderOrThrow(orderId);
    return structuredClone(order);
  }

  _rebalanceReservations() {
    const activeOrders = Array.from(this.orders.values())
      .filter(
        (o) =>
          o.fulfillmentStatus === FulfillmentStatus.WAITING ||
          o.fulfillmentStatus === FulfillmentStatus.PARTIAL
      )
      .sort((a, b) => a.orderNumber - b.orderNumber);

    for (const order of activeOrders) {
      order.reservations = [];
    }

    const allBatches = [];
    for (const tier of this.tiers.values()) {
      for (const batch of tier.batches) {
        if (batch.remainingQty > 0) {
          allBatches.push(batch);
        }
      }
    }

    allBatches.sort((a, b) => {
      if (a.state !== b.state) {
        return a.state === BatchState.CONFIRMED_READY ? -1 : 1;
      }
      const timeDiff = new Date(a.readyAt).getTime() - new Date(b.readyAt).getTime();
      if (timeDiff !== 0) return timeDiff;
      return a.batchId.localeCompare(b.batchId);
    });

    const batchAvailableMap = new Map();
    for (const b of allBatches) {
      batchAvailableMap.set(b.batchId, b.remainingQty);
    }

    for (const order of activeOrders) {
      for (const [skuKey, requiredQty] of Object.entries(order.requiredBySku)) {
        const [, method] = skuKey.split('__');
        if (method !== CookingMethod.STEAM) continue;

        const deliveredQty = order.deliveredBySku[skuKey] || 0;
        let remainingToReserve = Math.max(0, requiredQty - deliveredQty);
        if (remainingToReserve <= 0) continue;

        for (const batch of allBatches) {
          if (batch.skuKey !== skuKey) continue;
          const avail = batchAvailableMap.get(batch.batchId) || 0;
          if (avail <= 0) continue;

          const alloc = Math.min(remainingToReserve, avail);
          batchAvailableMap.set(batch.batchId, avail - alloc);
          remainingToReserve -= alloc;

          order.reservations.push({
            batchId: batch.batchId,
            tierNumber: batch.tierNumber,
            skuKey: batch.skuKey,
            productId: batch.productId,
            productName: batch.productName,
            slotPositions: [...batch.slotPositions],
            qty: alloc,
            batchState: batch.state,
          });

          if (remainingToReserve === 0) break;
        }
      }
    }
  }

  _getReservedQtyByBatchMap() {
    const map = new Map();
    for (const order of this.orders.values()) {
      if (
        order.fulfillmentStatus !== FulfillmentStatus.WAITING &&
        order.fulfillmentStatus !== FulfillmentStatus.PARTIAL
      ) {
        continue;
      }
      for (const r of order.reservations) {
        map.set(r.batchId, (map.get(r.batchId) || 0) + r.qty);
      }
    }
    return map;
  }

  _updateOrderPaymentStatus(order) {
    const netPaid = order.paidAmount - order.refundedAmount;
    if (order.totalAmount === 0 && netPaid === 0) {
      order.paymentStatus = PaymentStatus.ZERO_DUE;
    } else if (netPaid === 0 && order.totalAmount > 0) {
      order.paymentStatus = PaymentStatus.UNPAID;
    } else if (netPaid < order.totalAmount) {
      order.paymentStatus = PaymentStatus.ADDITIONAL_COLLECTION_PENDING;
    } else if (netPaid > order.totalAmount) {
      order.paymentStatus = PaymentStatus.REFUND_PENDING;
    } else {
      order.paymentStatus = PaymentStatus.PAID;
    }
  }

  _updateOrderFulfillmentStatus(order) {
    let totalRequired = 0;
    let totalDelivered = 0;
    for (const [skuKey, reqQty] of Object.entries(order.requiredBySku)) {
      totalRequired += reqQty;
      totalDelivered += order.deliveredBySku[skuKey] || 0;
    }

    if (totalRequired > 0 && totalDelivered >= totalRequired) {
      order.fulfillmentStatus = FulfillmentStatus.DELIVERED;
    } else if (totalDelivered > 0) {
      order.fulfillmentStatus = FulfillmentStatus.PARTIAL;
    } else {
      order.fulfillmentStatus = FulfillmentStatus.WAITING;
    }
  }

  _getTierOrThrow(tierNumber) {
    const tier = this.tiers.get(tierNumber);
    if (!tier) {
      throw new Error(`存在しないせいろ段番号です: ${tierNumber}`);
    }
    return tier;
  }

  _findBatchOrThrow(batchId) {
    for (const tier of this.tiers.values()) {
      const batch = tier.batches.find((b) => b.batchId === batchId);
      if (batch) return { batch, tier };
    }
    throw new Error(`存在しないバッチIDです: ${batchId}`);
  }

  _getOrderOrThrow(orderId) {
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error(`存在しない注文IDです: ${orderId}`);
    }
    return order;
  }

  _getLatestDeliveredOrderOrThrow() {
    const deliveredOrders = Array.from(this.orders.values())
      .filter((o) => o.deliveryPickLogs.length > 0)
      .sort((a, b) => {
        const tA = new Date(a.deliveredAt || a.updatedAt).getTime();
        const tB = new Date(b.deliveredAt || b.updatedAt).getTime();
        if (tA !== tB) return tB - tA;
        return b.orderNumber - a.orderNumber;
      });

    if (deliveredOrders.length === 0) {
      throw new Error('お渡し完了済みの直前注文が存在しません');
    }
    return deliveredOrders[0];
  }
}


// === 4. App Controller ===
/**
 * 能美豚饅 蒸し・会計・注文管理システム (v0.2)
 * フロントエンド UI コントローラー（せいろ透視ワイヤーフレーム・会計・注文・同期連携）
 */



const STORAGE_KEY = 'nomi_butaman_store_snapshot_v02';
const DEVICE_ID_KEY = 'nomi_butaman_device_id';
const BACKUP_KEY = 'nomi_butaman_conflict_backups';
const RETRY_INTERVAL_MS = 3000;

// 端末IDは保存して再読み込み後も同じ端末として扱う（ロール担当の継続のため）
function loadOrCreateDeviceId() {
  try {
    const saved = localStorage.getItem(DEVICE_ID_KEY);
    if (saved) return saved;
    const created = `dev-${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(DEVICE_ID_KEY, created);
    return created;
  } catch {
    return `dev-${Math.random().toString(36).slice(2, 8)}`;
  }
}
const DEVICE_ID = loadOrCreateDeviceId();

const store = new StoreManager();

// 同期の状態
// - kitchenDeviceId / orderDeviceId: サーバーで認識されている各ロールの担当端末
// - kitchenRev / orderRev: 各ドメインごとの確定リビジョン
// - dirtyKitchen / dirtyOrder: ドメイン別の未送信変更フラグ
const syncState = {
  serverMode: false,
  online: false,
  serverRev: 0,
  kitchenRev: 0,
  orderRev: 0,
  lastServerSnapshot: null,
  kitchenDeviceId: null,
  orderDeviceId: null,
  dirtyKitchen: false,
  dirtyOrder: false,
  inFlight: false,
  retryTimer: null,
  lastSyncedAt: null,
  lastConflictAt: null,
};

// 注文入力フォームの一時状態
let formState = {
  editingOrderId: null,
  paidQtyBySku: {}, // skuKey -> number
  freeQtyBySku: {}, // skuKey -> number
  declineAllService: false,
  selectedFeatures: new Set(),
  customerNote: '',
};

// 蒸し器 3Dアイソメトリック操作の状態
let activeSteamerSetId = 'regular-set-1';
let activeSteamerProductId = 'butaman';

let suppressSuccessToastUntil = 0;

function showToast(msg, isError = false) {
  if (!isError && Date.now() < suppressSuccessToastUntil) return;
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'toast';
  if (isError) {
    el.style.borderColor = '#ff3b6b';
    el.style.color = '#ffc2d1';
  }
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3600);
}

function canWriteKitchen() {
  return true; // 1人設定・快適オペレーションのため常に操作可能
}

function canWriteOrder() {
  return true; // 1人設定・快適オペレーションのため常に操作可能
}

function myCurrentRole() {
  return 'both'; // 常に両方操作可能
}

function saveLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store.exportSnapshot()));
  } catch {
    // ignore
  }
}

function backupLocalSnapshot(reason) {
  try {
    const list = JSON.parse(localStorage.getItem(BACKUP_KEY) || '[]');
    list.unshift({ savedAt: new Date().toISOString(), reason, deviceId: DEVICE_ID, snapshot: store.exportSnapshot() });
    localStorage.setItem(BACKUP_KEY, JSON.stringify(list.slice(0, 5)));
  } catch {
    // ignore
  }
}

function adoptServerSnapshot(snapshot, revision, kitchenRev, orderRev) {
  if (snapshot) {
    store.importSnapshot(snapshot);
  } else {
    store.importSnapshot(new StoreManager().exportSnapshot());
  }
  syncState.serverRev = revision ?? snapshot?.revision ?? 0;
  syncState.kitchenRev = kitchenRev ?? snapshot?.kitchenRevision ?? syncState.serverRev;
  syncState.orderRev = orderRev ?? snapshot?.orderRevision ?? syncState.serverRev;
  syncState.lastServerSnapshot = snapshot ? JSON.parse(JSON.stringify(snapshot)) : null;
  saveLocal();
}

/**
 * 状態保存とサーバー送信（ドメイン別）
 * @param {'kitchen' | 'order' | 'both'} domain 操作の種類
 */
function persistAndSync(domain = 'both') {
  const needK = domain === 'kitchen' || domain === 'both';
  const needO = domain === 'order' || domain === 'both';

  const allowedK = needK ? canWriteKitchen() : true;
  const allowedO = needO ? canWriteOrder() : true;

  if (!allowedK || !allowedO) {
    // 権限がない操作はサーバー確定データへ戻す
    adoptServerSnapshot(syncState.lastServerSnapshot, syncState.serverRev, syncState.kitchenRev, syncState.orderRev);
    const missing = !allowedK && !allowedO ? '注文係・キッチン係' : !allowedK ? 'キッチン係' : '注文係';
    showToast(`この操作には【${missing}】の担当権限が必要です。上部のボタンで担当を変更してください`, true);
    suppressSuccessToastUntil = Date.now() + 800;
    renderAll();
    return;
  }

  saveLocal();
  if (needK) syncState.dirtyKitchen = true;
  if (needO) syncState.dirtyOrder = true;

  flushToServer();
  renderAll();
}

async function flushToServer() {
  if (syncState.inFlight) return;
  if (!syncState.dirtyKitchen && !syncState.dirtyOrder) return;

  syncState.inFlight = true;
  const sendKitchen = syncState.dirtyKitchen && canWriteKitchen();
  const sendOrder = syncState.dirtyOrder && canWriteOrder();

  let domain = 'all';
  if (sendKitchen && !sendOrder) domain = 'kitchen';
  else if (!sendKitchen && sendOrder) domain = 'order';
  else if (sendKitchen && sendOrder) domain = 'all';
  else {
    // 担当権限がない未送信がある場合
    syncState.dirtyKitchen = false;
    syncState.dirtyOrder = false;
    syncState.inFlight = false;
    renderAll();
    return;
  }

  const snapshot = store.exportSnapshot();
  let retry = false;

  try {
    const res = await fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: DEVICE_ID,
        domain,
        baseRevision: syncState.serverRev,
        baseKitchenRevision: syncState.kitchenRev,
        baseOrderRevision: syncState.orderRev,
        snapshot,
      }),
    });
    const data = await res.json();
    syncState.online = true;
    syncState.serverMode = true;
    if (data.kitchenDeviceId !== undefined) syncState.kitchenDeviceId = data.kitchenDeviceId;
    if (data.orderDeviceId !== undefined) syncState.orderDeviceId = data.orderDeviceId;

    if (data.ok) {
      if (domain === 'kitchen' || domain === 'all') syncState.dirtyKitchen = false;
      if (domain === 'order' || domain === 'all') syncState.dirtyOrder = false;

      syncState.serverRev = data.revision;
      if (data.kitchenRevision) syncState.kitchenRev = data.kitchenRevision;
      if (data.orderRevision) syncState.orderRev = data.orderRevision;
      store.revision = data.revision;
      syncState.lastServerSnapshot = { ...snapshot, revision: data.revision };
      syncState.lastSyncedAt = new Date().toISOString();
      saveLocal();
    } else if (data.code === 'NO_KITCHEN_ROLE' || data.code === 'NO_ORDER_ROLE') {
      // ロール未割り当てなら自動担当試行
      const roleWanted = domain === 'all' ? 'both' : domain;
      await claimRole(roleWanted, false, { keepLocal: true });
    } else if (data.code && data.code.startsWith('CONFLICT')) {
      backupLocalSnapshot(data.code);
      adoptServerSnapshot(data.snapshot, data.revision);
      if (domain === 'kitchen' || domain === 'all') syncState.dirtyKitchen = false;
      if (domain === 'order' || domain === 'all') syncState.dirtyOrder = false;
      syncState.lastConflictAt = new Date().toISOString();
      showToast('他の端末の最新更新を反映しました。画面をご確認ください', true);
    } else if (data.code && data.code.startsWith('READ_ONLY')) {
      // 1人運用のスムーズな操作のため自動で担当を獲得して再送
      await claimRole('both', true, { keepLocal: true });
      retry = true;
    } else {
      retry = true;
    }
  } catch {
    syncState.online = false;
    retry = true;
  } finally {
    syncState.inFlight = false;
  }

  if (syncState.dirtyKitchen || syncState.dirtyOrder) {
    if (retry) {
      scheduleRetry();
    } else {
      flushToServer();
    }
  }
  renderAll();
}

function scheduleRetry() {
  if (syncState.retryTimer) return;
  syncState.retryTimer = setTimeout(() => {
    syncState.retryTimer = null;
    flushToServer();
  }, RETRY_INTERVAL_MS);
}

/**
 * 担当ロールを取得・切替する
 * @param {'kitchen' | 'order' | 'both' | 'viewer'} role 担当したいロール
 * @param {boolean} takeover 他端末から奪還するか
 */
async function claimRole(role, takeover = false, { keepLocal = false } = {}) {
  if (role === 'viewer') {
    // 閲覧専用に自ら降りる
    renderAll();
    return true;
  }

  try {
    const res = await fetch('/api/roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: DEVICE_ID, role, takeover }),
    });
    const data = await res.json();
    syncState.online = true;
    syncState.serverMode = true;
    if (data.kitchenDeviceId !== undefined) syncState.kitchenDeviceId = data.kitchenDeviceId;
    if (data.orderDeviceId !== undefined) syncState.orderDeviceId = data.orderDeviceId;

    if (!data.ok) {
      if (data.code === 'ROLE_OCCUPIED') {
        const roleLabel = data.role === 'kitchen' ? 'キッチン係' : '注文係';
        const ok = window.confirm(
          `【${roleLabel}】は現在「${data.occupiedBy}」が担当しています。この端末に切り替えますか？`
        );
        if (ok) {
          return await claimRole(role, true, { keepLocal });
        }
      }
      renderAll();
      return false;
    }

    if (!keepLocal) {
      adoptServerSnapshot(data.snapshot, data.revision);
      syncState.dirtyKitchen = false;
      syncState.dirtyOrder = false;
    }
    renderAll();
    return true;
  } catch {
    syncState.online = false;
    showToast('サーバーに接続できません。Wi-Fi/テザリングを確認してください', true);
    renderAll();
    return false;
  }
}

function handleServerMessage(data) {
  if (data.kitchenDeviceId !== undefined) syncState.kitchenDeviceId = data.kitchenDeviceId;
  if (data.orderDeviceId !== undefined) syncState.orderDeviceId = data.orderDeviceId;
  if (typeof data.connectedDevicesCount === 'number') {
    updateConnectedDevicesBadge(data.connectedDevicesCount);
  }
  syncState.online = true;
  syncState.serverMode = true;

  const snap = data.snapshot;
  const rev = snap?.revision ?? 0;
  if ((data.type === 'STATE_SYNC' || data.type === 'CONNECTED') && rev > syncState.serverRev) {
    if (data.sourceDeviceId === DEVICE_ID) {
      syncState.serverRev = Math.max(syncState.serverRev, rev);
    } else if (syncState.dirtyKitchen || syncState.dirtyOrder || syncState.inFlight) {
      // 未送信がある場合はflush時にマージ・照合
    } else {
      adoptServerSnapshot(snap, rev, snap.kitchenRevision, snap.orderRevision);
    }
  }
  if (syncState.dirtyKitchen || syncState.dirtyOrder) flushToServer();
  renderAll();
}

/**
 * 初期化
 * - サーバーに繋がればサーバーのデータを正とする（端末内の古いデータは退避）
 * - 繋がらなければ端末内のデータで単独モードとして動き、繋がったら再送する
 * - 本番データにデモを自動投入しない
 */
async function initApp() {
  // Service Worker はルート（/sw.js）で登録してアプリ全体を管理範囲にする
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  let localSnapshot = null;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) localSnapshot = JSON.parse(saved);
  } catch {
    localSnapshot = null;
  }

  try {
    const res = await fetch('/api/state', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    syncState.serverMode = true;
    syncState.online = true;
    syncState.kitchenDeviceId = data.kitchenDeviceId ?? null;
    syncState.orderDeviceId = data.orderDeviceId ?? null;
    if (data.connectedDevicesCount) updateConnectedDevicesBadge(data.connectedDevicesCount);

    const serverRev = data.revision ?? data.snapshot?.revision ?? 0;
    const localDiffers =
      localSnapshot && JSON.stringify(localSnapshot.orders || []) !== JSON.stringify(data.snapshot?.orders || []);
    if (localDiffers && (localSnapshot.revision ?? 0) !== serverRev) {
      try {
        store.importSnapshot(localSnapshot);
        backupLocalSnapshot('INIT_SERVER_DIFFERS');
      } catch {
        // ignore
      }
    }
    adoptServerSnapshot(data.snapshot, serverRev, data.kitchenRevision, data.orderRevision);

    // どの端末からでも即座に全機能が触れるよう、自動で両方（1人運用）を担当
    try {
      await claimRole('both', true, { keepLocal: true });
    } catch {
      // ignore
    }
  } catch {
    // サーバー未接続 → 端末内データで単独モード（データがなければ空で開始）
    syncState.serverMode = false;
    syncState.online = false;
    if (localSnapshot) {
      try {
        store.importSnapshot(localSnapshot);
      } catch {
        // ignore
      }
    }
    showToast('サーバーに接続できないため、この端末だけで記録します（接続後に送信します）', true);
  }

  // LANサーバーの更新通知（SSE）
  try {
    const es = new EventSource(`/api/events?deviceId=${encodeURIComponent(DEVICE_ID)}`);
    es.onmessage = (ev) => {
      try {
        handleServerMessage(JSON.parse(ev.data));
      } catch {
        // ignore
      }
    };
    es.onerror = () => {
      syncState.online = false;
      renderSyncStatus();
    };
  } catch {
    // ignore
  }

  setInterval(() => {
    if (syncState.dirtyKitchen || syncState.dirtyOrder) flushToServer();
  }, RETRY_INTERVAL_MS);

  initStaticControls();
  resetOrderForm();
  renderAll();
  switchTab('settings');

  setInterval(() => {
    renderSteamerWireframe();
  }, 1000);
}

/**
 * 同期状態・ロール担当状態の表示
 */
function renderSyncStatus() {
  const pill = document.getElementById('sync-status-pill');
  const rolePill = document.getElementById('role-status-pill');
  const role = myCurrentRole();

  document.body.classList.toggle('role-viewer', role === 'viewer');
  document.body.classList.toggle('no-role-order', !canWriteOrder());
  document.body.classList.toggle('no-role-kitchen', !canWriteKitchen());

  // ロール選択ボタンのアクティブ状態更新
  const btnOrder = document.getElementById('btn-role-order');
  const btnKitchen = document.getElementById('btn-role-kitchen');
  const btnBoth = document.getElementById('btn-role-both');
  const btnViewer = document.getElementById('btn-role-viewer');

  if (btnOrder) btnOrder.classList.toggle('active', role === 'order');
  if (btnKitchen) btnKitchen.classList.toggle('active', role === 'kitchen');
  if (btnBoth) btnBoth.classList.toggle('active', role === 'both');
  if (btnViewer) btnViewer.classList.toggle('active', role === 'viewer');

  if (pill) {
    let text;
    let cls;
    const hasDirty = syncState.dirtyKitchen || syncState.dirtyOrder;
    if (!syncState.serverMode) {
      text = hasDirty ? 'サーバー未接続：この端末だけで記録中（未送信あり）' : 'サーバー未接続：この端末だけで記録中';
      cls = 'pill pill-warn';
    } else if (!syncState.online) {
      text = hasDirty ? 'オフライン：未送信あり（自動再送待機）' : 'オフライン：再接続待ち';
      cls = 'pill pill-accent';
    } else if (hasDirty || syncState.inFlight) {
      text = '送信中…';
      cls = 'pill pill-warn';
    } else {
      text = `同期済み (改訂:${syncState.serverRev})`;
      cls = 'pill pill-info';
    }
    pill.textContent = `${text} ※現場未検証`;
    pill.className = cls;
  }

  if (rolePill) {
    if (!syncState.serverMode) {
      rolePill.textContent = '単独モード (1台で全機能入力可)';
      rolePill.className = 'pill pill-info';
    } else if (role === 'both') {
      rolePill.textContent = '担当: 【両方 (1人運用)】注文＋キッチン入力可';
      rolePill.className = 'pill pill-info';
    } else if (role === 'order') {
      const kWho = syncState.kitchenDeviceId ? `キッチン:${syncState.kitchenDeviceId}` : 'キッチン未割当';
      rolePill.textContent = `担当: 【注文係】(${kWho})`;
      rolePill.className = 'pill pill-info';
    } else if (role === 'kitchen') {
      const oWho = syncState.orderDeviceId ? `注文:${syncState.orderDeviceId}` : '注文未割当';
      rolePill.textContent = `担当: 【キッチン係】(${oWho})`;
      rolePill.className = 'pill pill-info';
    } else {
      rolePill.textContent = '担当: 【閲覧専用】(操作は担当スマホで実行)';
      rolePill.className = 'pill pill-accent';
    }
  }
}

function updateConnectedDevicesBadge(count) {
  const pill = document.getElementById('connected-devices-pill');
  if (pill) {
    pill.textContent = `接続スマホ/端末: ${Math.max(1, count)}台`;
  }
}

function switchTab(tabName) {
  // 4大タブの切り替え (settings, steamer, pos, analytics)
  document.body.setAttribute('data-active-tab', tabName);
  document.querySelectorAll('[data-tab-target]').forEach((btn) => {
    const isTarget = btn.getAttribute('data-tab-target') === tabName;
    btn.classList.toggle('active', isTarget);
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `tab-${tabName}`);
  });

  if (tabName === 'analytics') {
    renderAnalyticsDashboard();
  } else if (tabName === 'settings') {
    loadSettingsIntoForm();
  }
}
const switchMobileTab = switchTab;

function loadSettingsIntoForm() {
  const plan = store.businessPlan || {};
  const hours = plan.businessHours || {};
  const targets = plan.targetSalesCount || {};
  const inits = plan.initialInventory || {};

  const sStart = document.getElementById('setting-start-time');
  const sEnd = document.getElementById('setting-end-time');
  if (sStart && document.activeElement !== sStart) sStart.value = hours.startTime || '10:00';
  if (sEnd && document.activeElement !== sEnd) sEnd.value = hours.endTime || '17:00';

  const tButa = document.getElementById('target-butaman');
  const tAnba = document.getElementById('target-anbataman');
  const tPota = document.getElementById('target-potato');
  if (tButa && document.activeElement !== tButa) tButa.value = targets.butaman ?? 150;
  if (tAnba && document.activeElement !== tAnba) tAnba.value = targets.anbataman ?? 80;
  if (tPota && document.activeElement !== tPota) tPota.value = targets.potato ?? 100;

  const iButa = document.getElementById('inv-butaman');
  const iAnba = document.getElementById('inv-anbataman');
  const iPota = document.getElementById('inv-potato');
  if (iButa && document.activeElement !== iButa) iButa.value = inits.butaman ?? 200;
  if (iAnba && document.activeElement !== iAnba) iAnba.value = inits.anbataman ?? 100;
  if (iPota && document.activeElement !== iPota) iPota.value = inits.potato ?? 120;

  const fRate = document.getElementById('forecast-hourly-rate');
  if (fRate && document.activeElement !== fRate) fRate.value = plan.forecastHourlyRate ?? 20;

  // 価格
  const catalog = store.eventConfig?.catalog || [];
  const pButa = catalog.find((c) => c.productId === 'butaman');
  const pAnba = catalog.find((c) => c.productId === 'anbataman');
  const pPota = catalog.find((c) => c.productId === 'potato');

  const elPButa = document.getElementById('price-butaman');
  const elPAnba = document.getElementById('price-anbataman');
  const elPPota = document.getElementById('price-potato');
  if (elPButa && pButa && document.activeElement !== elPButa) elPButa.value = pButa.unitPrice;
  if (elPAnba && pAnba && document.activeElement !== elPAnba) elPAnba.value = pAnba.unitPrice;
  if (elPPota && pPota && document.activeElement !== elPPota) elPPota.value = pPota.unitPrice;
}

function saveSettingsFromForm() {
  const startTime = document.getElementById('setting-start-time')?.value || '10:00';
  const endTime = document.getElementById('setting-end-time')?.value || '17:00';

  const tButa = Math.max(1, Number(document.getElementById('target-butaman')?.value || 150));
  const tAnba = Math.max(1, Number(document.getElementById('target-anbataman')?.value || 80));
  const tPota = Math.max(1, Number(document.getElementById('target-potato')?.value || 100));

  const iButa = Math.max(0, Number(document.getElementById('inv-butaman')?.value || 200));
  const iAnba = Math.max(0, Number(document.getElementById('inv-anbataman')?.value || 100));
  const iPota = Math.max(0, Number(document.getElementById('inv-potato')?.value || 120));

  const forecastRate = Math.max(1, Number(document.getElementById('forecast-hourly-rate')?.value || 20));

  const priceButaman = Math.max(100, Number(document.getElementById('price-butaman')?.value || 500));
  const priceAnbataman = Math.max(100, Number(document.getElementById('price-anbataman')?.value || 450));
  const pricePotato = Math.max(100, Number(document.getElementById('price-potato')?.value || 300));

  store.updateBusinessPlan({
    businessHours: { startTime, endTime },
    targetSalesCount: { butaman: tButa, anbataman: tAnba, potato: tPota },
    initialInventory: { butaman: iButa, anbataman: iAnba, potato: iPota },
    forecastHourlyRate: forecastRate,
  });

  const updatedCatalog = store.eventConfig.catalog.map((item) => {
    if (item.productId === 'butaman') return { ...item, unitPrice: priceButaman };
    if (item.productId === 'anbataman') return { ...item, unitPrice: priceAnbataman };
    if (item.productId === 'potato') return { ...item, unitPrice: pricePotato };
    return item;
  });
  store.updateEventConfig({ catalog: updatedCatalog });

  persistAndSync('order');
  showToast('出店設定・在庫目標を保存しました！ムシ管理画面へ進みます');
  switchTab('steamer');
}

function renderAnalyticsDashboard() {
  const container = document.getElementById('analytics-progress-cards');
  if (!container) return;

  const data = store.getAnalyticsDashboard();
  const { productStats, steamAdvice, overallProgressPercent, totalSold, totalTarget } = data;

  const prodList = Object.values(productStats);

  container.innerHTML = `
    <!-- 全体目標達成率カード -->
    <div class="kpi-card" style="grid-column: 1 / -1; border-color: var(--wire-cyan);">
      <h3>
        <span>📈 本日全体の販売目標達成率 (％)</span>
        <span class="tiny-note">営業予定: ${data.businessHours.startTime} 〜 ${data.businessHours.endTime}</span>
      </h3>
      <div style="display:flex; justify-content:space-between; align-items:baseline;">
        <div class="kpi-percent-display ${overallProgressPercent >= 100 ? 'over' : ''}">
          ${overallProgressPercent}% <span style="font-size:14px; color:var(--text-muted);">達成</span>
        </div>
        <div style="font-size:16px; font-weight:700;">
          累計販売 <strong>${totalSold}</strong> 個 / 目標 <strong>${totalTarget}</strong> 個
        </div>
      </div>
      <div class="progress-bar-wrap">
        <div class="progress-bar-fill" style="width: ${Math.min(100, overallProgressPercent)}%;"></div>
      </div>
    </div>

    <!-- 商品別 目標達成率 ＆ 在庫消費率 カード -->
    ${prodList
      .map((p) => {
        return `
        <div class="kpi-card">
          <h3>
            <span>${p.name} (¥${p.unitPrice})</span>
            <span class="pill pill-info">${p.progressPercent}% 達成</span>
          </h3>
          <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:4px;">
            <div class="kpi-percent-display ${p.progressPercent >= 100 ? 'over' : ''}">${p.progressPercent}%</div>
            <div style="font-size:13px;">実績 <strong>${p.soldCount}</strong> / 目標 ${p.targetCount} 個</div>
          </div>
          <div class="progress-bar-wrap">
            <div class="progress-bar-fill" style="width: ${Math.min(100, p.progressPercent)}%;"></div>
          </div>

          <div style="margin-top:10px; padding-top:8px; border-top:1px dashed var(--border-grid);">
            <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:2px;">
              <span>在庫消費率: <strong>${p.inventoryConsumePercent}%</strong></span>
              <span>残推計: <strong>${p.remainingInventory}</strong> / 搬入 ${p.initialInventory} 個</span>
            </div>
            <div class="progress-bar-wrap" style="height:8px;">
              <div class="progress-bar-fill ${p.inventoryConsumePercent >= 90 ? 'warning' : ''}" style="width: ${Math.min(
          100,
          p.inventoryConsumePercent
        )}%;"></div>
            </div>
            ${p.wasteCount > 0 ? `<div class="tiny-note" style="color:var(--wire-coral);">※累計廃棄: ${p.wasteCount}個を含む</div>` : ''}
          </div>
        </div>
      `;
      })
      .join('')}

    <!-- 蒸し器の需要予測・推奨助言カード -->
    <div class="kpi-card" style="grid-column: 1 / -1; background: rgba(0, 240, 255, 0.05); border-color: var(--wire-cyan);">
      <h3>
        <span>♨️ 次の時間帯の需要予測・蒸し追加助言</span>
        <span class="advice-badge ${
          steamAdvice.recommendation === 'ADD_MORE'
            ? 'add'
            : steamAdvice.recommendation === 'STOP'
            ? 'stop'
            : 'small'
        }">
          ${
            steamAdvice.recommendation === 'ADD_MORE'
              ? '🔥 蒸し追加推奨'
              : steamAdvice.recommendation === 'STOP'
              ? '⏸️ 蒸し停止推奨'
              : '⚡ 状況維持・少量追加'
          }
        </span>
      </h3>
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:12px; font-size:13px; margin: 8px 0;">
        <div>次の1時間想定需要: <strong>${steamAdvice.forecast.forecastNextHourDemandQty} 個</strong></div>
        <div>調理確認済み蒸し在庫: <strong>${steamAdvice.actuals.confirmedReadySteamQty} 個</strong></div>
        <div>蒸し中(進行中)在庫: <strong>${steamAdvice.actuals.steamingInProgressQty} 個</strong></div>
        <div>待ち注文必要数: <strong>${steamAdvice.actuals.waitingRequiredSteamQty} 個</strong></div>
      </div>
      <div class="tiny-note" style="color:var(--wire-cyan); font-size:12px;">
        💡 助言理由: ${steamAdvice.reason} (予測収支: ${steamAdvice.forecast.projectedBalanceQty >= 0 ? '+' : ''}${steamAdvice.forecast.projectedBalanceQty}個)
      </div>
    </div>
  `;
}

function seedInitialDemoState() {
  const fresh = new StoreManager();
  const now = Date.now();
  // 1段目: 45分前に投入し、調理確認済みの豚まん5個
  const b1 = fresh.loadSteamerBatch({
    tierNumber: 1,
    productId: 'butaman',
    qty: 5,
    startedAt: new Date(now - 45 * 60 * 1000).toISOString(),
  });
  fresh.confirmBatchCookingReady(b1.batchId, new Date(now - 4 * 60 * 1000).toISOString());

  // 2段目: 42分前に投入したあんバタまん4個（予定時刻到来済み・調理未確認）＋ 12分前にピーク時1個途中追加した豚まん1個
  fresh.loadSteamerBatch({
    tierNumber: 2,
    productId: 'anbataman',
    qty: 4,
    startedAt: new Date(now - 42 * 60 * 1000).toISOString(),
  });
  fresh.loadSteamerBatch({
    tierNumber: 2,
    productId: 'butaman',
    qty: 1,
    startedAt: new Date(now - 12 * 60 * 1000).toISOString(),
    note: 'ピーク時1個途中追加',
  });

  // 5段目: 20分前に投入した豚まん5個（蒸し中）
  fresh.loadSteamerBatch({
    tierNumber: 5,
    productId: 'butaman',
    qty: 5,
    startedAt: new Date(now - 20 * 60 * 1000).toISOString(),
  });

  // 揚げ在庫（豚まん揚げ3個、あんバタ揚げ3個、ポテト5個）
  fresh.addNonSteamerReadyStock('butaman', CookingMethod.FRY, 3);
  fresh.addNonSteamerReadyStock('anbataman', CookingMethod.FRY, 3);
  fresh.addNonSteamerReadyStock('potato', CookingMethod.FRY, 5);

  store.importSnapshot(fresh.exportSnapshot());
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store.exportSnapshot()));
}

async function copyAppUrl() {
  let urlToCopy = window.location.href;
  try {
    const res = await fetch('/api/network-info');
    if (res.ok) {
      const data = await res.json();
      if (data.tunnelUrl && data.tunnelUrl.startsWith('http')) {
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
          urlToCopy = data.tunnelUrl;
        }
      }
    }
  } catch {
    // ignore
  }

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(urlToCopy);
      showToast(`📋 リンクをコピーしました: ${urlToCopy}`);
      return;
    }
  } catch (err) {
    console.warn('Clipboard writeText failed', err);
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = urlToCopy;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (ok) {
      showToast(`📋 リンクをコピーしました: ${urlToCopy}`);
      return;
    }
  } catch {
    // ignore
  }

  window.prompt('以下のリンクをコピーしてください:', urlToCopy);
}

async function refreshTunnelUrlDisplay() {
  const displayEl = document.getElementById('settings-tunnel-url-display');
  if (!displayEl) return;
  let targetUrl = window.location.href;
  try {
    const res = await fetch('/api/network-info');
    if (res.ok) {
      const info = await res.json();
      if (info.tunnelUrl && info.tunnelUrl.startsWith('http')) {
        targetUrl = info.tunnelUrl;
      }
    }
  } catch {
    // ignore
  }
  displayEl.textContent = targetUrl;
}

function initStaticControls() {
  // リンクコピーボタン（ヘッダー & 設定画面）
  const copyBtnTop = document.getElementById('btn-copy-url-top');
  if (copyBtnTop) {
    copyBtnTop.addEventListener('click', () => copyAppUrl());
  }
  const copyBtnSettings = document.getElementById('btn-copy-url-settings');
  if (copyBtnSettings) {
    copyBtnSettings.addEventListener('click', () => copyAppUrl());
  }
  const urlDisplay = document.getElementById('settings-tunnel-url-display');
  if (urlDisplay) {
    urlDisplay.style.cursor = 'pointer';
    urlDisplay.title = 'タップしてリンクをコピー';
    urlDisplay.addEventListener('click', () => copyAppUrl());
  }
  refreshTunnelUrlDisplay();
  // 段セレクトボックス初期化
  const tierSel = document.getElementById('load-tier-select');
  tierSel.innerHTML = '';
  for (const t of store.eventConfig.tiers) {
    const opt = document.createElement('option');
    opt.value = String(t.tierNumber);
    opt.textContent = `${t.tierNumber}段目 (${t.steamerType === 'ELECTRIC' ? '電気6個' : '通常5個'})`;
    tierSel.appendChild(opt);
  }

  // イベントサービスON/OFF切替
  const toggleService = document.getElementById('toggle-event-service');
  toggleService.checked = store.eventConfig.serviceEnabled;
  toggleService.addEventListener('change', () => {
    store.updateEventConfig({ serviceEnabled: toggleService.checked });
    persistAndSync('order');
    showToast(`イベント単位の5個毎1個無料サービスを ${toggleService.checked ? 'ON' : 'OFF'} に変更しました`);
  });

  // デモ再投入 & 全リセット（本番データを消さないよう確認してから実行）
  document.getElementById('btn-seed-demo').addEventListener('click', () => {
    if (!canWriteKitchen() || !canWriteOrder()) {
      showToast('全デモ投入には【両方（1人運用）】の権限が必要です', true);
      return;
    }
    if (!window.confirm('現在のデータをデモデータで置き換えます。本番中は実行しないでください。よろしいですか？')) return;
    backupLocalSnapshot('BEFORE_DEMO_SEED');
    seedInitialDemoState();
    resetOrderForm();
    persistAndSync('both');
    showToast('初期デモデータを投入しました（直前のデータは端末内に退避済み）');
  });

  document.getElementById('btn-reset-all').addEventListener('click', () => {
    if (!canWriteKitchen() || !canWriteOrder()) {
      showToast('全データリセットには【両方（1人運用）】の権限が必要です', true);
      return;
    }
    if (!window.confirm('全データ（注文・会計・せいろ・廃棄・経費）を空にします。よろしいですか？')) return;
    backupLocalSnapshot('BEFORE_RESET');
    const empty = new StoreManager();
    store.importSnapshot(empty.exportSnapshot());
    resetOrderForm();
    persistAndSync('both');
    showToast('全データを空の状態にリセットしました（直前のデータは端末内に退避済み）');
  });

  // ロール切替ボタン
  document.getElementById('btn-role-order').addEventListener('click', () => claimRole('order'));
  document.getElementById('btn-role-kitchen').addEventListener('click', () => claimRole('kitchen'));
  document.getElementById('btn-role-both').addEventListener('click', () => claimRole('both'));
  document.getElementById('btn-role-viewer').addEventListener('click', () => claimRole('viewer'));

  // せいろ段投入ボタン
  document.getElementById('btn-load-batch').addEventListener('click', () => {
    const tierNumber = Number(document.getElementById('load-tier-select').value);
    const productId = document.getElementById('load-product-select').value;
    const qty = Number(document.getElementById('load-qty-input').value);
    try {
      store.loadSteamerBatch({ tierNumber, productId, qty });
      persistAndSync('kitchen');
      showToast(`${tierNumber}段目へ ${qty}個 投入しました（40分タイマー開始）`);
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // ピーク時の「途中1個追加」ワンタップボタン
  document.getElementById('btn-load-midstream-1').addEventListener('click', () => {
    const tierNumber = Number(document.getElementById('load-tier-select').value);
    const productId = document.getElementById('load-product-select').value;
    try {
      const b = store.loadSteamerBatch({
        tierNumber,
        productId,
        qty: 1,
        note: 'ピーク時1個途中追加',
      });
      persistAndSync('kitchen');
      showToast(`${tierNumber}段目の空き枠(位置:${b.slotPositions.join(',')})へ 1個 途中追加しました（独立タイマー開始）`);
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // 注文単位の無料サービス全辞退チェック
  document.getElementById('chk-decline-all-service').addEventListener('change', (e) => {
    formState.declineAllService = e.target.checked;
    if (formState.declineAllService) {
      formState.freeQtyBySku = {};
    }
    renderOrderForm();
  });

  // 先払い / 後払いラジオ切替
  document.querySelectorAll('input[name="payTiming"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      const timing = document.querySelector('input[name="payTiming"]:checked')?.value;
      const methodRow = document.getElementById('prepaid-method-row');
      methodRow.style.opacity = timing === 'PREPAID' ? '1' : '0.4';
    });
  });

  // 注文確定 / 変更保存ボタン
  document.getElementById('btn-submit-order').addEventListener('click', handleSubmitOrder);
  document.getElementById('btn-cancel-edit').addEventListener('click', () => {
    resetOrderForm();
    renderOrderForm();
  });

  // 段取り出し最少訂正ボタン（注文係）
  document.getElementById('btn-exec-correction').addEventListener('click', () => {
    const orderId = document.getElementById('corr-order-select').value || null;
    const fromTierNumber = Number(document.getElementById('corr-from-tier').value);
    const toTierNumber = Number(document.getElementById('corr-to-tier').value);
    const qty = Number(document.getElementById('corr-qty').value);
    try {
      const rec = store.correctTierPick({
        orderId,
        fromTierNumber,
        toTierNumber,
        qty,
      });
      persistAndSync('order');
      showToast(`注文 #${rec.orderNumber}: ${fromTierNumber}段目→${toTierNumber}段目へ ${qty}個 付け替え訂正しました`);
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // 廃棄記録ボタン（キッチン係）
  document.getElementById('btn-record-waste').addEventListener('click', () => {
    const productId = document.getElementById('waste-product').value;
    const reasonType = document.getElementById('waste-reason').value;
    const qty = Number(document.getElementById('waste-qty').value);
    const batchId = document.getElementById('waste-batch-id').value.trim() || null;
    try {
      const w = store.recordWaste({
        productId,
        cookingMethod: productId === 'potato' ? CookingMethod.FRY : CookingMethod.STEAM,
        qty,
        reasonType,
        batchId,
      });
      persistAndSync('kitchen');
      showToast(
        `廃棄記録: ${qty}個 (${w.burdenParty === 'HQ' ? '商品不良=本部負担0円' : `過失=出店者負担${w.vendorPenaltyAmount}円`})`
      );
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // 経費確定・未入力戻しボタン（注文係）
  document.getElementById('btn-confirm-expense').addEventListener('click', () => {
    const raw = document.getElementById('expense-amount-input').value;
    if (raw === '' || raw === null) {
      showToast('金額を入力してください（0円確定の場合は 0 を入力）', true);
      return;
    }
    try {
      store.setExpense({ amount: Number(raw) });
      persistAndSync('order');
      showToast(`経費を ¥${Number(raw).toLocaleString()} で確定しました`);
    } catch (err) {
      showToast(err.message, true);
    }
  });

  document.getElementById('btn-clear-expense').addEventListener('click', () => {
    store.setExpense({ clearToUnentered: true });
    document.getElementById('expense-amount-input').value = '';
    persistAndSync('order');
    showToast('経費を「未入力(null)」状態に戻しました（0円確定として扱いません）');
  });

  // 4大メインタブ切り替え
  document.querySelectorAll('[data-tab-target]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab-target');
      switchTab(tab);
    });
  });

  // 設定保存ボタン
  const btnSaveSettings = document.getElementById('btn-save-settings');
  if (btnSaveSettings) {
    btnSaveSettings.addEventListener('click', () => {
      saveSettingsFromForm();
    });
  }

  // データ管理画面再読み込みボタン
  const btnRefreshAnalytics = document.getElementById('btn-refresh-analytics');
  if (btnRefreshAnalytics) {
    btnRefreshAnalytics.addEventListener('click', () => {
      renderAnalyticsDashboard();
      renderFooterSummary();
      showToast('データ進捗を最新状態に更新しました');
    });
  }

  // スマホ専用ボトムナビゲーション切替 (下位互換)
  document.querySelectorAll('[data-mobile-tab-btn]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-mobile-tab-btn');
      switchTab(tab);
    });
  });

  // 他スマホ接続・データ共有モーダル開閉
  const modal = document.getElementById('mobile-connect-modal');
  document.getElementById('btn-open-mobile-connect').addEventListener('click', async () => {
    modal.classList.remove('hidden');
    modal.removeAttribute('hidden');
    const box = document.getElementById('lan-urls-box');
    try {
      const res = await fetch('/api/network-info');
      const info = await res.json();
      if (info.lanUrls && info.lanUrls.length > 0) {
        box.innerHTML = info.lanUrls
          .map(
            (u) =>
              `<div style="margin-bottom:4px;">📱 <strong><a href="${u.url}" target="_blank" style="color:var(--wire-cyan)">${u.url}</a></strong> <span class="tiny-note">(${u.interface})</span></div>`
          )
          .join('');
      } else {
        box.textContent = `現在アクセス中のURL (${window.location.origin}) を同じWi-Fi/テザリング内のスマホで開いてください`;
      }
    } catch {
      box.textContent = `現在アクセス中のURL (${window.location.href}) を別スマホで開くか、下の方法C（データコピー）をご利用ください`;
    }
  });

  const closeModal = () => {
    modal.classList.add('hidden');
    modal.setAttribute('hidden', '');
  };

  const btnCloseModal = document.getElementById('btn-close-mobile-connect');
  if (btnCloseModal) {
    btnCloseModal.addEventListener('click', closeModal);
    btnCloseModal.addEventListener('touchend', (e) => {
      e.preventDefault();
      closeModal();
    });
  }

  // 背景タップでも閉じる
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });

  // ESCキーでも閉じる
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  // スマホ間手動スナップショットコピー＆読み込み
  document.getElementById('btn-copy-snapshot').addEventListener('click', async () => {
    const jsonStr = JSON.stringify(store.exportSnapshot());
    const textarea = document.getElementById('snapshot-transfer-textarea');
    textarea.value = jsonStr;
    try {
      await navigator.clipboard.writeText(jsonStr);
      showToast('現在の出店データをクリップボードにコピーしました（LINEやAirDrop等で他スマホへ送れます）');
    } catch {
      textarea.select();
      showToast('下のテキスト欄にデータを出力しました。全選択してコピーしてください');
    }
  });

  document.getElementById('btn-apply-snapshot').addEventListener('click', async () => {
    const raw = document.getElementById('snapshot-transfer-textarea').value.trim();
    if (!raw) {
      showToast('貼り付けるJSONデータを入力してください', true);
      return;
    }
    try {
      if (!canWriteKitchen() || !canWriteOrder()) {
        showToast('データのインポートには【両方（1人運用）】の権限が必要です', true);
        return;
      }
      const parsed = JSON.parse(raw);
      if (!window.confirm('貼り付けたデータで現在のデータを置き換えます。よろしいですか？')) return;
      backupLocalSnapshot('BEFORE_IMPORT');
      store.importSnapshot(parsed);
      persistAndSync('both');
      modal.classList.add('hidden');
      showToast('貼り付けたデータを読み込みました（直前のデータは端末内に退避済み）');
    } catch (err) {
      showToast(`データの読み込みに失敗しました: ${err.message}`, true);
    }
  });

  // 蒸し器 投入商品トグル (豚まん / あんバタ)
  document.querySelectorAll('[data-steamer-item]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeSteamerProductId = btn.getAttribute('data-steamer-item');
      document.querySelectorAll('[data-steamer-item]').forEach((b) => {
        b.classList.toggle('active', b === btn);
      });
      showToast(`投入商品を「${activeSteamerProductId === 'butaman' ? '豚まん' : 'あんバタ'}」に切り替えました`);
    });
  });

  // せいろセット切替タブ (通常1 / 通常2 / 電気)
  document.querySelectorAll('[data-steamer-set]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeSteamerSetId = btn.getAttribute('data-steamer-set');
      document.querySelectorAll('[data-steamer-set]').forEach((b) => {
        b.classList.toggle('active', b === btn);
      });
      renderSteamerWireframe();
    });
  });
}

function resetOrderForm() {
  formState = {
    editingOrderId: null,
    paidQtyBySku: {},
    freeQtyBySku: {},
    declineAllService: false,
    selectedFeatures: new Set(),
    customerNote: '',
  };
  const noteInput = document.getElementById('input-customer-note');
  if (noteInput) noteInput.value = '';
  const chkDecline = document.getElementById('chk-decline-all-service');
  if (chkDecline) chkDecline.checked = false;
}

function loadOrderIntoFormForEdit(orderId) {
  const order = store.getOrder(orderId);
  formState.editingOrderId = order.orderId;
  formState.paidQtyBySku = {};
  for (const item of order.paidItems) {
    formState.paidQtyBySku[item.skuKey] = item.qty;
  }
  formState.freeQtyBySku = {};
  for (const item of order.freeItems) {
    formState.freeQtyBySku[item.skuKey] = item.qty;
  }
  formState.declineAllService = Boolean(order.declineAllService);
  formState.selectedFeatures = new Set(order.customerFeatures || []);
  formState.customerNote = order.customerNote || '';

  document.getElementById('input-customer-note').value = formState.customerNote;
  document.getElementById('chk-decline-all-service').checked = formState.declineAllService;
  switchMobileTab('order');
  renderOrderForm();
  showToast(`注文 #${order.orderNumber} の数量・内容変更モードに入りました`);
}

function buildItemsArrayFromMap(qtyMap) {
  const arr = [];
  for (const [skuKey, qty] of Object.entries(qtyMap)) {
    if (qty > 0) {
      const [productId, cookingMethod] = skuKey.split('__');
      arr.push({ productId, cookingMethod, qty });
    }
  }
  return arr;
}

function handleSubmitOrder() {
  const paidItems = buildItemsArrayFromMap(formState.paidQtyBySku);
  const freeItems = buildItemsArrayFromMap(formState.freeQtyBySku);
  const customerNote = document.getElementById('input-customer-note').value.trim();
  const customerFeatures = Array.from(formState.selectedFeatures);

  if (paidItems.length === 0) {
    showToast('有料商品を1個以上選択してください', true);
    return;
  }

  try {
    if (formState.editingOrderId) {
      const { order, paymentGuidance } = store.modifyOrder(formState.editingOrderId, {
        paidItems,
        freeItems,
        declineAllService: formState.declineAllService,
      });
      store.updateCustomerFeatures(order.orderId, { customerFeatures, customerNote });
      resetOrderForm();
      persistAndSync('order');
      showToast(`注文 #${order.orderNumber} を変更しました → ${paymentGuidance.message}`);
    } else {
      const evalPreview = evaluateOrderItemsAndService(
        {
          paidItems,
          freeItems,
          declineAllService: formState.declineAllService,
        },
        store.eventConfig
      );
      const payTiming = document.querySelector('input[name="payTiming"]:checked')?.value || 'PREPAID';
      const payMethod = document.querySelector('input[name="payMethod"]:checked')?.value || PaymentMethod.CASH;

      const paymentInput =
        payTiming === 'PREPAID' && evalPreview.totalAmount > 0
          ? { method: payMethod, amount: evalPreview.totalAmount }
          : null;

      const created = store.createOrder({
        paidItems,
        freeItems,
        declineAllService: formState.declineAllService,
        customerFeatures,
        customerNote,
        paymentInput,
      });
      resetOrderForm();
      persistAndSync('order');
      showToast(
        `注文 #${created.orderNumber} を受付しました（合計 ¥${created.totalAmount.toLocaleString()} / 無料受取 ${created.selectedFreeQty}個 / 辞退 ${created.declinedFreeQty}個）`
      );
    }
  } catch (err) {
    showToast(err.message, true);
  }
}

// =============================================================================
// レンダリング関数群
// =============================================================================

function renderAll() {
  renderSyncStatus();
  const toggleService = document.getElementById('toggle-event-service');
  if (toggleService) toggleService.checked = store.eventConfig.serviceEnabled;
  loadSettingsIntoForm();
  renderAdviceHud();
  renderFryStockBar();
  renderSteamerWireframe();
  renderOrderForm();
  renderOrdersQueue();
  renderFooterSummary();
  renderAnalyticsDashboard();
}

function renderAdviceHud() {
  const hud = document.getElementById('advice-hud');
  const advice = store.getSteamingAdvice({ forecastNextHourDemandQty: 15 });
  const badgeColor =
    advice.recommendation === 'ADD_MORE'
      ? 'pill-accent'
      : advice.recommendation === 'STOP'
      ? 'pill-warn'
      : 'pill-info';

  const labelMap = {
    ADD_MORE: '追加蒸し推奨',
    SMALL_BATCH: '少量追加推奨',
    STOP: '追加停止推奨',
  };

  hud.innerHTML = `
    <div>
      <span class="pill ${badgeColor}">助言: ${labelMap[advice.recommendation]}</span>
      <div class="tiny-note">${advice.reason}</div>
    </div>
    <div class="advice-metrics">
      <div class="metric-box">
        <div><strong>【実績 (Actuals)】</strong></div>
        <div>調理確認済: <strong>${advice.actuals.confirmedReadySteamQty}</strong>個 / 蒸し中: <strong>${advice.actuals.steamingInProgressQty}</strong>個</div>
        <div>待ち注文必要数: <strong>${advice.actuals.waitingRequiredSteamQty}</strong>個 / お渡し済累計: <strong>${advice.actuals.deliveredSteamQty}</strong>個</div>
      </div>
      <div class="metric-box forecast">
        <div><strong>【予測 (Forecast)】</strong></div>
        <div>直近1時間予測需要: <strong>${advice.forecast.forecastNextHourDemandQty}</strong>個</div>
        <div>予測過不足バランス: <strong>${advice.forecast.projectedBalanceQty >= 0 ? '+' : ''}${advice.forecast.projectedBalanceQty}</strong>個</div>
      </div>
    </div>
  `;
}

function renderFryStockBar() {
  const bar = document.getElementById('fry-stock-bar');
  const frySkus = [
    { productId: 'butaman', label: '豚まん(揚)' },
    { productId: 'anbataman', label: 'あんバタ(揚)' },
    { productId: 'potato', label: 'ポテト(揚)' },
  ];
  bar.innerHTML = `
    <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
      <span class="tiny-note">揚げ待機在庫(※揚げ工程未確認):</span>
      ${frySkus
        .map((s) => {
          const key = makeSkuKey(s.productId, CookingMethod.FRY);
          const count = store.nonSteamerReadyStock.get(key) || 0;
          return `<button type="button" class="btn btn-outline btn-sm" data-add-fry="${s.productId}">
            ${s.label}: <strong>${count}</strong>個 (＋3追加)
          </button>`;
        })
        .join('')}
    </div>
  `;
  bar.querySelectorAll('[data-add-fry]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pid = btn.getAttribute('data-add-fry');
      store.addNonSteamerReadyStock(pid, CookingMethod.FRY, 3);
      persistAndSync('kitchen');
      showToast(`${pid} (揚げ) の調理済み在庫を +3個 追加しました`);
    });
  });
}

/**
 * 中身が透けて見えるせいろのワイヤーフレーム風・近未来UIの描画
 */
function renderSteamerWireframe() {
  const tiersSnap = store.getSteamerTiersSnapshot(new Date().toISOString());

  // 1. 斜め55度アイソメトリックせいろ 3Dワイヤーフレームを描画
  renderIsometricSteamerStage(tiersSnap);

  // 2. 従来のセットコンテナ（下位互換・テスト検証用）
  const container = document.getElementById('steamer-sets-container');
  if (container) {
    const sets = [
      {
        setId: 'regular-set-1',
        title: '通常せいろ セットA (固定番号 1〜4段 / 5個×4段)',
        tiers: tiersSnap.filter((t) => t.setId === 'regular-set-1'),
      },
      {
        setId: 'regular-set-2',
        title: '通常せいろ セットB (固定番号 5〜8段 / 5個×4段)',
        tiers: tiersSnap.filter((t) => t.setId === 'regular-set-2'),
      },
      {
        setId: 'electric-set-1',
        title: '電気せいろ (固定番号 9〜13段 / 6個×5段)',
        tiers: tiersSnap.filter((t) => t.setId === 'electric-set-1'),
      },
    ];

    container.innerHTML = sets
      .map(
        (set) => `
        <div class="steamer-set-column">
          <div class="steamer-set-title">${set.title}</div>
          ${set.tiers.map((tier) => renderSingleXrayTier(tier)).join('')}
        </div>
      `
      )
      .join('');

    // イベントバインド: バッチの「調理確認済みにする」ボタン（キッチン係）
    container.querySelectorAll('[data-confirm-batch]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const batchId = btn.getAttribute('data-confirm-batch');
        try {
          store.confirmBatchCookingReady(batchId);
          persistAndSync('kitchen');
          showToast(`バッチ ${batchId} を「調理確認済み（引渡し可）」にしました`);
        } catch (err) {
          showToast(err.message, true);
        }
      });
    });

    // イベントバインド: 空きスロットタップで「この段に1個途中追加」（キッチン係）
    container.querySelectorAll('[data-empty-slot-tier]').forEach((slotEl) => {
      slotEl.addEventListener('click', () => {
        const tierNumber = Number(slotEl.getAttribute('data-empty-slot-tier'));
        const slotPos = Number(slotEl.getAttribute('data-slot-pos'));
        const productId = document.getElementById('load-product-select')?.value || 'butaman';
        try {
          store.loadSteamerBatch({
            tierNumber,
            productId,
            qty: 1,
            slotPositions: [slotPos],
            note: `スロット#${slotPos}へ途中1個追加`,
          });
          persistAndSync('kitchen');
          showToast(
            `${tierNumber}段目の位置#${slotPos}へ ${
              productId === 'butaman' ? '豚まん' : 'あんバタ'
            } を1個途中追加しました（独立40分タイマー開始）`
          );
        } catch (err) {
          showToast(err.message, true);
        }
      });
    });
  }
}

/**
 * 斜め55度アイソメトリック せいろ3Dワイヤーフレーム描画
 * - 各段を斜め上から見た円形せいろオーバルとしてスタック
 * - 1段に5個のスロットが配置
 * - 空き枠タップ ➔ 40分タイマースタート
 * - 蒸し上がり ➔ 鮮やかな緑色に変化
 * - 蒸し上がりタップ ➔ 取り出し完了で消去（空き枠に戻る）
 */
function renderIsometricSteamerStage(tiersSnap) {
  const stage = document.getElementById('isometric-steamer-stage');
  if (!stage) return;

  const currentTiers = tiersSnap.filter((t) => t.setId === activeSteamerSetId);

  stage.innerHTML = currentTiers
    .map((tier) => {
      const slotMap = new Map();
      let hasReady = false;
      let totalOccupied = 0;

      for (const batch of tier.batches) {
        if (batch.remainingQty <= 0) continue;
        const isBatchReady = batch.state === 'CONFIRMED_READY' || batch.isReadyTimePassed;
        if (isBatchReady) hasReady = true;

        for (let i = 0; i < batch.remainingQty; i++) {
          const pos = batch.slotPositions[i] || i + 1;
          slotMap.set(pos, { batch, isBatchReady });
          totalOccupied += 1;
        }
      }

      // 1段にスロットを生成（通常5個: サイコロ⚄, 電気6個: サイコロ⚅）
      const slotsHtml = [];
      const capacity = tier.capacity || 5;
      const is6Cap = capacity === 6;
      const gridClass = is6Cap ? 'dice-6-grid' : 'dice-5-grid';

      for (let s = 1; s <= capacity; s++) {
        const item = slotMap.get(s);
        const dicePosClass = is6Cap ? `dice-pos-6-${s}` : `dice-pos-${s}`;

        if (!item) {
          // 空きスロット: ワンタップで投入開始
          slotsHtml.push(`
            <div class="iso-slot-node empty ${dicePosClass}" data-iso-tier="${tier.tierNumber}" data-iso-slot="${s}" title="タップで${activeSteamerProductId === 'butaman' ? '豚まん' : 'あんバタ'}を投入 (40分タイマー開始)">
              <div class="slot-icon">➕</div>
              <div class="slot-action-label">蒸す</div>
            </div>
          `);
        } else {
          const { batch, isBatchReady } = item;
          const shortName = batch.productId === 'butaman' ? '豚まん' : 'あんバタ';

          if (isBatchReady) {
            // 蒸し上がり完了: エメラルドグリーン発光！タップで消去（取り出し）
            slotsHtml.push(`
              <div class="iso-slot-node ready ${dicePosClass} ${batch.isMidStreamAddition ? 'midstream-added' : ''}" data-iso-remove-tier="${tier.tierNumber}" data-iso-remove-slot="${s}" title="蒸し上がり完了！タップすると取り出し完了で消えます">
                <div class="slot-ready-title">READY</div>
                <div style="font-size:12px; font-weight:800; color:#fff;">${shortName}</div>
                <div class="slot-tap-remove">タップで取出し✕</div>
              </div>
            `);
          } else {
            // 蒸し中: 赤/オレンジ発光、残り分数を大きく表示！
            const remainingMin = Math.max(1, Math.ceil(batch.remainingSeconds / 60));
            const mmss = formatMMSS(batch.remainingSeconds);
            slotsHtml.push(`
              <div class="iso-slot-node steaming ${dicePosClass} ${batch.isMidStreamAddition ? 'midstream-added' : ''}" data-iso-confirm-batch="${batch.batchId}" data-iso-tier="${tier.tierNumber}" data-iso-slot="${s}" title="蒸し中（残り${mmss}）タップで調理確認済みにする">
                <div class="slot-time-countdown">${remainingMin}分</div>
                <div class="slot-prod-name">${shortName}</div>
                <div class="slot-badge-sub">蒸し中</div>
              </div>
            `);
          }
        }
      }

      return `
        <div class="iso-tier-block ${hasReady ? 'has-ready' : ''}">
          <div class="iso-tier-header">
            <div class="iso-tier-badge">
              <span>第${tier.tierNumber}段 (${is6Cap ? '電気セイロ・6個' : '角セイロ・5個'})</span>
              <span class="iso-tier-status-text">(${totalOccupied}/${capacity}個 ${hasReady ? '⚡販売可能' : totalOccupied > 0 ? '♨️蒸し中' : '空き'})</span>
            </div>
            <button type="button" class="btn-fill-tier" data-iso-fill-tier="${tier.tierNumber}">
              ＋ 空き枠を一括投入
            </button>
          </div>
          <div class="${gridClass}">
            ${slotsHtml.join('')}
          </div>
        </div>
      `;
    })
    .join('');

  // イベントバインド: 空きスロットタップ ➔ 即座にタイマー開始！
  stage.querySelectorAll('[data-iso-tier][data-iso-slot]').forEach((el) => {
    el.addEventListener('click', () => {
      const tierNumber = Number(el.getAttribute('data-iso-tier'));
      const slotPos = Number(el.getAttribute('data-iso-slot'));
      try {
        store.loadSteamerBatch({
          tierNumber,
          productId: activeSteamerProductId,
          qty: 1,
          slotPositions: [slotPos],
          note: `スロット#${slotPos}へ投入`,
        });
        persistAndSync('kitchen');
        showToast(`第${tierNumber}段の位置#${slotPos}に ${activeSteamerProductId === 'butaman' ? '豚まん' : 'あんバタ'} を投入しました（40分タイマー開始）`);
      } catch (err) {
        showToast(err.message, true);
      }
    });
  });

  // イベントバインド: 蒸し上がりスロットタップ ➔ 取り出し完了で消去！
  stage.querySelectorAll('[data-iso-remove-tier][data-iso-remove-slot]').forEach((el) => {
    el.addEventListener('click', () => {
      const tierNumber = Number(el.getAttribute('data-iso-remove-tier'));
      const slotPos = Number(el.getAttribute('data-iso-remove-slot'));
      try {
        const res = store.removeSlotItem({ tierNumber, slotIndex: slotPos });
        if (res.removed) {
          persistAndSync('kitchen');
          showToast(`第${tierNumber}段から蒸し上がり豚まんを取り出しました（空き枠に戻りました）`);
        }
      } catch (err) {
        showToast(err.message, true);
      }
    });
  });

  // イベントバインド: 蒸し中スロットタップ ➔ 調理確認済みにする
  stage.querySelectorAll('[data-iso-confirm-batch]').forEach((el) => {
    el.addEventListener('click', () => {
      const batchId = el.getAttribute('data-iso-confirm-batch');
      if (window.confirm('この豚まんを「調理確認済み（蒸し上がり完了）」にしますか？')) {
        try {
          store.confirmBatchCookingReady(batchId);
          persistAndSync('kitchen');
          showToast('調理確認済みにしました（緑色に変わり、引渡し可能になりました）');
        } catch (err) {
          showToast(err.message, true);
        }
      }
    });
  });

  // イベントバインド: 段一括投入ボタン
  stage.querySelectorAll('[data-iso-fill-tier]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tierNumber = Number(btn.getAttribute('data-iso-fill-tier'));
      try {
        const batch = store.loadTierFull({ tierNumber, productId: activeSteamerProductId });
        if (batch) {
          persistAndSync('kitchen');
          showToast(`第${tierNumber}段の空き枠に ${activeSteamerProductId === 'butaman' ? '豚まん' : 'あんバタ'} を一括投入しました（40分タイマー開始）`);
        } else {
          showToast(`第${tierNumber}段はすでに満杯です`, true);
        }
      } catch (err) {
        showToast(err.message, true);
      }
    });
  });
}

function formatMMSS(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function renderSingleXrayTier(tier) {
  // 段内の各スロット(1..capacity)の状態をマッピングして透視表示
  const slotMap = new Map();
  for (const batch of tier.batches) {
    const shortName = batch.productId === 'butaman' ? '豚' : 'あん';
    for (let i = 0; i < batch.remainingQty; i++) {
      const pos = batch.slotPositions[i] || `s${i + 1}`;
      slotMap.set(pos, {
        batch,
        shortName,
      });
    }
  }

  const slotsHtml = [];
  for (let s = 1; s <= tier.capacity; s++) {
    const info = slotMap.get(s);
    if (!info) {
      slotsHtml.push(`
        <div class="xray-slot slot-empty" data-empty-slot-tier="${tier.tierNumber}" data-slot-pos="${s}" title="空き枠 #${s}: タップでこの位置に冷凍品を1個途中追加（独立タイマー）">
          <span>#${s}</span>
          <span>＋1</span>
        </div>
      `);
    } else {
      const { batch, shortName } = info;
      let cls = 'slot-steaming';
      let sub = formatMMSS(batch.remainingSeconds);
      if (batch.isCookingConfirmed) {
        cls = 'slot-ready';
        sub = '確認済';
      } else if (batch.isTimerExpired) {
        cls = 'slot-expired-unconfirmed';
        sub = '満了待';
      }
      slotsHtml.push(`
        <div class="xray-slot ${cls}" title="段:${tier.tierNumber} 位置:#${s} / ${batch.productName} (${batch.batchId})">
          <strong>${shortName}${batch.isMidStreamAddition ? '+1' : ''}</strong>
          <span>${sub}</span>
        </div>
      `);
    }
  }

  const batchesHtml = tier.batches
    .map((b) => {
      const statusClass = b.isCookingConfirmed
        ? 'confirmed-ready'
        : b.isTimerExpired
        ? 'expired-unconfirmed'
        : '';
      const timerLabel = b.isCookingConfirmed
        ? '調理確認済 (せいろ内保温・引渡可)'
        : b.isTimerExpired
        ? '予定時刻到来 (※自動で空にしません・要調理確認)'
        : `残り ${formatMMSS(b.remainingSeconds)} (予定 ${new Date(b.readyAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })})`;

      return `
        <div class="batch-pill-row ${statusClass}">
          <div>
            <strong>${b.productName} ×${b.remainingQty}個</strong>
            ${b.isMidStreamAddition ? '<span class="pill pill-warn" style="font-size:9px;padding:0 4px;">途中追加</span>' : ''}
            <span class="tiny-note">[位置:${b.slotPositions.slice(0, b.remainingQty).join(',')}]</span>
            <div class="tiny-note">${timerLabel} / 予約割当:${b.reservedQty}個</div>
          </div>
          <div>
            ${
              !b.isCookingConfirmed
                ? `<button type="button" class="btn btn-emerald btn-sm" data-confirm-batch="${b.batchId}">調理確認済にする</button>`
                : `<span class="pill pill-info">引渡OK</span>`
            }
          </div>
        </div>
      `;
    })
    .join('');

  return `
    <div class="xray-tier-card">
      <div class="tier-top-bar">
        <span class="tier-number-badge">第 ${tier.tierNumber} 段</span>
        <span class="tier-occupancy-text">
          推計残: <strong>${tier.totalRemainingQty}</strong> / ${tier.capacity}個
          (確認済:${tier.confirmedReadyQty} 蒸中:${tier.steamingQty})
        </span>
      </div>
      <div class="xray-slots-row">
        ${slotsHtml.join('')}
      </div>
      <div class="tier-batches-list">
        ${batchesHtml || '<div class="tiny-note" style="text-align:center;">現在この段は空です（上の＋枠タップで1個投入可）</div>'}
      </div>
    </div>
  `;
}

/**
 * 注文入力・数量変更フォームの描画
 */
function renderOrderForm() {
  const titleEl = document.getElementById('order-form-title');
  const badgeEl = document.getElementById('editing-order-badge');
  const cancelBtn = document.getElementById('btn-cancel-edit');
  const submitBtn = document.getElementById('btn-submit-order');
  const payBox = document.getElementById('new-order-payment-box');

  if (formState.editingOrderId) {
    const ord = store.getOrder(formState.editingOrderId);
    titleEl.textContent = `ORDER MODIFY // 注文 #${ord.orderNumber} の数量・内容変更`;
    badgeEl.classList.remove('hidden');
    cancelBtn.classList.remove('hidden');
    submitBtn.textContent = `注文 #${ord.orderNumber} の変更を確定する`;
    payBox.classList.add('hidden');
  } else {
    titleEl.textContent = 'ORDER CONSOLE // 新規注文受付';
    badgeEl.classList.add('hidden');
    cancelBtn.classList.add('hidden');
    submitBtn.textContent = '注文を確定する';
    payBox.classList.remove('hidden');
  }

  // 1. 有料商品グリッド
  const paidGrid = document.getElementById('paid-items-grid');
  const skuCards = [];
  for (const prod of store.eventConfig.catalog) {
    if (!prod.enabled) continue;
    for (const method of prod.allowedMethods) {
      const skuKey = makeSkuKey(prod.productId, method);
      const qty = formState.paidQtyBySku[skuKey] || 0;
      const methodLabel = method === CookingMethod.STEAM ? '蒸し' : '揚げ';
      skuCards.push(`
        <div class="sku-card">
          <div class="sku-info">
            <span class="sku-title">${prod.name} (${methodLabel})</span>
            <span class="sku-price">¥${prod.unitPrice} ${prod.category === ProductCategory.MAN ? '・まん類(5個毎対象)' : '・サイド(対象外)'}</span>
          </div>
          <div class="qty-stepper">
            <button type="button" class="btn btn-outline btn-sm" data-paid-step="${skuKey}" data-delta="-1">−</button>
            <span class="qty-val">${qty}</span>
            <button type="button" class="btn btn-cyan btn-sm" data-paid-step="${skuKey}" data-delta="1">＋</button>
          </div>
        </div>
      `);
    }
  }
  paidGrid.innerHTML = skuCards.join('');

  paidGrid.querySelectorAll('[data-paid-step]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const skuKey = btn.getAttribute('data-paid-step');
      const delta = Number(btn.getAttribute('data-delta'));
      const next = Math.max(0, (formState.paidQtyBySku[skuKey] || 0) + delta);
      formState.paidQtyBySku[skuKey] = next;
      clampFreeItemsToEntitlement();
      renderOrderForm();
    });
  });

  // 2. サービス枠計算と無料内訳グリッド
  const paidItems = buildItemsArrayFromMap(formState.paidQtyBySku);
  const freeItems = buildItemsArrayFromMap(formState.freeQtyBySku);
  let evalRes;
  try {
    evalRes = evaluateOrderItemsAndService(
      {
        paidItems,
        freeItems,
        declineAllService: formState.declineAllService,
      },
      store.eventConfig
    );
  } catch {
    formState.freeQtyBySku = {};
    evalRes = evaluateOrderItemsAndService(
      {
        paidItems,
        freeItems: [],
        declineAllService: formState.declineAllService,
      },
      store.eventConfig
    );
  }

  document.getElementById('service-entitlement-text').textContent = store.eventConfig.serviceEnabled
    ? `有料まん合計: ${evalRes.paidManTotalQty}個 → 無料サービス枠: 最大 ${evalRes.entitledFreeQty}個（選択中: ${evalRes.selectedFreeQty}個 / 辞退: ${evalRes.declinedFreeQty}個）`
    : '現在イベント設定で無料サービスは OFF です';

  const freeGrid = document.getElementById('free-items-grid');
  const freeCards = [];
  for (const prod of store.eventConfig.catalog) {
    if (!prod.enabled || prod.category !== ProductCategory.MAN) continue;
    for (const method of prod.allowedMethods) {
      const skuKey = makeSkuKey(prod.productId, method);
      const qty = formState.declineAllService ? 0 : formState.freeQtyBySku[skuKey] || 0;
      const methodLabel = method === CookingMethod.STEAM ? '蒸し' : '揚げ';
      const canAddMore =
        !formState.declineAllService && evalRes.selectedFreeQty < evalRes.entitledFreeQty;
      freeCards.push(`
        <div class="sku-card">
          <div class="sku-info">
            <span class="sku-title">[無料] ${prod.name} (${methodLabel})</span>
            <span class="sku-price">本部負担 (¥0)</span>
          </div>
          <div class="qty-stepper">
            <button type="button" class="btn btn-outline btn-sm" data-free-step="${skuKey}" data-delta="-1" ${qty <= 0 ? 'disabled' : ''}>−</button>
            <span class="qty-val">${qty}</span>
            <button type="button" class="btn btn-emerald btn-sm" data-free-step="${skuKey}" data-delta="1" ${!canAddMore ? 'disabled' : ''}>＋</button>
          </div>
        </div>
      `);
    }
  }
  freeGrid.innerHTML = freeCards.join('');

  freeGrid.querySelectorAll('[data-free-step]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const skuKey = btn.getAttribute('data-free-step');
      const delta = Number(btn.getAttribute('data-delta'));
      const next = Math.max(0, (formState.freeQtyBySku[skuKey] || 0) + delta);
      formState.freeQtyBySku[skuKey] = next;
      clampFreeItemsToEntitlement();
      renderOrderForm();
    });
  });

  // 3. 客の特徴タグ（数タップ選択・任意）
  const chipsContainer = document.getElementById('feature-chips-container');
  chipsContainer.innerHTML = DEFAULT_CUSTOMER_FEATURE_SUGGESTIONS.map((tag) => {
    const active = formState.selectedFeatures.has(tag);
    return `<button type="button" class="chip-btn ${active ? 'active' : ''}" data-feature-tag="${tag}">${tag}</button>`;
  }).join('');

  chipsContainer.querySelectorAll('[data-feature-tag]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tag = btn.getAttribute('data-feature-tag');
      if (formState.selectedFeatures.has(tag)) {
        formState.selectedFeatures.delete(tag);
      } else {
        formState.selectedFeatures.add(tag);
      }
      renderOrderForm();
    });
  });

  // 4. 合計金額・本部負担サービス費用表示（辞退分は非計上）
  document.getElementById('order-total-amount').textContent = `¥${evalRes.totalAmount.toLocaleString()}`;
  document.getElementById(
    'order-service-summary'
  ).textContent = `本部負担サービス費用計上: ¥${evalRes.hqServiceCostAmount.toLocaleString()} (受取:${evalRes.selectedFreeQty}個 / 辞退:${evalRes.declinedFreeQty}個 ※辞退分は在庫・費用非計上)`;
}

function clampFreeItemsToEntitlement() {
  const paidItems = buildItemsArrayFromMap(formState.paidQtyBySku);
  const freeItems = buildItemsArrayFromMap(formState.freeQtyBySku);
  try {
    evaluateOrderItemsAndService(
      { paidItems, freeItems, declineAllService: formState.declineAllService },
      store.eventConfig
    );
  } catch {
    // 無料枠を超えた場合は調整
    formState.freeQtyBySku = {};
  }
}

/**
 * 待ち注文一覧・取り出し案内・会計案内と入金/返金記録・お渡し完了の描画
 */
function renderOrdersQueue() {
  const waitingListEl = document.getElementById('waiting-orders-list');
  const allListEl = document.getElementById('all-orders-list');
  const allCountEl = document.getElementById('all-orders-count');

  const waitingOrders = store.getWaitingOrders();
  const allOrders = store.getAllOrders();
  allCountEl.textContent = String(allOrders.length);
  const mobileWaitBadge = document.getElementById('mobile-nav-waiting-badge');
  if (mobileWaitBadge) {
    mobileWaitBadge.textContent = String(waitingOrders.length);
  }

  // 段付け替え訂正の注文セレクト更新
  const corrSelect = document.getElementById('corr-order-select');
  const deliveredOrders = allOrders.filter((o) => o.deliveryPickLogs && o.deliveryPickLogs.length > 0);
  corrSelect.innerHTML =
    deliveredOrders.length === 0
      ? '<option value="">(お渡し完了済みの注文なし)</option>'
      : deliveredOrders
          .map(
            (o, idx) =>
              `<option value="${o.orderId}">${idx === 0 ? '[直前] ' : ''}注文 #${o.orderNumber} (${o.deliveryPickLogs
                .map((p) => (p.tierNumber ? `${p.tierNumber}段×${p.qty}` : `${p.skuKey}×${p.qty}`))
                .join(',')})</option>`
          )
          .join('');

  document.getElementById('correction-history-line').textContent =
    store.tierCorrectionHistory.length === 0
      ? '段取り出し訂正履歴: 0件'
      : `最新訂正: 注文#${store.tierCorrectionHistory.at(-1).orderNumber} (${store.tierCorrectionHistory.at(-1).fromTierNumber}段目→${store.tierCorrectionHistory.at(-1).toTierNumber}段目 ×${store.tierCorrectionHistory.at(-1).qty}個) 全${store.tierCorrectionHistory.length}件`;

  if (waitingOrders.length === 0) {
    waitingListEl.innerHTML = '<div class="tiny-note" style="padding:12px;text-align:center;">現在、待ち注文（未引渡・差額徴収待ち・返金待ち）はありません</div>';
  } else {
    waitingListEl.innerHTML = waitingOrders.map((o) => renderOrderCard(o, true)).join('');
  }

  allListEl.innerHTML = allOrders.map((o) => renderOrderCard(o, false)).join('');

  bindOrderCardEvents(waitingListEl);
  bindOrderCardEvents(allListEl);
}

function renderOrderCard(order, isQueueView) {
  const guidance = store.getPaymentGuidance(order.orderId);
  const pickPlan =
    order.fulfillmentStatus === FulfillmentStatus.WAITING ||
    order.fulfillmentStatus === FulfillmentStatus.PARTIAL
      ? store.getPickSuggestionsForOrder(order.orderId)
      : null;

  const paidDesc = order.paidItems
    .map((i) => `${i.productName}(${i.cookingMethod === 'STEAM' ? '蒸' : '揚'})×${i.qty}`)
    .join(' / ');
  const freeDesc =
    order.freeItems.length > 0
      ? order.freeItems
          .map((i) => `[無料]${i.productName}(${i.cookingMethod === 'STEAM' ? '蒸' : '揚'})×${i.qty}`)
          .join(' / ')
      : '';

  const payBadgeClass =
    order.paymentStatus === PaymentStatus.PAID || order.paymentStatus === PaymentStatus.ZERO_DUE
      ? 'pill-info'
      : 'pill-accent';
  const fulfillBadgeClass =
    order.fulfillmentStatus === FulfillmentStatus.DELIVERED ? 'pill-info' : 'pill-warn';

  let pickHtml = '';
  if (pickPlan) {
    if (pickPlan.canCompleteImmediately) {
      const guideText = pickPlan.suggestions
        .map((s) =>
          s.tierNumber
            ? `<strong>第${s.tierNumber}段</strong>(${s.productName})から <strong>${s.pickQty}個</strong>`
            : `<strong>揚げ待機枠</strong>から <strong>${s.pickQty}個</strong>`
        )
        .join(' ＋ ');
      pickHtml = `
        <div class="pick-guide-box">
          <strong>取り出し元自動案内:</strong> ${guideText}
          <div class="tiny-note">※下の「お渡し完了」を押すと上記段から自動減算されます（通常の段番号入力は不要）</div>
        </div>
      `;
    } else {
      pickHtml = `
        <div class="pick-guide-box shortage">
          <strong>調理確認済み在庫の待機中:</strong> せいろの「調理確認済にする」を押すか、蒸し上がりを待っています
        </div>
      `;
    }
  }

  // 未払い・差額徴収待ち・返金待ちの案内表示と明示的完了ボタン
  let paymentActionHtml = '';
  if (guidance.actionRequired === 'INITIAL_PAYMENT' || guidance.actionRequired === 'ADDITIONAL_COLLECTION') {
    paymentActionHtml = `
      <div class="payment-guidance-banner">
        <div><strong>【会計案内表示】${guidance.message}</strong></div>
        <div class="order-actions-row">
          <button type="button" class="btn btn-primary btn-sm" data-pay-order="${order.orderId}" data-pay-amount="${guidance.additionalCollectionDue}" data-pay-method="CASH">
            現金 ¥${guidance.additionalCollectionDue} 入金記録
          </button>
          <button type="button" class="btn btn-outline btn-sm" data-pay-order="${order.orderId}" data-pay-amount="${guidance.additionalCollectionDue}" data-pay-method="PAYPAY">
            PayPay 入金記録
          </button>
          <button type="button" class="btn btn-outline btn-sm" data-pay-order="${order.orderId}" data-pay-amount="${guidance.additionalCollectionDue}" data-pay-method="TOCHITSUKA">
            トチツーカ 入金記録
          </button>
        </div>
      </div>
    `;
  } else if (guidance.actionRequired === 'REFUND') {
    paymentActionHtml = `
      <div class="payment-guidance-banner">
        <div><strong>【返金案内表示】${guidance.message}</strong></div>
        <div class="order-actions-row">
          <button type="button" class="btn btn-warn btn-sm" data-refund-order="${order.orderId}" data-refund-amount="${guidance.refundDue}" data-refund-method="CASH">
            現金 ¥${guidance.refundDue} 返金完了を記録
          </button>
          <button type="button" class="btn btn-outline btn-sm" data-refund-order="${order.orderId}" data-refund-amount="${guidance.refundDue}" data-refund-method="PAYPAY">
            PayPay 返金記録
          </button>
        </div>
      </div>
    `;
  }

  return `
    <div class="order-card">
      <div class="order-card-header">
        <div>
          <span class="order-num">#${order.orderNumber}</span>
          <span class="pill ${payBadgeClass}">会計: ${order.paymentStatus} (¥${order.totalAmount.toLocaleString()})</span>
          <span class="pill ${fulfillBadgeClass}">受渡: ${order.fulfillmentStatus}</span>
        </div>
        <div class="tiny-note">
          ${order.customerFeatures.length > 0 ? `特徴: ${order.customerFeatures.join(', ')}` : '特徴: 未指定'}
          ${order.customerNote ? ` (${order.customerNote})` : ''}
        </div>
      </div>

      <div>
        <strong>明細:</strong> ${paidDesc}
        ${freeDesc ? ` / <span style="color:var(--wire-emerald)">${freeDesc}</span>` : ''}
        ${order.declinedFreeQty > 0 ? `<span class="tiny-note">(無料辞退:${order.declinedFreeQty}個)</span>` : ''}
      </div>

      ${pickHtml}
      ${paymentActionHtml}

      ${
        isQueueView
          ? `
        <div class="order-actions-row">
          ${
            order.fulfillmentStatus !== FulfillmentStatus.DELIVERED
              ? `<button type="button" class="btn btn-emerald" data-deliver-order="${order.orderId}" ${
                  pickPlan && !pickPlan.canCompleteImmediately ? 'disabled' : ''
                }>
                  お渡し完了 (案内段から自動減算)
                </button>`
              : ''
          }
          <button type="button" class="btn btn-outline btn-sm" data-edit-order="${order.orderId}">
            数量・内容変更
          </button>
          ${
            order.fulfillmentStatus !== FulfillmentStatus.DELIVERED
              ? `<button type="button" class="btn btn-danger btn-sm" data-cancel-order="${order.orderId}">
                  注文キャンセル
                </button>`
              : ''
          }
        </div>
      `
          : `
        <div class="tiny-note">
          履歴(${order.history.length}件): ${order.history.map((h) => h.type).join(' → ')}
        </div>
      `
      }
    </div>
  `;
}

function bindOrderCardEvents(rootEl) {
  rootEl.querySelectorAll('[data-deliver-order]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const orderId = btn.getAttribute('data-deliver-order');
      try {
        const { order, executedPicks } = store.completeOrderDelivery(orderId);
        persistAndSync('order');
        showToast(
          `注文 #${order.orderNumber} お渡し完了！ (${executedPicks
            .map((p) => (p.tierNumber ? `${p.tierNumber}段目×${p.qty}個` : `${p.skuKey}×${p.qty}個`))
            .join(', ')} 自動減算)`
        );
      } catch (err) {
        showToast(err.message, true);
      }
    });
  });

  rootEl.querySelectorAll('[data-edit-order]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const orderId = btn.getAttribute('data-edit-order');
      loadOrderIntoFormForEdit(orderId);
    });
  });

  rootEl.querySelectorAll('[data-cancel-order]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const orderId = btn.getAttribute('data-cancel-order');
      try {
        const { order, paymentGuidance } = store.cancelOrder(orderId);
        persistAndSync('order');
        showToast(`注文 #${order.orderNumber} をキャンセルしました (${paymentGuidance.message})`);
      } catch (err) {
        showToast(err.message, true);
      }
    });
  });

  rootEl.querySelectorAll('[data-pay-order]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const orderId = btn.getAttribute('data-pay-order');
      const amount = Number(btn.getAttribute('data-pay-amount'));
      const method = btn.getAttribute('data-pay-method');
      try {
        const ord = store.recordPayment(orderId, { method, amount });
        persistAndSync('order');
        showToast(`注文 #${ord.orderNumber}: ${method} で ¥${amount.toLocaleString()} の入金を記録しました`);
      } catch (err) {
        showToast(err.message, true);
      }
    });
  });

  rootEl.querySelectorAll('[data-refund-order]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const orderId = btn.getAttribute('data-refund-order');
      const amount = Number(btn.getAttribute('data-refund-amount'));
      const method = btn.getAttribute('data-refund-method');
      try {
        const ord = store.recordRefund(orderId, { method, amount });
        persistAndSync('order');
        showToast(`注文 #${ord.orderNumber}: ${method} で ¥${amount.toLocaleString()} の返金完了を記録しました`);
      } catch (err) {
        showToast(err.message, true);
      }
    });
  });
}

function renderFooterSummary() {
  const s = store.getSettlementSummary();
  document.getElementById('waste-summary-text').textContent =
    `累計廃棄 — 商品不良(本部負担): ${s.wasteSummary.defectHqWasteQty}個 (¥0) / 蒸しすぎ等過失(出店者250円/個): ${s.wasteSummary.negligenceVendorWasteQty}個 (出店者負担 ¥${s.wasteSummary.negligenceVendorPenaltyAmount.toLocaleString()})`;

  document.getElementById('expense-summary-text').textContent =
    s.expenseSummary.status === ExpenseStatus.UNENTERED
      ? '現在の経費状態: 【未入力 (UNENTERED / null)】※未入力を0円確定として扱いません'
      : `現在の経費状態: 【確定 (CONFIRMED)】金額: ¥${s.expenseSummary.amount.toLocaleString()} ${
          s.expenseSummary.isZeroConfirmed ? '(0円確定)' : ''
        }`;

  const box = document.getElementById('settlement-summary-box');
  box.innerHTML = `
    <h3>精算・配分サマリ（豚まん500円/50%再確認要・ポテト原価未精査）</h3>
    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:6px; font-size:12px;">
      <div>売上総計(有料分): <strong>¥${s.grossSalesAmount.toLocaleString()}</strong></div>
      <div>本部売上配分(50%暫定): <strong>¥${s.hqGrossShareAmount.toLocaleString()}</strong></div>
      <div>出店者売上配分(50%暫定): <strong>¥${s.vendorGrossShareAmount.toLocaleString()}</strong></div>
      <div>本部負担サービス計上: <strong>¥${s.serviceSummary.hqFreeServiceCostAmount.toLocaleString()}</strong> (提供:${s.serviceSummary.totalProvidedFreeQty}個 / 辞退非計上:${s.serviceSummary.totalDeclinedFreeQty}個)</div>
      <div>出店者差引(経費前): <strong>¥${s.vendorNetBeforeExpense.toLocaleString()}</strong></div>
      <div>出店者最終差引(経費後): <strong>${
        s.vendorNetAfterExpense === null
          ? '未確定 (経費未入力)'
          : `¥${s.vendorNetAfterExpense.toLocaleString()}`
      }</strong></div>
    </div>
  `;
}

initApp();

