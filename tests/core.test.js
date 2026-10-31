'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../docs/core.js');

// 日本時間で日時を作る
const jst = (y, m, d, h, mi = 0) => new Date(Date.UTC(y, m - 1, d, h - 9, mi));
const DAY = 86400000;

function rec(id, date, qty, productId = 'butaman', productName = '豚饅') {
  return { id, occurredAt: date.toISOString(), productId, productName, quantity: qty, method: '店頭' };
}

test('slotOf: 日本時間で曜日と30分の時間帯を判定する', () => {
  const s = Core.slotOf(jst(2026, 10, 31, 11, 15));
  assert.equal(s.dateKey, '2026-10-31');
  assert.equal(s.weekdayLabel, '土');
  assert.equal(s.slotLabel, '11:00-11:30');
  assert.equal(s.time, '11:15');
  // UTCでは前日になる時刻（JST 08:00 = UTC 前日23:00）
  const early = Core.slotOf(jst(2026, 11, 1, 8, 0));
  assert.equal(early.dateKey, '2026-11-01');
  assert.equal(early.weekdayLabel, '日');
  assert.equal(Core.slotOf(jst(2026, 11, 1, 23, 45)).slotLabel, '23:30-24:00');
});

test('normalizeDelivery: 正常な記録は曜日・時間帯を受渡日時から再計算する', () => {
  const now = jst(2026, 10, 31, 12, 0);
  const r = Core.normalizeDelivery({
    id: 'abcdefgh-1234', occurredAt: jst(2026, 10, 31, 11, 50).toISOString(),
    productId: 'butaman', productName: ' 豚饅 ', quantity: 4, method: '店頭', weekday: '月'
  }, { now });
  assert.equal(r.ok, true);
  assert.equal(r.record.weekday, '土');
  assert.equal(r.record.slot, '11:30-12:00');
  assert.equal(r.record.time, '11:50');
  assert.equal(r.record.productName, '豚饅');
  assert.equal(r.record.quantity, 4);
});

test('normalizeDelivery: 不正値を拒否する', () => {
  const now = jst(2026, 10, 31, 12, 0);
  const base = { id: 'abcdefgh-1234', occurredAt: now.toISOString(), productId: 'butaman', quantity: 1, method: '店頭' };
  assert.equal(Core.normalizeDelivery({ ...base, quantity: 0 }, { now }).ok, false);
  assert.equal(Core.normalizeDelivery({ ...base, quantity: 1.5 }, { now }).ok, false);
  assert.equal(Core.normalizeDelivery({ ...base, quantity: 1000 }, { now }).ok, false);
  assert.equal(Core.normalizeDelivery({ ...base, id: 'short' }, { now }).ok, false);
  assert.equal(Core.normalizeDelivery({ ...base, id: 'bad id with space' }, { now }).ok, false);
  assert.equal(Core.normalizeDelivery({ ...base, productId: '<script>' }, { now }).ok, false);
  assert.equal(Core.normalizeDelivery({ ...base, method: '' }, { now }).ok, false);
  assert.equal(Core.normalizeDelivery({ ...base, occurredAt: 'nope' }, { now }).ok, false);
  assert.equal(Core.normalizeDelivery({ ...base, occurredAt: new Date(now.getTime() + 3600000).toISOString() }, { now }).ok, false);
  assert.equal(Core.normalizeDelivery({ ...base, occurredAt: new Date(now.getTime() - 61 * DAY).toISOString() }, { now }).ok, false);
  assert.equal(Core.normalizeDelivery(null, { now }).ok, false);
});

test('forecast: 実績が2回以下なら「学習中」', () => {
  const now = jst(2026, 10, 31, 11, 0); // 土 11:00 → 40分後 11:40（11:30-12:00）
  const records = [
    rec('r00000001', jst(2026, 10, 24, 11, 35), 6),
    rec('r00000002', jst(2026, 10, 17, 11, 45), 4)
  ];
  const f = Core.forecast(records, now);
  assert.equal(f.status, 'learning');
  assert.equal(f.samples, 2);
  assert.equal(f.needed, 1);
  assert.equal(f.total, null);
  assert.equal(f.weekday, '土');
  assert.equal(f.slot, '11:30-12:00');
  assert.equal(f.targetHHMM, '11:40');
});

test('forecast: 同じ曜日・時間帯で3回以上の実績があれば40分後の目安を出す（平均を切り上げ）', () => {
  const now = jst(2026, 10, 31, 11, 0);
  const records = [
    rec('r00000001', jst(2026, 10, 24, 11, 35), 6),
    rec('r00000002', jst(2026, 10, 24, 11, 50), 2), // 同日2件 → 1回分として合算（8）
    rec('r00000003', jst(2026, 10, 17, 11, 45), 4),
    rec('r00000004', jst(2026, 10, 10, 11, 30), 5),
    rec('r00000005', jst(2026, 10, 10, 12, 0), 99),  // 別時間帯 → 除外
    rec('r00000006', jst(2026, 10, 30, 11, 40), 99)  // 別曜日（金）→ 除外
  ];
  const f = Core.forecast(records, now);
  assert.equal(f.status, 'ready');
  assert.equal(f.samples, 3);
  // (8 + 4 + 5) / 3 = 5.67 → 6
  assert.equal(f.total, 6);
  assert.deepEqual(f.byProduct.map(p => [p.productId, p.suggest, p.average]), [['butaman', 6, 5.7]]);
});

test('forecast: 当日分・未来分・参照期間外の実績は使わない', () => {
  const now = jst(2026, 10, 31, 11, 20); // 40分後 = 12:00（12:00-12:30）
  const records = [
    rec('r00000001', jst(2026, 10, 24, 12, 10), 3),
    rec('r00000002', jst(2026, 10, 17, 12, 10), 3),
    rec('r00000003', jst(2026, 10, 31, 12, 5), 50),  // 当日（未来扱い）→ 除外
    rec('r00000004', jst(2026, 8, 29, 12, 10), 50)   // 63日前 → 参照期間外
  ];
  const f = Core.forecast(records, now);
  assert.equal(f.status, 'learning');
  assert.equal(f.samples, 2);
  assert.equal(f.slot, '12:00-12:30');
});

test('forecast: 商品別の目安と合計', () => {
  const now = jst(2026, 10, 31, 11, 0);
  const records = [];
  [24, 17, 10].forEach((d, i) => {
    records.push(rec('a0000000' + i, jst(2026, 10, d, 11, 40), 3, 'butaman', '豚饅'));
    records.push(rec('b0000000' + i, jst(2026, 10, d, 11, 41), 1, 'anman', 'あんまん'));
  });
  const f = Core.forecast(records, now);
  assert.equal(f.status, 'ready');
  assert.equal(f.total, 4);
  assert.deepEqual(f.byProduct.map(p => [p.productName, p.suggest]), [['豚饅', 3], ['あんまん', 1]]);
});

test('forecast: 設定（必要回数・先読み分）を変更できる', () => {
  const now = jst(2026, 10, 31, 11, 0);
  const records = [rec('r00000001', jst(2026, 10, 24, 11, 10), 7)];
  const f = Core.forecast(records, now, { leadMinutes: 10, minSamples: 1 });
  assert.equal(f.status, 'ready');
  assert.equal(f.total, 7);
  assert.equal(f.slot, '11:00-11:30');
});

test('summarize: 曜日×時間帯×商品のナレッジを集計する', () => {
  const rows = Core.summarize([
    rec('r00000001', jst(2026, 10, 24, 11, 35), 6),
    rec('r00000002', jst(2026, 10, 17, 11, 45), 4),
    rec('r00000003', jst(2026, 10, 10, 11, 30), 5),
    rec('r00000004', jst(2026, 10, 30, 15, 0), 2)
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    weekdayIndex: 5, weekday: '金', slotIndex: 30, slot: '15:00-15:30', productId: 'butaman', productName: '豚饅',
    samples: 1, totalQuantity: 2, average: 2, status: '学習中'
  });
  assert.equal(rows[1].weekday, '土');
  assert.equal(rows[1].samples, 3);
  assert.equal(rows[1].average, 5);
  assert.equal(rows[1].status, '目安あり');
});

test('mergeRecords: IDで重複排除し時刻順に並べる', () => {
  const a = rec('r00000002', jst(2026, 10, 24, 12, 0), 1);
  const b = rec('r00000001', jst(2026, 10, 24, 11, 0), 1);
  const merged = Core.mergeRecords([a], [b, { ...a, quantity: 9 }]);
  assert.deepEqual(merged.map(r => r.id), ['r00000001', 'r00000002']);
  assert.equal(merged[1].quantity, 1);
});

test('safeCell: 数式として解釈される文字列を無害化する', () => {
  assert.equal(Core.safeCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(Core.safeCell('+81'), "'+81");
  assert.equal(Core.safeCell('豚饅'), '豚饅');
  assert.equal(Core.safeCell(5), 5);
});

test('deliveryStats: 直近30分と当日（日本時間）の受渡数量を数える', () => {
  const now = jst(2026, 10, 31, 11, 0);
  const s = Core.deliveryStats([
    rec('r00000001', jst(2026, 10, 31, 10, 45), 3),  // 直近30分・今日
    rec('r00000002', jst(2026, 10, 31, 10, 0), 4),   // 今日のみ
    rec('r00000003', jst(2026, 10, 30, 23, 50), 9),  // 前日（UTCでは同日）
    rec('r00000004', jst(2026, 10, 31, 11, 5), 50)   // 未来 → 除外
  ], now, 30);
  assert.deepEqual(s, { recent: 3, today: 7, recentMinutes: 30 });
});
