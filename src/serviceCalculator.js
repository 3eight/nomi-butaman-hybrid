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

import { ProductCategory, makeSkuKey } from './models.js';

/**
 * 商品カタログをMap化して取得する
 */
export function getCatalogMap(eventConfig) {
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
export function calculateServiceEntitlement(paidItems, eventConfig) {
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
export function evaluateOrderItemsAndService({
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
