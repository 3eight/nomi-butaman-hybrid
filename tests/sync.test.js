'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSync } = require('../docs/sync.js');

const jst = (y, m, d, h, mi = 0) => new Date(Date.UTC(y, m - 1, d, h - 9, mi));

function memoryStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    dump: () => Object.fromEntries(m)
  };
}

function jsonResponse(obj, status = 200) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(obj) });
}

const NOW = jst(2026, 10, 31, 11, 0);
const input = { productId: 'butaman', productName: '豚饅', quantity: 3, method: '店頭' };

test('URL未設定でも端末内に記録でき、キューに残る', async () => {
  const storage = memoryStorage();
  const s = createSync({ storage, fetch: () => assert.fail('通信しないこと'), config: {}, now: () => NOW });
  const r = s.addDelivery(input);
  assert.equal(r.weekday, '土');
  assert.equal(r.slot, '11:00-11:30');
  assert.equal(r.pending, true);
  assert.equal(s.getQueue().length, 1);
  const res = await s.flush();
  assert.equal(res.skipped, true);
  // 再読み込みしても残っている
  const s2 = createSync({ storage, fetch: () => {}, config: {}, now: () => NOW });
  assert.equal(s2.getRecords().length, 1);
  assert.equal(s2.getQueue().length, 1);
});

test('不正な入力は例外になり保存されない', () => {
  const s = createSync({ storage: memoryStorage(), fetch: () => {}, config: {}, now: () => NOW });
  assert.throws(() => s.addDelivery({ ...input, quantity: 0 }), /数量/);
  assert.equal(s.getRecords().length, 0);
});

test('flush: text/plain の POST で recordDeliveries を送り、成功・重複はキューから消す', async () => {
  const calls = [];
  const fetch = (url, opts) => {
    calls.push({ url, opts, body: JSON.parse(opts.body) });
    const ids = JSON.parse(opts.body).payload.records.map(r => r.id);
    return jsonResponse({ ok: true, results: [{ ok: true, id: ids[0], duplicate: false }, { ok: true, id: ids[1], duplicate: true }] });
  };
  const s = createSync({ storage: memoryStorage(), fetch, config: { gasUrl: 'https://example.test/exec', sharedKey: 'k' }, now: () => NOW });
  s.addDelivery(input);
  s.addDelivery({ ...input, quantity: 1 });
  const res = await s.flush();
  assert.equal(res.sent, 2);
  assert.equal(res.remaining, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.method, 'POST');
  assert.match(calls[0].opts.headers['Content-Type'], /^text\/plain/);
  assert.equal(calls[0].body.command, 'recordDeliveries');
  assert.equal(calls[0].body.key, 'k');
  assert.equal(calls[0].body.payload.records.length, 2);
  assert.ok(s.getRecords().every(r => !r.pending));
  assert.ok(s.getMeta().lastSyncAt);
});

test('flush: 圏外（通信失敗）ならキューを保持し、次回に同じIDで再送する', async () => {
  let online = false;
  const sentIds = [];
  const fetch = (url, opts) => {
    const ids = JSON.parse(opts.body).payload.records.map(r => r.id);
    sentIds.push(...ids);
    if (!online) return Promise.reject(new TypeError('Failed to fetch'));
    return jsonResponse({ ok: true, results: ids.map(id => ({ ok: true, id })) });
  };
  const s = createSync({ storage: memoryStorage(), fetch, config: { gasUrl: 'https://example.test/exec' }, now: () => NOW });
  const r = s.addDelivery(input);
  const first = await s.flush();
  assert.equal(first.sent, 0);
  assert.match(first.error, /電波待ち/);
  assert.equal(s.getQueue().length, 1);
  online = true;
  const second = await s.flush();
  assert.equal(second.sent, 1);
  assert.deepEqual(sentIds, [r.id, r.id]);
  assert.equal(s.getQueue().length, 0);
});

test('flush: サーバー混雑（busy）はキューを保持する', async () => {
  const fetch = () => jsonResponse({ ok: false, code: 'busy', error: '混み合っています', retryable: true });
  const s = createSync({ storage: memoryStorage(), fetch, config: { gasUrl: 'https://example.test/exec' }, now: () => NOW });
  s.addDelivery(input);
  await s.flush();
  assert.equal(s.getQueue().length, 1);
});

test('flush: サーバーが個別に拒否した記録はエラー表示にしてキューから外す', async () => {
  const fetch = (url, opts) => {
    const id = JSON.parse(opts.body).payload.records[0].id;
    return jsonResponse({ ok: true, results: [{ ok: false, id, error: '受渡日時が未来です' }] });
  };
  const s = createSync({ storage: memoryStorage(), fetch, config: { gasUrl: 'https://example.test/exec' }, now: () => NOW });
  s.addDelivery(input);
  await s.flush();
  assert.equal(s.getQueue().length, 0);
  assert.equal(s.getRecords()[0].syncError, '受渡日時が未来です');
});

test('flush: 同時に呼ばれても通信は1本だけ', async () => {
  let count = 0;
  const fetch = (url, opts) => {
    count++;
    const ids = JSON.parse(opts.body).payload.records.map(r => r.id);
    return new Promise(res => setTimeout(() => res({ ok: true, status: 200, json: async () => ({ ok: true, results: ids.map(id => ({ ok: true, id })) }) }), 10));
  };
  const s = createSync({ storage: memoryStorage(), fetch, config: { gasUrl: 'https://example.test/exec' }, now: () => NOW });
  s.addDelivery(input);
  await Promise.all([s.flush(), s.flush(), s.flush()]);
  assert.equal(count, 1);
});

test('pull: 他端末の記録を取り込み、蒸し目安に反映される', async () => {
  const remote = [24, 17, 10].map((d, i) => ({
    id: 'remote000' + i, occurredAt: jst(2026, 10, d, 11, 40).toISOString(),
    productId: 'butaman', productName: '豚饅', quantity: 5, method: '店頭'
  }));
  const fetch = (url, opts) => {
    assert.equal(JSON.parse(opts.body).command, 'listDeliveries');
    return jsonResponse({ ok: true, records: remote });
  };
  const s = createSync({ storage: memoryStorage(), fetch, config: { gasUrl: 'https://example.test/exec' }, now: () => NOW });
  assert.equal(s.forecast().status, 'learning');
  await s.pull();
  await s.pull(); // 2回取り込んでも重複しない
  assert.equal(s.getRecords().length, 3);
  const f = s.forecast();
  assert.equal(f.status, 'ready');
  assert.equal(f.total, 5);
});

test('端末IDは保存され再利用される', () => {
  const storage = memoryStorage();
  const a = createSync({ storage, fetch: () => {}, config: {}, now: () => NOW });
  const b = createSync({ storage, fetch: () => {}, config: {}, now: () => NOW });
  assert.equal(a.getMeta().deviceId, b.getMeta().deviceId);
  assert.match(a.getMeta().deviceId, /^dev-/);
});
