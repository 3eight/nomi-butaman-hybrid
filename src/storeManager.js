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
import { evaluateOrderItemsAndService, getCatalogMap } from './serviceCalculator.js';

export class StoreManager {
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
