'use strict';
// 画面スクリプト（docs/app.js）を簡易DOMで動かすスモークテスト
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Core = require('../docs/core.js');

const DOCS = path.join(__dirname, '..', 'docs');

function makeEl(tag) {
  const el = {
    tagName: tag, children: [], listeners: {}, attrs: {}, style: {}, hidden: false, disabled: false,
    className: '', title: '', type: '', checked: false, _text: '', parent: null,
    get textContent() { return this._text + this.children.map(c => c.textContent).join(''); },
    set textContent(v) { this._text = String(v == null ? '' : v); this.children = []; },
    appendChild(c) { c.parent = this; this.children.push(c); return c; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    click() { (this.listeners.click || []).forEach(fn => fn({ target: this, stopPropagation() {} })); }
  };
  return el;
}

function all(root, pred, out = []) {
  if (!root || !root.children) return out;
  for (const c of root.children) { if (pred(c)) out.push(c); all(c, pred, out); }
  return out;
}
const byText = (root, text) => all(root, c => c.tagName === 'button' && c.textContent.includes(text))[0];

function memoryStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

function boot(storage, opts = {}) {
  const ids = {};
  const body = makeEl('body');
  const document = {
    hidden: false, body,
    getElementById: id => ids[id] || (ids[id] = makeEl('div')),
    createElement: tag => makeEl(tag),
    createElementNS: (ns, tag) => makeEl(tag),
    createTextNode: t => ({ textContent: String(t) }),
    addEventListener() {}
  };
  ids.sheet = makeEl('div'); ids.sheet.hidden = true;
  const location = { protocol: 'file:', hash: opts.hash || '' };
  const history = { replaceState: (a, b, h) => { location.hash = h; } };
  const window = {
    NOMI_CONFIG: undefined, localStorage: storage,
    fetch: opts.fetch || (() => Promise.reject(new Error('offline'))),
    addEventListener() {}, history, scrollTo() {}, confirm: () => true
  };
  const ctx = {
    window, document, console, JSON, Date, Math, Promise, Error, TypeError, Object, Array, String, Number,
    navigator: { onLine: opts.online !== false }, location, history, crypto: globalThis.crypto,
    setTimeout: () => 0, clearTimeout() {}, setInterval() {}
  };
  window.window = window;
  vm.createContext(ctx);
  for (const f of ['config.js', 'core.js', 'sync.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(DOCS, f), 'utf8'), ctx, { filename: f });
    if (f === 'config.js' && opts.config) Object.assign(window.NOMI_CONFIG, opts.config);
  }
  return { ids, ctx, location, body };
}

const tick = () => new Promise(r => setImmediate(r));
const MIN = 60000;
function op(type, payload, msAgo = 0, device = 'dev-other') {
  const at = new Date(Date.now() - msAgo).toISOString();
  return { id: 'op' + Math.random().toString(36).slice(2, 12), type, payload, at, date: Core.jstParts(at).dateKey, device };
}
function storageWithOps(ops) { return memoryStorage({ 'nomi.ops.v1': JSON.stringify(ops) }); }
const LOCAL = { config: { gasUrl: '' } };

test('初期表示: キッチン画面に3つの主表示と12段のせいろ', () => {
  const { ids } = boot(memoryStorage(), LOCAL);
  assert.equal(ids['view-kitchen'].hidden, false);
  assert.equal(ids['k-ready'].textContent, '0個');
  assert.equal(ids['k-steaming'].textContent, '0個');
  assert.equal(ids['steam-value'].textContent, '学習中');
  const tiles = all(ids.tiers, c => c.attrs && c.attrs['data-tier']);
  assert.equal(tiles.length, 12);
  assert.match(ids.tiers.textContent, /通常せいろ 1セット目（5個\/段）/);
  assert.match(ids.tiers.textContent, /電気せいろ（6個\/段・実容量未確認）/);
  assert.equal(ids.net.textContent, '端末内のみ');
});

test('キッチン: 空き段をタップ→蒸し開始で、段が蒸し中（残り40分）になる', () => {
  const storage = memoryStorage();
  const { ids } = boot(storage, LOCAL);
  all(ids.tiers, c => c.attrs && c.attrs['data-tier'] === '3')[0].click();
  assert.equal(ids.sheet.hidden, false);
  assert.equal(ids['sheet-title'].textContent, '3段（通常1セット目・5個）');
  assert.equal(all(ids['sheet-body'], c => c.className === 'qty')[0].textContent, '5'); // 初期値=空き容量
  byText(ids['sheet-body'], 'あんバタまん').click();
  byText(ids['sheet-body'], '蒸し開始').click();
  assert.equal(ids.sheet.hidden, true);
  assert.equal(ids['k-steaming'].textContent, '5個');
  assert.match(ids['k-next'].textContent, /3段 あと40分/);
  const ops = JSON.parse(storage.getItem('nomi.ops.v1'));
  assert.equal(ops.length, 1);
  assert.equal(ops[0].type, 'batch_start');
  assert.deepEqual([ops[0].payload.tier, ops[0].payload.product, ops[0].payload.qty], [3, 'anbata', 5]);
});

test('キッチン: 40分経過で「確認」表示、蒸し上がり確認で販売可能に', () => {
  const storage = storageWithOps([op('batch_start', { batchId: 'b1aaaaaaaa', tier: 9, product: 'butaman', qty: 6 }, 41 * MIN)]);
  const { ids } = boot(storage, LOCAL);
  const tile = all(ids.tiers, c => c.attrs && c.attrs['data-tier'] === '9')[0];
  assert.match(tile.className, /check/);
  assert.equal(ids['k-ready'].textContent, '0個');
  assert.match(ids['k-ready-sub'].textContent, /確認待ち 6/);
  tile.click();
  byText(ids['sheet-body'], '蒸し上がり確認').click();
  assert.equal(ids['k-ready'].textContent, '6個');
});

test('会計: 6個注文でサービス1個、受付→お渡しで段の在庫が減り実績と学習記録に残る', () => {
  const storage = storageWithOps([
    op('batch_start', { batchId: 'b1aaaaaaaa', tier: 1, product: 'butaman', qty: 5 }, 50 * MIN),
    op('batch_ready', { batchId: 'b1aaaaaaaa' }, 5 * MIN),
    op('batch_start', { batchId: 'b2aaaaaaaa', tier: 2, product: 'butaman', qty: 5 }, 45 * MIN),
    op('batch_ready', { batchId: 'b2aaaaaaaa' }, 4 * MIN)
  ]);
  const { ids } = boot(storage, { ...LOCAL, hash: '#register' });
  assert.equal(ids['view-register'].hidden, false);
  assert.equal(ids['order-no'].textContent, '#1');
  const butaSteam = () => all(ids.menu, c => c.className.startsWith('menu-item') && c.textContent.startsWith('豚まん蒸し'))[0];
  for (let i = 0; i < 6; i++) butaSteam().click();
  assert.equal(ids['service-row'].hidden, false);
  assert.equal(ids['service-count'].textContent, '1');
  assert.match(ids['order-summary'].textContent, /お渡し合計 7個（うちサービス1） ・ 金額 未設定/);
  ids['order-paid'].click();
  assert.equal(ids['waiting-count'].textContent, '1');
  assert.match(ids.waiting.textContent, /#1/);
  assert.match(ids.waiting.textContent, /豚まん 蒸し×6 ＋サービス 豚まん 蒸し×1/);
  assert.match(ids.waiting.textContent, /取り出し: ①段 5個 ・ ②段 2個/);
  assert.equal(ids['k-ready'].textContent, '10個');
  assert.match(ids['k-ready-sub'].textContent, /予約 7/);

  byText(ids.waiting, 'お渡し完了').click();
  assert.equal(ids['waiting-count'].textContent, '0');
  assert.equal(ids['k-ready'].textContent, '3個');
  assert.match(ids['day-stats'].textContent, /1注文6販売（有料）1サービス/);
  const records = JSON.parse(storage.getItem('nomi.records.v1'));
  assert.equal(records.length, 1);
  assert.deepEqual([records[0].productId, records[0].quantity, records[0].method], ['butaman_steam', 7, '蒸し']);
  assert.equal(ids['order-no'].textContent, '#2');
});

test('会計: サービス辞退・後払い・取消', () => {
  const storage = memoryStorage();
  const { ids } = boot(storage, { ...LOCAL, hash: '#register' });
  const item = name => all(ids.menu, c => c.className.startsWith('menu-item') && c.textContent.startsWith(name))[0];
  for (let i = 0; i < 5; i++) item('あんバタまん揚げ').click();
  byText(ids['service-options'], '辞退').click();
  assert.match(ids['order-summary'].textContent, /お渡し合計 5個 /);
  ids['order-later'].click();
  assert.match(ids.waiting.textContent, /未払い/);
  assert.match(ids.waiting.textContent, /サービス辞退/);
  assert.match(ids.waiting.textContent, /不足 5個/);
  byText(ids.waiting, '取消').click();
  assert.equal(ids['waiting-count'].textContent, '0');
});

test('共有: 他のスマホの操作を取り込み「共有接続済み」になる', async () => {
  const remote = [op('batch_start', { batchId: 'bxaaaaaaaa', tier: 5, product: 'butaman', qty: 5 }, 10 * MIN)];
  const calls = [];
  const fetch = (url, o) => {
    const body = JSON.parse(o.body);
    calls.push(body.command);
    const res = body.command === 'listOps' ? { ok: true, ops: remote } : body.command === 'listDeliveries' ? { ok: true, records: [] } : { ok: true, results: [] };
    return Promise.resolve({ ok: true, status: 200, json: async () => res });
  };
  const { ids } = boot(memoryStorage(), { fetch, config: { gasUrl: 'https://example.test/exec' } });
  for (let i = 0; i < 20; i++) await tick();
  assert.equal(ids.net.textContent, '共有接続済み');
  assert.equal(ids['k-steaming'].textContent, '5個');
  assert.match(ids['k-next'].textContent, /5段 あと30分/);
  assert.ok(calls.includes('listOps'));
});

test('圏外: 操作は端末に残り「圏外 ・ 未送信」と表示', () => {
  const { ids } = boot(memoryStorage(), { online: false, config: { gasUrl: 'https://example.test/exec' } });
  all(ids.tiers, c => c.attrs && c.attrs['data-tier'] === '1')[0].click();
  byText(ids['sheet-body'], '蒸し開始').click();
  assert.equal(ids.net.textContent, '圏外 ・ 未送信1');
  assert.equal(ids['k-steaming'].textContent, '5個');
});

test('タブ: 会計タブで切り替わり、選択は保存・URLに反映される', () => {
  const storage = memoryStorage();
  const { ids, location } = boot(storage, LOCAL);
  ids['tab-register'].click();
  assert.equal(ids['view-register'].hidden, false);
  assert.equal(ids['view-kitchen'].hidden, true);
  assert.equal(storage.getItem('nomi.view.v1'), 'register');
  assert.equal(location.hash, '#register');
  assert.equal(boot(storage, LOCAL).ids['view-register'].hidden, false);
});
