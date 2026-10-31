'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../docs/core.js');

const T0 = Date.UTC(2026, 10, 1, 1, 0); // 2026-11-01 10:00 JST
const MIN = 60000;
let n = 0;
const op = (type, payload, atMs, device = 'dev-a') => ({ id: 'op' + String(++n).padStart(8, '0'), type, payload, at: new Date(atMs).toISOString(), device });
const start = (batchId, tier, qty, atMs, product = 'butaman') => op('batch_start', { batchId, tier, product, qty }, atMs);

test('buildState: 段ごとに蒸し中→確認待ち→販売可能、残り分と次の蒸し上がり', () => {
  const ops = [start('b1', 1, 5, T0), start('b2', 9, 6, T0 + 10 * MIN)];
  let s = Core.buildState(ops, T0 + 25 * MIN);
  assert.equal(s.tiers.length, 12);
  assert.equal(s.tiers[0].status, 'steaming');
  assert.equal(s.tiers[0].remainingMinutes, 15);
  assert.equal(s.totals.steaming, 11);
  assert.deepEqual([s.nextReady.tier, s.nextReady.minutes], [1, 15]);

  s = Core.buildState(ops, T0 + 41 * MIN);
  assert.equal(s.tiers[0].status, 'check');            // タイマー満了だけでは販売可能にしない
  assert.equal(s.totals.ready, 0);
  assert.equal(s.totals.check, 5);

  s = Core.buildState(ops.concat(op('batch_ready', { batchId: 'b1' }, T0 + 42 * MIN)), T0 + 43 * MIN);
  assert.equal(s.tiers[0].status, 'ready');
  assert.equal(s.totals.ready, 5);
  assert.equal(s.tiers[8].capacity, 6);
});

test('buildState: 同じ段への追加投入は別管理、取消・廃棄・ロス金額', () => {
  const ops = [
    start('b1', 2, 3, T0), start('b2', 2, 1, T0 + 5 * MIN),
    op('batch_cancel', { batchId: 'b2' }, T0 + 6 * MIN),
    start('b3', 2, 2, T0 + 7 * MIN),
    op('waste', { batchId: 'b1', qty: 1, burden: 'store' }, T0 + 50 * MIN),
    op('waste', { batchId: 'b1', qty: 9, burden: 'hq' }, T0 + 51 * MIN) // 残数を超える廃棄は残数まで
  ];
  const s = Core.buildState(ops, T0 + 52 * MIN);
  const t = s.tiers[1];
  assert.equal(t.batches.length, 1);       // b1は廃棄で0、b2は取消
  assert.equal(t.batches[0].batchId, 'b3');
  assert.equal(t.qty, 2);
  assert.equal(t.free, 3);
  assert.deepEqual(s.loss, { storePieces: 1, storeYen: 250, hqPieces: 2 });
});

test('serviceEntitled / orderNeeds: 有料まん類5個ごとに1個、ポテトは数えない', () => {
  const lines = [{ product: 'butaman', method: 'steam', qty: 3 }, { product: 'anbata', method: 'fry', qty: 7 }, { product: 'potato', method: '', qty: 9 }];
  assert.equal(Core.serviceEntitled(lines), 2);
  assert.equal(Core.serviceEntitled(lines, { serviceOn: false }), 0);
  const order = { lines, service: [{ product: 'butaman', method: 'steam', qty: 2 }] };
  assert.deepEqual(Core.orderNeeds(order), { butaman: 5, anbata: 7 });
  assert.deepEqual(Core.orderNeeds(order, { friedFromSteamed: false }), { butaman: 5 });
});

test('注文: 待ち注文は受付順に在庫を予約し、二重に割り当てない', () => {
  const ops = [
    start('b1', 1, 5, T0), op('batch_ready', { batchId: 'b1' }, T0 + 41 * MIN),
    start('b2', 5, 5, T0 + 2 * MIN), // 確認待ち
    op('order_create', { orderId: 'o1', number: 1, lines: [{ product: 'butaman', method: 'steam', qty: 4 }], service: [], paid: true }, T0 + 43 * MIN),
    op('order_create', { orderId: 'o2', number: 2, lines: [{ product: 'butaman', method: 'steam', qty: 4 }], service: [], paid: false }, T0 + 44 * MIN),
    op('order_create', { orderId: 'o3', number: 3, lines: [{ product: 'butaman', method: 'steam', qty: 4 }], service: [], paid: true }, T0 + 45 * MIN)
  ];
  const s = Core.buildState(ops, T0 + 46 * MIN);
  assert.deepEqual(s.waiting.map(o => o.plan.allocations.map(a => [a.tier, a.qty])), [[[1, 4]], [[1, 1], [5, 3]], [[5, 2]]]);
  assert.deepEqual(s.waiting.map(o => o.plan.shortage), [0, 0, 2]);
  assert.equal(s.reserved, 10);
  assert.equal(s.nextOrderNumber, 4);
});

test('お渡し: 割当どおり段の残数を減らし、販売実績を数える。重複・取消後のお渡しは無視', () => {
  const base = [
    start('b1', 1, 5, T0), op('batch_ready', { batchId: 'b1' }, T0 + 41 * MIN),
    op('order_create', { orderId: 'o1', number: 1, lines: [{ product: 'butaman', method: 'steam', qty: 5 }], service: [{ product: 'butaman', method: 'steam', qty: 1 }], paid: false }, T0 + 42 * MIN)
  ];
  let s = Core.buildState(base, T0 + 43 * MIN);
  const plan = Core.planFulfill(s, s.orders[0]);
  assert.deepEqual(plan, { allocations: [{ batchId: 'b1', tier: 1, product: 'butaman', qty: 5 }], shortage: 1 });
  const ful = op('order_fulfill', { orderId: 'o1', paid: true, allocations: [{ batchId: 'b1', qty: 5 }], shortage: 1 }, T0 + 44 * MIN);
  s = Core.buildState(base.concat(ful, { ...ful }, op('order_fulfill', { orderId: 'o1', allocations: [{ batchId: 'b1', qty: 5 }] }, T0 + 45 * MIN)), T0 + 46 * MIN);
  assert.equal(s.totals.ready, 0);
  assert.equal(s.tiers[0].status, 'empty');
  assert.equal(s.orders[0].fulfilled, true);
  assert.equal(s.orders[0].paid, true);
  assert.equal(s.orders[0].shortage, 1);
  assert.deepEqual(s.sold, { orders: 1, pieces: 5, service: 1 });

  const cancelled = Core.buildState(base.concat(op('order_cancel', { orderId: 'o1' }, T0 + 43 * MIN), ful), T0 + 46 * MIN);
  assert.equal(cancelled.orders[0].fulfilled, false);
  assert.equal(cancelled.totals.ready, 5);
});

test('注文番号: 2台が同時に同じ番号を付けたら端末記号で区別', () => {
  const ops = [
    op('order_create', { orderId: 'o1', number: 7, lines: [], service: [] }, T0, 'dev-xxab'),
    op('order_create', { orderId: 'o2', number: 7, lines: [], service: [] }, T0 + 1000, 'dev-yycd')
  ];
  const s = Core.buildState(ops, T0 + MIN);
  assert.deepEqual(s.orders.map(o => o.label), ['7-AB', '7-CD']);
  assert.equal(s.nextOrderNumber, 8);
});

test('normalizeOp: 検証と日付付与', () => {
  const now = new Date(T0);
  const ok = Core.normalizeOp({ id: 'abcdefgh1', type: 'batch_start', payload: { tier: 1 }, at: now.toISOString(), device: 'd' }, { now });
  assert.equal(ok.ok, true);
  assert.equal(ok.op.date, '2026-11-01');
  assert.equal(Core.normalizeOp({ id: 'abcdefgh1', type: 'drop_table', payload: {}, at: now.toISOString() }, { now }).ok, false);
  assert.equal(Core.normalizeOp({ id: 'abc', type: 'waste', payload: {}, at: now.toISOString() }, { now }).ok, false);
  assert.equal(Core.normalizeOp({ id: 'abcdefgh1', type: 'waste', payload: [], at: now.toISOString() }, { now }).ok, false);
  assert.equal(Core.normalizeOp({ id: 'abcdefgh1', type: 'waste', payload: { x: 'a'.repeat(5000) }, at: now.toISOString() }, { now }).ok, false);
  assert.equal(Core.normalizeOp({ id: 'abcdefgh1', type: 'waste', payload: {}, at: new Date(T0 + 3600000).toISOString() }, { now }).ok, false);
});

test('steamAdvice: 需要 − (販売可能＋確認待ち＋蒸し中 − 予約) を段数に換算', () => {
  const state = { totals: { ready: 4, check: 1, steaming: 5 }, reserved: 3 };
  assert.deepEqual(Core.steamAdvice(state, { status: 'ready', total: 18 }), { status: 'ready', demand: 18, supply: 7, need: 11, tiers: 3 });
  assert.equal(Core.steamAdvice(state, { status: 'ready', total: 5 }).need, 0);
  assert.equal(Core.steamAdvice(state, { status: 'learning', samples: 1, needed: 2 }).status, 'learning');
});

test('normalizeCatalog: 必須項目・重複・価格を検証し、会計ボタンと在庫設定を作る', () => {
  const ok = Core.normalizeCatalog({
    products: [
      { id: 'nikuman', name: ' 肉まん ', man: true, methods: ['steam', 'steam', 'bake'], prices: { steam: '400' } },
      { id: 'drink', name: 'お茶', man: false, methods: [], prices: { '': 150 }, enabled: true },
      { id: 'old', name: '旧商品', man: true, methods: ['fry'], enabled: false }
    ],
    options: { serviceOn: true, serviceEvery: 0 }
  });
  assert.equal(ok.ok, true);
  const c = ok.catalog;
  assert.deepEqual(c.products[0], { id: 'nikuman', name: '肉まん', short: '肉まん', man: true, methods: ['steam'], prices: { steam: 400 }, enabled: true });
  assert.equal(c.options.serviceEvery, 5);
  assert.deepEqual(Core.menuFromCatalog(c).map(m => [m.key, m.name, m.price]), [['nikuman_steam', '肉まん', 400], ['drink', 'お茶', 150]]);
  const opt = Core.catalogOptions(c);
  assert.deepEqual(opt.manProducts, ['nikuman', 'old']);
  assert.equal(Core.serviceEntitled([{ product: 'nikuman', qty: 5 }, { product: 'drink', qty: 5 }], opt), 1);

  assert.equal(Core.normalizeCatalog({ products: [{ id: 'a', name: '' }] }).ok, false);
  assert.equal(Core.normalizeCatalog({ products: [{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }] }).ok, false);
  assert.equal(Core.normalizeCatalog({ products: [{ id: 'a b', name: 'A' }] }).ok, false);
  assert.equal(Core.normalizeCatalog({ products: [{ id: 'a', name: 'A', methods: ['steam'], prices: { steam: -1 } }] }).ok, false);
  assert.equal(Core.normalizeCatalog({ products: [{ id: 'a', name: 'A', methods: ['steam'], prices: { steam: 1.5 } }] }).ok, false);
  assert.equal(Core.normalizeCatalog(null).ok, false);
});
