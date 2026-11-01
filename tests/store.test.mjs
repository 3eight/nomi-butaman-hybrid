/**
 * 能美豚饅 蒸し・会計・注文管理システム (v0.2)
 * 受入条件（AC-01〜AC-07）網羅テストスイート
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CookingMethod,
  PaymentMethod,
  PaymentStatus,
  FulfillmentStatus,
  BatchState,
  WasteReason,
  ExpenseStatus,
  AdviceLevel,
  makeSkuKey,
  createDefaultEventConfig,
  calculateServiceEntitlement,
  evaluateOrderItemsAndService,
  StoreManager,
} from '../src/index.js';

// =============================================================================
// AC-01: サービス計算（有料まん類5個ごと1個サービス・無料内訳選択・ポテト除外）
// =============================================================================
test('AC-01: 有料まん類の合計5個ごとに1個無料枠が付与され、ポテトや無料分は母数に含まれないこと', () => {
  const config = createDefaultEventConfig();

  // 1) 豚まん(蒸し)3個 + あんバタまん(揚げ)1個 + ポテト5個 => 有料まん計4個なので無料枠0個
  const res4 = calculateServiceEntitlement(
    [
      { productId: 'butaman', cookingMethod: CookingMethod.STEAM, qty: 3 },
      { productId: 'anbataman', cookingMethod: CookingMethod.FRY, qty: 1 },
      { productId: 'potato', cookingMethod: CookingMethod.FRY, qty: 5 },
    ],
    config
  );
  assert.equal(res4.paidManTotalQty, 4);
  assert.equal(res4.paidSideTotalQty, 5);
  assert.equal(res4.entitledFreeQty, 0);

  // 2) 豚まん(蒸し)3個 + あんバタまん(揚げ)2個 => 有料まん計5個なので無料枠1個
  const res5 = calculateServiceEntitlement(
    [
      { productId: 'butaman', cookingMethod: CookingMethod.STEAM, qty: 3 },
      { productId: 'anbataman', cookingMethod: CookingMethod.FRY, qty: 2 },
    ],
    config
  );
  assert.equal(res5.paidManTotalQty, 5);
  assert.equal(res5.entitledFreeQty, 1);

  // 3) 有料まん9個 => 無料枠1個、有料まん10個 => 無料枠2個
  const res9 = calculateServiceEntitlement(
    [{ productId: 'butaman', cookingMethod: CookingMethod.STEAM, qty: 9 }],
    config
  );
  assert.equal(res9.entitledFreeQty, 1);

  const res10 = evaluateOrderItemsAndService(
    {
      paidItems: [
        { productId: 'butaman', cookingMethod: CookingMethod.STEAM, qty: 6 },
        { productId: 'anbataman', cookingMethod: CookingMethod.STEAM, qty: 4 },
      ],
      // 無料分2個も「まんの種類×蒸し/揚げ」を自由に選べる
      freeItems: [
        { productId: 'butaman', cookingMethod: CookingMethod.FRY, qty: 1 },
        { productId: 'anbataman', cookingMethod: CookingMethod.FRY, qty: 1 },
      ],
    },
    config
  );
  assert.equal(res10.entitledFreeQty, 2);
  assert.equal(res10.selectedFreeQty, 2);
  assert.equal(res10.declinedFreeQty, 0);
  assert.equal(res10.totalAmount, 5000); // 有料10個×500円
  assert.equal(res10.hqServiceCostAmount, 1000); // 本部負担2個×500円
  assert.equal(res10.requiredBySku[makeSkuKey('butaman', CookingMethod.FRY)], 1);
  assert.equal(res10.requiredBySku[makeSkuKey('anbataman', CookingMethod.FRY)], 1);

  // ポテトを無料サービスに選ぼうとした場合はエラーになること
  assert.throws(() => {
    evaluateOrderItemsAndService(
      {
        paidItems: [{ productId: 'butaman', cookingMethod: CookingMethod.STEAM, qty: 5 }],
        freeItems: [{ productId: 'potato', cookingMethod: CookingMethod.FRY, qty: 1 }],
      },
      config
    );
  }, { message: /無料サービスには.*のみ選択可能です/ });
});

// =============================================================================
// AC-02: イベント単位サービスON/OFF、注文単位の辞退、辞退分の在庫/サービス費用非計上
// =============================================================================
test('AC-02: イベント単位ON/OFFおよび注文単位の辞退が機能し、辞退分は在庫・本部負担サービス費用に計上されないこと', () => {
  // 1) イベント単位でサービスOFFの場合
  const configOff = createDefaultEventConfig({ serviceEnabled: false });
  const evalOff = evaluateOrderItemsAndService(
    {
      paidItems: [{ productId: 'butaman', cookingMethod: CookingMethod.STEAM, qty: 10 }],
    },
    configOff
  );
  assert.equal(evalOff.entitledFreeQty, 0);
  assert.equal(evalOff.hqServiceCostAmount, 0);

  // 2) イベント単位でサービスONでも、注文単位で全辞退・一部辞退が可能
  const store = new StoreManager(createDefaultEventConfig({ serviceEnabled: true }));

  // 注文A: 有料10個（無料枠2個）のうち、1個だけ受け取り、1個を辞退
  const orderPartialDecline = store.createOrder({
    paidItems: [{ productId: 'butaman', cookingMethod: CookingMethod.STEAM, qty: 10 }],
    freeItems: [{ productId: 'anbataman', cookingMethod: CookingMethod.STEAM, qty: 1 }],
  });
  assert.equal(orderPartialDecline.entitledFreeQty, 2);
  assert.equal(orderPartialDecline.selectedFreeQty, 1);
  assert.equal(orderPartialDecline.declinedFreeQty, 1);
  // 在庫必要数は有料10個＋無料受取1個＝計11個（辞退1個は在庫計上しない）
  assert.equal(orderPartialDecline.requiredBySku[makeSkuKey('butaman', CookingMethod.STEAM)], 10);
  assert.equal(orderPartialDecline.requiredBySku[makeSkuKey('anbataman', CookingMethod.STEAM)], 1);
  // 本部負担サービス費用は実際に渡す1個分(500円)のみ（辞退1個分は計上しない）
  assert.equal(orderPartialDecline.hqServiceCostAmount, 500);

  // 注文B: 有料5個（無料枠1個）を注文単位で全辞退
  const orderFullDecline = store.createOrder({
    paidItems: [{ productId: 'butaman', cookingMethod: CookingMethod.STEAM, qty: 5 }],
    declineAllService: true,
  });
  assert.equal(orderFullDecline.entitledFreeQty, 1);
  assert.equal(orderFullDecline.selectedFreeQty, 0);
  assert.equal(orderFullDecline.declinedFreeQty, 1);
  assert.equal(orderFullDecline.requiredBySku[makeSkuKey('butaman', CookingMethod.STEAM)], 5);
  assert.equal(orderFullDecline.hqServiceCostAmount, 0);

  // 精算サマリでも辞退分(計2個)がサービス費用に計上されていないことを確認
  const summary = store.getSettlementSummary();
  assert.equal(summary.serviceSummary.totalEntitledFreeQty, 3);
  assert.equal(summary.serviceSummary.totalProvidedFreeQty, 1);
  assert.equal(summary.serviceSummary.totalDeclinedFreeQty, 2);
  assert.equal(summary.serviceSummary.hqFreeServiceCostAmount, 500);
});

// =============================================================================
// AC-03: 注文変更、差額徴収待ち・返金待ち、案内表示だけでは完了にしない検証
// =============================================================================
test('AC-03: 同一注文の数量変更で差額徴収待ち/返金待ちに遷移し、案内表示だけでは入金/返金完了にならないこと', () => {
  const store = new StoreManager();

  // 初回注文: 豚まん(蒸し) 2個 = 1,000円、PayPayで先払い済み
  // 客の特徴タグは任意（空でも登録でき、後から数タップ相当で追加も可能）
  const order = store.createOrder({
    paidItems: [{ productId: 'butaman', cookingMethod: CookingMethod.STEAM, qty: 2 }],
    paymentInput: { method: PaymentMethod.PAYPAY, amount: 1000 },
  });
  assert.equal(order.paymentStatus, PaymentStatus.PAID);
  assert.equal(order.fulfillmentStatus, FulfillmentStatus.WAITING);
  assert.deepEqual(order.customerFeatures, []);

  // 客の特徴タグを任意設定
  const withFeatures = store.updateCustomerFeatures(order.orderId, {
    customerFeatures: ['帽子', 'お子様連れ'],
  });
  assert.deepEqual(withFeatures.customerFeatures, ['帽子', 'お子様連れ']);

  // 1) 数量追加変更: 2個 → 5個 (+無料1個) = 2,500円（差額 +1,500円徴収待ち）
  const modUp = store.modifyOrder(order.orderId, {
    paidItems: [{ productId: 'butaman', cookingMethod: CookingMethod.STEAM, qty: 5 }],
    freeItems: [{ productId: 'anbataman', cookingMethod: CookingMethod.STEAM, qty: 1 }],
    reason: '3個追加注文',
  });
  assert.equal(modUp.order.totalAmount, 2500);
  assert.equal(modUp.order.paymentStatus, PaymentStatus.ADDITIONAL_COLLECTION_PENDING);
  assert.equal(modUp.paymentGuidance.additionalCollectionDue, 1500);
  assert.equal(modUp.paymentGuidance.isCompletedByGuidanceDisplay, false);

  // 再度案内表示を取得しても、入金完了(PAID)には絶対にならないことを確認
  const guidanceCheck1 = store.getPaymentGuidance(order.orderId);
  assert.equal(guidanceCheck1.additionalCollectionDue, 1500);
  assert.equal(store.getOrder(order.orderId).paymentStatus, PaymentStatus.ADDITIONAL_COLLECTION_PENDING);

  // 明示的に現金で差額1,500円を入金記録した時点で初めて PAID になる
  const afterAdditionalPay = store.recordPayment(order.orderId, {
    method: PaymentMethod.CASH,
    amount: 1500,
  });
  assert.equal(afterAdditionalPay.paymentStatus, PaymentStatus.PAID);
  assert.equal(afterAdditionalPay.paidAmount, 2500);

  // 2) 数量削減変更: 5個 → 3個 = 1,500円（差額 1,000円返金待ち、無料枠も0個に戻る）
  const modDown = store.modifyOrder(order.orderId, {
    paidItems: [{ productId: 'butaman', cookingMethod: CookingMethod.STEAM, qty: 3 }],
    freeItems: [],
    reason: '2個キャンセルによる数量減',
  });
  assert.equal(modDown.order.totalAmount, 1500);
  assert.equal(modDown.order.paymentStatus, PaymentStatus.REFUND_PENDING);
  assert.equal(modDown.paymentGuidance.refundDue, 1000);
  assert.equal(modDown.paymentGuidance.isCompletedByGuidanceDisplay, false);

  // 案内表示だけでは返金完了にならないことを確認
  const guidanceCheck2 = store.getPaymentGuidance(order.orderId);
  assert.equal(guidanceCheck2.refundDue, 1000);
  assert.equal(store.getOrder(order.orderId).paymentStatus, PaymentStatus.REFUND_PENDING);

  // 明示的に返金記録(1,000円)を実行した時点で初めて PAID に戻る
  const afterRefund = store.recordRefund(order.orderId, {
    method: PaymentMethod.CASH,
    amount: 1000,
  });
  assert.equal(afterRefund.paymentStatus, PaymentStatus.PAID);
  assert.equal(afterRefund.refundedAmount, 1000);
  assert.equal(afterRefund.history.length >= 5, true);
});

// =============================================================================
// AC-04: 予約と受渡の分離、複数注文の二重割当・二重減算防止、先払い/後払い独立
// =============================================================================
test('AC-04: 複数注文間で同一在庫が二重割当されず、お渡し完了で案内段から自動減算され、二重減算が防止されること', () => {
  const store = new StoreManager();

  // 1段目に5個、2段目に5個の豚まんを投入し、両方とも調理確認済みにする
  const b1 = store.loadSteamerBatch({
    tierNumber: 1,
    productId: 'butaman',
    qty: 5,
    startedAt: '2026-11-01T10:00:00+09:00',
  });
  const b2 = store.loadSteamerBatch({
    tierNumber: 2,
    productId: 'butaman',
    qty: 5,
    startedAt: '2026-11-01T10:05:00+09:00',
  });
  store.confirmBatchCookingReady(b1.batchId, '2026-11-01T10:40:00+09:00');
  store.confirmBatchCookingReady(b2.batchId, '2026-11-01T10:45:00+09:00');

  // 注文1（先払い）: 豚まん3個 → 1段目から3個予約割当されるはず
  const ord1 = store.createOrder({
    paidItems: [{ productId: 'butaman', cookingMethod: CookingMethod.STEAM, qty: 3 }],
    paymentInput: { method: PaymentMethod.CASH, amount: 1500 },
  });

  // 注文2（後払い・未払い）: 豚まん4個 → 1段目の残り2個 + 2段目から2個予約割当されるはず（1段目を二重割当しない）
  const ord2 = store.createOrder({
    paidItems: [{ productId: 'butaman', cookingMethod: CookingMethod.STEAM, qty: 4 }],
    // paymentInputなし（後払い）
  });
  assert.equal(ord2.paymentStatus, PaymentStatus.UNPAID);
  assert.equal(ord2.fulfillmentStatus, FulfillmentStatus.WAITING);

  const pick1 = store.getPickSuggestionsForOrder(ord1.orderId);
  assert.equal(pick1.canCompleteImmediately, true);
  assert.deepEqual(
    pick1.suggestions.map((s) => ({ tierNumber: s.tierNumber, pickQty: s.pickQty })),
    [{ tierNumber: 1, pickQty: 3 }]
  );

  const pick2 = store.getPickSuggestionsForOrder(ord2.orderId);
  assert.equal(pick2.canCompleteImmediately, true);
  assert.deepEqual(
    pick2.suggestions.map((s) => ({ tierNumber: s.tierNumber, pickQty: s.pickQty })),
    [
      { tierNumber: 1, pickQty: 2 },
      { tierNumber: 2, pickQty: 2 },
    ]
  );

  // 注文1を「お渡し完了」→ 手で段番号を入力しなくても1段目から3個自動減算され、1段目残数は2個になる
  store.completeOrderDelivery(ord1.orderId);
  assert.equal(store.getTierCurrentOccupancy(1), 2);
  assert.equal(store.getTierCurrentOccupancy(2), 5);

  // 注文1に対して誤って再度「お渡し完了」を呼んでも二重減算されない（エラーで防止）
  assert.throws(() => {
    store.completeOrderDelivery(ord1.orderId);
  }, /二重減算できません/);
  assert.equal(store.getTierCurrentOccupancy(1), 2);

  // 後払いの注文2も、未払いのまま先にお渡し完了でき（受渡と支払の独立）、待ち注文一覧には「未払い」として残る
  store.completeOrderDelivery(ord2.orderId);
  assert.equal(store.getTierCurrentOccupancy(1), 0);
  assert.equal(store.getTierCurrentOccupancy(2), 3);

  const waitingAfterDeliver = store.getWaitingOrders();
  assert.equal(waitingAfterDeliver.length, 1);
  assert.equal(waitingAfterDeliver[0].orderId, ord2.orderId);
  assert.equal(waitingAfterDeliver[0].fulfillmentStatus, FulfillmentStatus.DELIVERED);
  assert.equal(waitingAfterDeliver[0].paymentStatus, PaymentStatus.UNPAID);

  // 後払い注文2のトチツーカ支払を記録すると、待ち注文一覧から消える
  store.recordPayment(ord2.orderId, { method: PaymentMethod.TOCHITSUKA, amount: 2000 });
  assert.equal(store.getWaitingOrders().length, 0);
});

// =============================================================================
// AC-05: 段別取り出し訂正（違う段から取った場合のみ、直前注文の1個等を実際の段へ付け替え）
// =============================================================================
test('AC-05: 案内と違う段から取った場合、直前注文の1個等を実際の段へ付け替える最少訂正と履歴記録が機能すること', () => {
  const store = new StoreManager();

  // 1段目に5個、2段目に5個を投入し調理確認済みにする
  const b1 = store.loadSteamerBatch({ tierNumber: 1, productId: 'butaman', qty: 5 });
  const b2 = store.loadSteamerBatch({ tierNumber: 2, productId: 'butaman', qty: 5 });
  store.confirmBatchCookingReady(b1.batchId);
  store.confirmBatchCookingReady(b2.batchId);

  // 2個の注文を作成し、お渡し完了（システム案内により1段目から2個自動減算 → 1段目残3個、2段目残5個）
  const order = store.createOrder({
    paidItems: [{ productId: 'butaman', cookingMethod: CookingMethod.STEAM, qty: 2 }],
    paymentInput: { method: PaymentMethod.CASH, amount: 1000 },
  });
  store.completeOrderDelivery(order.orderId);
  assert.equal(store.getTierCurrentOccupancy(1), 3);
  assert.equal(store.getTierCurrentOccupancy(2), 5);

  // 現場スタッフが「実は2個のうち1個は2段目から取った」と最少訂正を実行（orderId省略で直前注文を対象）
  const corr = store.correctTierPick({
    fromTierNumber: 1,
    toTierNumber: 2,
    qty: 1,
    reason: '手前の2段目から1個取り出したため',
  });

  // 訂正後: 1段目は 3+1=4個に戻り、2段目は 5-1=4個に減算される
  assert.equal(store.getTierCurrentOccupancy(1), 4);
  assert.equal(store.getTierCurrentOccupancy(2), 4);
  assert.equal(corr.fromTierNumber, 1);
  assert.equal(corr.toTierNumber, 2);
  assert.equal(corr.qty, 1);
  assert.equal(store.tierCorrectionHistory.length, 1);

  const updatedOrder = store.getOrder(order.orderId);
  assert.equal(updatedOrder.history.some((h) => h.type === 'TIER_PICK_CORRECTED'), true);
});

// =============================================================================
// AC-06: ピーク時の「途中1個追加（独立タイマー）」および「タイマー満了で段を空にしない・調理確認との区別」
// =============================================================================
test('AC-06: 同じ段に後から1個だけ冷凍品を途中追加した際に独立タイマーを持ち、満了時刻を過ぎても自動で段が空にならないこと', () => {
  const store = new StoreManager();

  // 10:00 に 3段目へ 4個投入（予定完了: 10:40、スロット [1,2,3,4]）
  const initialBatch = store.loadSteamerBatch({
    tierNumber: 3,
    productId: 'butaman',
    qty: 4,
    startedAt: '2026-11-01T10:00:00+09:00',
  });
  assert.equal(initialBatch.isMidStreamAddition, false);
  assert.deepEqual(initialBatch.slotPositions, [1, 2, 3, 4]);

  // 10:15（ピーク時）に 同じ3段目の空き位置へ 1個だけ途中追加（予定完了: 10:55、スロット [5]）
  const midStreamBatch = store.loadSteamerBatch({
    tierNumber: 3,
    productId: 'butaman',
    qty: 1,
    startedAt: '2026-11-01T10:15:00+09:00',
    note: 'ピーク時1個途中追加',
  });
  assert.equal(midStreamBatch.isMidStreamAddition, true);
  assert.deepEqual(midStreamBatch.slotPositions, [5]);
  assert.equal(store.getTierCurrentOccupancy(3), 5);

  // 10:45 時点のスナップショットを確認:
  // - 最初の4個バッチは予定時刻(10:40)を過ぎているため isTimerExpired: true だが、
  //   自動で段から消えたりせず remainingQty: 4 のまま残っており、調理確認前なので isCookingConfirmed: false
  // - 途中追加の1個バッチはまだ予定時刻(10:55)前なので isTimerExpired: false, remainingSeconds: 600
  const snapAt1045 = store.getSteamerTiersSnapshot('2026-11-01T10:45:00+09:00');
  const tier3At1045 = snapAt1045.find((t) => t.tierNumber === 3);
  assert.equal(tier3At1045.totalRemainingQty, 5); // 満了で空にならない！
  assert.equal(tier3At1045.isEstimatedInventory, true);

  const bInitSnap = tier3At1045.batches.find((b) => b.batchId === initialBatch.batchId);
  const bMidSnap = tier3At1045.batches.find((b) => b.batchId === midStreamBatch.batchId);

  assert.equal(bInitSnap.isTimerExpired, true);
  assert.equal(bInitSnap.isCookingConfirmed, false);
  assert.equal(bInitSnap.state, BatchState.STEAMING);

  assert.equal(bMidSnap.isTimerExpired, false);
  assert.equal(bMidSnap.remainingSeconds, 10 * 60);
  assert.equal(bMidSnap.isCookingConfirmed, false);

  // 調理未確認のままでは、5個注文が来てもお渡し完了できない（予定時刻到来≠調理確認済み）
  const order5 = store.createOrder({
    paidItems: [{ productId: 'butaman', cookingMethod: CookingMethod.STEAM, qty: 4 }],
    paymentInput: { method: PaymentMethod.CASH, amount: 2000 },
  });
  assert.equal(store.getPickSuggestionsForOrder(order5.orderId).canCompleteImmediately, false);

  // 最初の4個バッチだけ調理確認済みにすると、その4個は引渡し可能になり、途中追加の1個は蒸し中のまま3段目に残る
  store.confirmBatchCookingReady(initialBatch.batchId, '2026-11-01T10:46:00+09:00');
  assert.equal(store.getPickSuggestionsForOrder(order5.orderId).canCompleteImmediately, true);

  store.completeOrderDelivery(order5.orderId, { deliveredAt: '2026-11-01T10:47:00+09:00' });
  assert.equal(store.getTierCurrentOccupancy(3), 1); // 途中追加した1個がそのまま残る
});

// =============================================================================
// AC-07: 廃棄区分（本部負担 vs 出店者過失250円/個）、経費未入力≠0円確定、予測と実績の分離
// =============================================================================
test('AC-07: 廃棄の本部負担/出店者250円分離、経費未入力と0円確定の区別、助言の予測/実績分離が機能すること', () => {
  const store = new StoreManager();

  const b1 = store.loadSteamerBatch({ tierNumber: 1, productId: 'butaman', qty: 5 });
  store.confirmBatchCookingReady(b1.batchId);

  // 商品不良による廃棄 1個（本部負担 = 出店者ペナルティ 0円）
  const wDefect = store.recordWaste({
    productId: 'butaman',
    qty: 1,
    reasonType: WasteReason.DEFECT_HQ,
    batchId: b1.batchId,
    note: '皮破れ不良',
  });
  assert.equal(wDefect.burdenParty, 'HQ');
  assert.equal(wDefect.vendorPenaltyAmount, 0);

  // 蒸しすぎ過失による廃棄 2個（出店者負担 = 250円 × 2個 = 500円）
  const wNegligence = store.recordWaste({
    productId: 'butaman',
    qty: 2,
    reasonType: WasteReason.NEGLIGENCE_VENDOR,
    batchId: b1.batchId,
    note: '蒸しすぎによる過失',
  });
  assert.equal(wNegligence.burdenParty, 'VENDOR');
  assert.equal(wNegligence.vendorPenaltyAmount, 500);
  assert.equal(store.getTierCurrentOccupancy(1), 2); // 5 - 1 - 2 = 2個

  // 経費初期状態は「未入力 (UNENTERED)」であり、0円確定ではない
  const summaryUnentered = store.getSettlementSummary();
  assert.equal(summaryUnentered.wasteSummary.defectHqWasteQty, 1);
  assert.equal(summaryUnentered.wasteSummary.negligenceVendorWasteQty, 2);
  assert.equal(summaryUnentered.wasteSummary.negligenceVendorPenaltyAmount, 500);
  assert.equal(summaryUnentered.expenseSummary.status, ExpenseStatus.UNENTERED);
  assert.equal(summaryUnentered.expenseSummary.amount, null);
  assert.equal(summaryUnentered.expenseSummary.isZeroConfirmed, false);
  assert.equal(summaryUnentered.vendorNetAfterExpense, null); // 未入力なので勝手に0円引きで確定しない

  // 明示的に経費 0円 で入力確定した場合は CONFIRMED かつ isZeroConfirmed: true になる
  store.setExpense({ amount: 0, note: '経費なし確定' });
  const summaryZeroConfirmed = store.getSettlementSummary();
  assert.equal(summaryZeroConfirmed.expenseSummary.status, ExpenseStatus.CONFIRMED);
  assert.equal(summaryZeroConfirmed.expenseSummary.amount, 0);
  assert.equal(summaryZeroConfirmed.expenseSummary.isZeroConfirmed, true);
  assert.notEqual(summaryZeroConfirmed.vendorNetAfterExpense, null);

  // 追加蒸し助言において「実績 (actuals)」と「予測 (forecast)」が分離されていること
  const advice = store.getSteamingAdvice({ forecastNextHourDemandQty: 12 });
  assert.equal(typeof advice.actuals, 'object');
  assert.equal(typeof advice.forecast, 'object');
  assert.equal(advice.actuals.confirmedReadySteamQty, 2);
  assert.equal(advice.forecast.forecastNextHourDemandQty, 12);
  assert.equal(advice.recommendation, AdviceLevel.ADD_MORE);
});

// =============================================================================
// AC-08: スナップショット永続化・復元、動的設定変更、注文キャンセル時の返金待ち・予約解放
// =============================================================================
test('AC-08: スナップショット入出力で全状態が完全復元され、先払い注文キャンセル時に予約解放・返金待ち(案内のみでは未完了)になること', () => {
  const store1 = new StoreManager();
  const b1 = store1.loadSteamerBatch({ tierNumber: 1, productId: 'butaman', qty: 5 });
  store1.confirmBatchCookingReady(b1.batchId);

  // 先払い注文を作成
  const ord = store1.createOrder({
    paidItems: [{ productId: 'butaman', cookingMethod: CookingMethod.STEAM, qty: 3 }],
    paymentInput: { method: PaymentMethod.CASH, amount: 1500 },
  });
  assert.equal(ord.reservations.length, 1);

  // スナップショットをエクスポートして別インスタンス(store2)へインポート
  const snap = store1.exportSnapshot();
  const store2 = new StoreManager();
  store2.importSnapshot(snap);
  assert.equal(store2.revision, store1.revision);
  assert.equal(store2.getOrder(ord.orderId).totalAmount, 1500);

  // 先払い済み注文をキャンセル → 予約は即座に解放されるが、会計は REFUND_PENDING（返金待ち）になり、案内表示だけでは返金完了にならない
  const cancelRes = store2.cancelOrder(ord.orderId, { reason: 'お客様都合キャンセル' });
  assert.equal(cancelRes.order.fulfillmentStatus, FulfillmentStatus.CANCELLED);
  assert.equal(cancelRes.order.reservations.length, 0);
  assert.equal(cancelRes.order.paymentStatus, PaymentStatus.REFUND_PENDING);
  assert.equal(cancelRes.paymentGuidance.refundDue, 1500);
  assert.equal(cancelRes.paymentGuidance.isCompletedByGuidanceDisplay, false);

  // 明示的に返金記録を行うと ZERO_DUE（清算完了）になり、待ち一覧から消える
  const afterRefund = store2.recordRefund(ord.orderId, { method: PaymentMethod.CASH, amount: 1500 });
  assert.equal(afterRefund.paymentStatus, PaymentStatus.ZERO_DUE);
  assert.equal(store2.getWaitingOrders().length, 0);
});

// =============================================================================
// サーバーのハンドラを、実際のポートを開かずに呼び出すテスト用ヘルパー
// =============================================================================
async function createTestServer(options = {}) {
  const { EventEmitter } = await import('node:events');
  const { createAppServer } = await import('../src/server.mjs');
  const { handleRequest } = createAppServer(options);

  function call({ method = 'GET', url = '/', body = undefined }) {
    return new Promise((resolve) => {
      const req = new EventEmitter();
      req.method = method;
      req.url = url;
      req.headers = { host: 'localhost' };

      const res = {
        statusCode: 200,
        headers: {},
        setHeader() {},
        writeHead(code, hdrs = {}) {
          this.statusCode = code;
          this.headers = { ...this.headers, ...hdrs };
        },
        write() {},
        end(data = '') {
          const text = Buffer.isBuffer(data) ? data.toString('utf-8') : String(data);
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            json = null;
          }
          resolve({ statusCode: this.statusCode, headers: this.headers, text, json });
        },
      };

      handleRequest(req, res);
      if (body !== undefined) {
        req.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf-8'));
      }
      req.emit('end');
    });
  }

  return { call };
}

// =============================================================================
// AC-09: ローカルWebサーバー・静的UI配信・状態共有APIの統合検証
// =============================================================================
test('AC-09: ローカルWebサーバーがワイヤーフレームUIと状態同期API(/api/state)を正常に提供すること', async () => {
  const store = new StoreManager();
  const { call } = await createTestServer({ initialSnapshot: store.exportSnapshot() });

  // 1. トップページ (HTML) の取得確認
  const htmlRes = await call({ url: '/' });
  assert.equal(htmlRes.statusCode, 200);
  assert.equal(htmlRes.text.includes('SEIRO X-RAY WIREFRAME'), true);
  assert.equal(htmlRes.text.includes('btn-role-order'), true);

  // 2. 状態取得 API (/api/state) の確認（未検証ステータス明示を含む）
  const stateRes = await call({ url: '/api/state' });
  assert.equal(stateRes.statusCode, 200);
  assert.equal(stateRes.json.ok, true);
  assert.equal(stateRes.json.syncVerificationStatus, 'UNVERIFIED');
  assert.equal(stateRes.json.revision, store.revision);
  assert.equal(stateRes.json.writerDeviceId, null);

  // 3. 親機になってから、現在の改訂番号を baseRevision にして更新できる
  const claim = await call({ method: 'POST', url: '/api/writer', body: { deviceId: 'dev-a' } });
  assert.equal(claim.json.ok, true);
  assert.equal(claim.json.writerDeviceId, 'dev-a');

  const base = stateRes.json.revision;
  store.loadSteamerBatch({ tierNumber: 1, productId: 'butaman', qty: 5 });
  const postRes = await call({
    method: 'POST',
    url: '/api/state',
    body: { deviceId: 'dev-a', baseRevision: base, snapshot: store.exportSnapshot() },
  });
  assert.equal(postRes.statusCode, 200);
  assert.equal(postRes.json.ok, true);
  assert.equal(postRes.json.revision, base + 1);

  // 4. LAN接続情報API・PWAマニフェスト・Service Worker（ルート /sw.js から配信）
  const netRes = await call({ url: '/api/network-info' });
  assert.equal(netRes.statusCode, 200);
  assert.equal(Array.isArray(netRes.json.lanUrls), true);
  assert.equal(netRes.json.syncVerificationStatus, 'UNVERIFIED');

  const manifestRes = await call({ url: '/public/manifest.webmanifest' });
  assert.equal(manifestRes.statusCode, 200);
  assert.equal(manifestRes.json.display, 'standalone');

  const swRes = await call({ url: '/sw.js' });
  assert.equal(swRes.statusCode, 200);
  assert.equal(swRes.text.includes("request.method !== 'GET'"), true);
  assert.equal(swRes.text.includes('url.origin !== self.location.origin'), true);
});

// =============================================================================
// AC-10: 複数端末の同時操作で変更が消えないこと（親機1台＋改訂番号の照合）
// =============================================================================
test('AC-10: 親機以外の書き込みと、古い改訂番号からの上書きが拒否され、変更が消えないこと', async () => {
  const initial = new StoreManager();
  const { call } = await createTestServer({ initialSnapshot: initial.exportSnapshot() });
  const rev0 = initial.revision;

  // 1. 親機がいない状態では書き込めない
  const noWriter = await call({
    method: 'POST',
    url: '/api/state',
    body: { deviceId: 'dev-a', baseRevision: rev0, snapshot: initial.exportSnapshot() },
  });
  assert.equal(noWriter.statusCode, 403);
  assert.equal(noWriter.json.code, 'NO_WRITER');

  // 2. dev-a が親機になる。dev-b は確認なし（takeover: false）では親機になれない
  assert.equal((await call({ method: 'POST', url: '/api/writer', body: { deviceId: 'dev-a' } })).json.ok, true);
  const steal = await call({ method: 'POST', url: '/api/writer', body: { deviceId: 'dev-b' } });
  assert.equal(steal.statusCode, 409);
  assert.equal(steal.json.code, 'WRITER_EXISTS');
  assert.equal(steal.json.writerDeviceId, 'dev-a');

  // 3. 親機 dev-a が注文 #1 を記録 → 成功
  const deviceA = new StoreManager();
  deviceA.importSnapshot(initial.exportSnapshot());
  deviceA.createOrder({
    paidItems: [{ productId: 'butaman', cookingMethod: CookingMethod.STEAM, qty: 2 }],
    paymentInput: { method: PaymentMethod.CASH, amount: 1000 },
  });
  const okA = await call({
    method: 'POST',
    url: '/api/state',
    body: { deviceId: 'dev-a', baseRevision: rev0, snapshot: deviceA.exportSnapshot() },
  });
  assert.equal(okA.json.ok, true);
  const rev1 = okA.json.revision;

  // 4. 閲覧専用の dev-b が古いデータから注文を作って送っても拒否され、注文 #1 は残る
  const deviceB = new StoreManager();
  deviceB.importSnapshot(initial.exportSnapshot());
  deviceB.createOrder({
    paidItems: [{ productId: 'butaman', cookingMethod: CookingMethod.STEAM, qty: 1 }],
  });
  const readOnly = await call({
    method: 'POST',
    url: '/api/state',
    body: { deviceId: 'dev-b', baseRevision: rev0, snapshot: deviceB.exportSnapshot() },
  });
  assert.equal(readOnly.statusCode, 403);
  assert.equal(readOnly.json.code, 'READ_ONLY');
  assert.equal(readOnly.json.snapshot.orders.length, 1); // 拒否応答に最新データが入る

  // 5. 親機でも古い改訂番号（rev0）からの送信は CONFLICT で拒否され、上書きされない
  const stale = await call({
    method: 'POST',
    url: '/api/state',
    body: { deviceId: 'dev-a', baseRevision: rev0, snapshot: initial.exportSnapshot() },
  });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json.code, 'CONFLICT');
  assert.equal(stale.json.revision, rev1);

  const after = await call({ url: '/api/state' });
  assert.equal(after.json.revision, rev1);
  assert.equal(after.json.snapshot.orders.length, 1);
  assert.equal(after.json.snapshot.orders[0][1].totalAmount, 1000);

  // 6. 確認のうえで dev-b に切り替え（takeover: true）→ 元の親機 dev-a は書き込めなくなる
  const takeover = await call({ method: 'POST', url: '/api/writer', body: { deviceId: 'dev-b', takeover: true } });
  assert.equal(takeover.json.ok, true);
  assert.equal(takeover.json.writerDeviceId, 'dev-b');
  assert.equal(takeover.json.snapshot.orders.length, 1); // 切替時に最新データを受け取る

  const oldWriter = await call({
    method: 'POST',
    url: '/api/state',
    body: { deviceId: 'dev-a', baseRevision: rev1, snapshot: deviceA.exportSnapshot() },
  });
  assert.equal(oldWriter.json.code, 'READ_ONLY');

  // 7. 不正なJSONは 400
  const bad = await call({ method: 'POST', url: '/api/state', body: '{broken' });
  assert.equal(bad.statusCode, 400);
});

// =============================================================================
// AC-11: サーバー再起動後も、データと親機の設定がファイルから復元されること
// =============================================================================
test('AC-11: ファイル保存したデータと親機の設定が、サーバー再起動後に復元されること', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-butaman-'));
  const persistFilePath = path.join(dir, 'store-snapshot.json');

  try {
    const first = await createTestServer({ persistFilePath });
    await first.call({ method: 'POST', url: '/api/writer', body: { deviceId: 'dev-parent' } });
    const local = new StoreManager();
    local.createOrder({ paidItems: [{ productId: 'butaman', cookingMethod: CookingMethod.STEAM, qty: 3 }] });
    const saved = await first.call({
      method: 'POST',
      url: '/api/state',
      body: { deviceId: 'dev-parent', baseRevision: 0, snapshot: local.exportSnapshot() },
    });
    assert.equal(saved.json.ok, true);

    // 再起動（同じ保存先で作り直す）
    const second = await createTestServer({ persistFilePath });
    const restored = await second.call({ url: '/api/state' });
    assert.equal(restored.json.revision, saved.json.revision);
    assert.equal(restored.json.writerDeviceId, 'dev-parent');
    assert.equal(restored.json.snapshot.orders.length, 1);
    assert.equal(fs.existsSync(`${persistFilePath}.tmp`), false); // 一時ファイルが残らない
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


// =============================================================================
// AC-12: ロール分離（注文係とキッチン係の独立同時更新と1人運用の両立）
// =============================================================================
test('AC-12: 注文係とキッチン係がそれぞれ独立ドメインを同時更新でき、1人運用時は両方を担当できること', async () => {
  const initial = new StoreManager();
  const { call } = await createTestServer({ initialSnapshot: initial.exportSnapshot() });

  // 1. ロール割当: dev-order が注文係、dev-kitchen がキッチン係
  const r1 = await call({ method: 'POST', url: '/api/roles', body: { deviceId: 'dev-order', role: 'order' } });
  assert.equal(r1.json.ok, true);
  const r2 = await call({ method: 'POST', url: '/api/roles', body: { deviceId: 'dev-kitchen', role: 'kitchen' } });
  assert.equal(r2.json.ok, true);

  // 2. 権限チェック: 注文係がキッチン操作を送ろうとすると拒否される
  const badKitchen = await call({
    method: 'POST',
    url: '/api/state',
    body: { deviceId: 'dev-order', domain: 'kitchen', snapshot: initial.exportSnapshot() },
  });
  assert.equal(badKitchen.statusCode, 403);
  assert.equal(badKitchen.json.code, 'READ_ONLY_KITCHEN');

  // 3. 権限チェック: キッチン係が注文操作を送ろうとすると拒否される
  const badOrder = await call({
    method: 'POST',
    url: '/api/state',
    body: { deviceId: 'dev-kitchen', domain: 'order', snapshot: initial.exportSnapshot() },
  });
  assert.equal(badOrder.statusCode, 403);
  assert.equal(badOrder.json.code, 'READ_ONLY_ORDER');

  // 4. キッチン係がせいろに投入して kitchen 更新
  const kitchenStore = new StoreManager();
  kitchenStore.importSnapshot(initial.exportSnapshot());
  kitchenStore.loadSteamerBatch({ tierNumber: 1, productId: 'butaman', qty: 5 });

  const kUpdate = await call({
    method: 'POST',
    url: '/api/state',
    body: {
      deviceId: 'dev-kitchen',
      domain: 'kitchen',
      baseKitchenRevision: 0,
      snapshot: kitchenStore.exportSnapshot(),
    },
  });
  assert.equal(kUpdate.json.ok, true);
  assert.equal(kUpdate.json.kitchenRevision, 1);

  // 5. 注文係が同時に注文を作成して order 更新（キッチン側の変更を消さない）
  const orderStore = new StoreManager();
  orderStore.importSnapshot(initial.exportSnapshot());
  orderStore.createOrder({
    paidItems: [{ productId: 'butaman', cookingMethod: CookingMethod.STEAM, qty: 2 }],
    paymentInput: { method: PaymentMethod.CASH, amount: 1000 },
  });

  const oUpdate = await call({
    method: 'POST',
    url: '/api/state',
    body: {
      deviceId: 'dev-order',
      domain: 'order',
      baseOrderRevision: 0,
      snapshot: orderStore.exportSnapshot(),
    },
  });
  assert.equal(oUpdate.json.ok, true);
  assert.equal(oUpdate.json.orderRevision, 1);

  // 6. サーバー側の全体状態に両方の変更が共存していること
  const state = await call({ url: '/api/state' });
  assert.equal(state.json.snapshot.orders.length, 1);
  const tier1Batches = state.json.snapshot.tiers.find(([num]) => num === 1)[1].batches;
  assert.equal(tier1Batches.length, 1);
  assert.equal(tier1Batches[0].remainingQty, 5);

  // 7. 1人運用の切り替え: dev-solo が both (両方) を奪還 (takeover: true)
  const solo = await call({
    method: 'POST',
    url: '/api/roles',
    body: { deviceId: 'dev-solo', role: 'both', takeover: true },
  });
  assert.equal(solo.json.ok, true);
  assert.equal(solo.json.kitchenDeviceId, 'dev-solo');
  assert.equal(solo.json.orderDeviceId, 'dev-solo');

  // dev-solo は kitchen も order も両方書き込める
  const soloStore = new StoreManager();
  soloStore.importSnapshot(state.json.snapshot);
  soloStore.recordWaste({ productId: 'butaman', qty: 1, reasonType: WasteReason.DEFECT_HQ });

  const soloKitchen = await call({
    method: 'POST',
    url: '/api/state',
    body: {
      deviceId: 'dev-solo',
      domain: 'kitchen',
      baseKitchenRevision: 1,
      snapshot: soloStore.exportSnapshot(),
    },
  });
  assert.equal(soloKitchen.json.ok, true);

  // 以前の担当者 (dev-order) はもう書き込めない
  const oldOrder = await call({
    method: 'POST',
    url: '/api/state',
    body: {
      deviceId: 'dev-order',
      domain: 'order',
      baseOrderRevision: 1,
      snapshot: soloStore.exportSnapshot(),
    },
  });
  assert.equal(oldOrder.statusCode, 403);
  assert.equal(oldOrder.json.code, 'READ_ONLY_ORDER');
});

// =============================================================================
// AC-13: 4画面構成（設定・ムシ・会計・データ管理）と目標達成率(%)・販売予想個数分析
// =============================================================================
test('AC-13: 設定画面での目標・価格・在庫登録と、データ管理画面での目標達成率(%)・消費率(%)・予想個数分析が機能すること', async () => {
  const store = new StoreManager();

  // 1. 設定画面での登録（営業時間・目標個数・初期持込在庫・価格）
  store.updateBusinessPlan({
    businessHours: { startTime: '09:30', endTime: '16:30' },
    targetSalesCount: { butaman: 100, anbataman: 50, potato: 40 },
    initialInventory: { butaman: 120, anbataman: 60, potato: 50 },
    forecastHourlyRate: 25,
  });

  const updatedConfig = store.eventConfig.catalog.map((p) => {
    if (p.productId === 'butaman') return { ...p, unitPrice: 520 };
    return p;
  });
  store.updateEventConfig({ catalog: updatedConfig });

  // 2. 注文をいくつか投入（有料豚まん10個、あんバタまん5個、無料枠豚まん2個）
  store.createOrder({
    paidItems: [
      { productId: 'butaman', cookingMethod: CookingMethod.STEAM, qty: 10 },
      { productId: 'anbataman', cookingMethod: CookingMethod.STEAM, qty: 5 },
    ],
    freeItems: [
      { productId: 'butaman', cookingMethod: CookingMethod.STEAM, qty: 2 },
    ],
  });

  // 3. データ管理画面のダッシュボード集計を取得
  const dashboard = store.getAnalyticsDashboard();

  // 営業時間
  assert.equal(dashboard.businessHours.startTime, '09:30');
  assert.equal(dashboard.businessHours.endTime, '16:30');

  // 豚まんの達成率: 10個販売 + 2個無料 = 12個 / 目標100個 = 12%
  const buta = dashboard.productStats.butaman;
  assert.equal(buta.soldCount, 12);
  assert.equal(buta.targetCount, 100);
  assert.equal(buta.progressPercent, 12);
  assert.equal(buta.initialInventory, 120);
  assert.equal(buta.remainingInventory, 108);
  assert.equal(buta.inventoryConsumePercent, 10); // 12/120 = 10%

  // 次の1時間の需要予想と蒸し器助言
  assert.equal(dashboard.steamAdvice.forecast.forecastNextHourDemandQty, 25);
  assert.ok(dashboard.steamAdvice.recommendation);
  assert.ok(dashboard.steamAdvice.reason);

  // 4. HTML内に4大タブ（設定・ムシ・注文・データ）が存在すること
  const { call } = await createTestServer({ initialSnapshot: store.exportSnapshot() });
  const htmlRes = await call({ url: '/' });
  assert.equal(htmlRes.statusCode, 200);
  assert.equal(htmlRes.text.includes('tab-settings'), true);
  assert.equal(htmlRes.text.includes('tab-steamer'), true);
  assert.equal(htmlRes.text.includes('tab-pos'), true);
  assert.equal(htmlRes.text.includes('tab-analytics'), true);
  assert.equal(htmlRes.text.includes('btn-save-settings'), true);
});

// =============================================================================
// AC-14: 電気セイロが5段（9〜13段）存在し、各段6個（計30個）の容量計算が機能すること
// =============================================================================
test('AC-14: 電気セイロが5段（9〜13段）存在し、各段6個（計30個）入り、容量超過防止および一括投入が正しく機能すること', () => {
  const store = new StoreManager();
  const tiers = store.getSteamerTiersSnapshot();

  // 1. 電気セイロの段を抽出
  const electricTiers = tiers.filter((t) => t.setId === 'electric-set-1');
  assert.equal(electricTiers.length, 5, '電気セイロは5段であること');

  // 段番号が 9, 10, 11, 12, 13 であること
  const tierNumbers = electricTiers.map((t) => t.tierNumber);
  assert.deepEqual(tierNumbers, [9, 10, 11, 12, 13]);

  // 各段の容量が 6個で確定済みであること
  for (const t of electricTiers) {
    assert.equal(t.capacity, 6, `第${t.tierNumber}段の容量は6個であること`);
    assert.equal(t.capacityVerified, true, `第${t.tierNumber}段の容量は確定済みであること`);
  }

  // 2. 第9段へ6個投入できること
  const batch6 = store.loadSteamerBatch({
    tierNumber: 9,
    productId: 'butaman',
    qty: 6,
  });
  assert.equal(batch6.initialQty, 6);
  assert.equal(batch6.remainingQty, 6);

  // 3. 満杯の第9段へさらに1個追加しようとすると容量超過エラーになること
  assert.throws(
    () => {
      store.loadSteamerBatch({
        tierNumber: 9,
        productId: 'butaman',
        qty: 1,
      });
    },
    /段番号 9 の容量超過です（定員:6個, 現在:6個, 追加:1個）/
  );

  // 4. 第13段（電気セイロの5段目）への一括投入（loadTierFull）できっかり6個入ること
  const fullBatch13 = store.loadTierFull({ tierNumber: 13, productId: 'anbataman' });
  assert.equal(fullBatch13.initialQty, 6);
  assert.equal(fullBatch13.remainingQty, 6);
  assert.equal(fullBatch13.productId, 'anbataman');

  // 5. 全体キャパシティ: 通常8段×5個(40個) + 電気5段×6個(30個) = 70個
  const totalCapacity = tiers.reduce((sum, t) => sum + t.capacity, 0);
  assert.equal(totalCapacity, 70, '全13段の合計容量は70個であること');
});

