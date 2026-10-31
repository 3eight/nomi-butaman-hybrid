'use strict';
// 画面スクリプト（docs/app.js）を簡易DOMで動かすスモークテスト
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DOCS = path.join(__dirname, '..', 'docs');

function makeEl(tag) {
  const el = {
    tagName: tag, children: [], listeners: {}, attrs: {}, style: {}, hidden: false, disabled: false, className: '', title: '',
    _text: '',
    get textContent() { return this._text + this.children.map(c => c.textContent).join(''); },
    set textContent(v) { this._text = String(v); this.children = []; },
    appendChild(c) { this.children.push(c); return c; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    click() { (this.listeners.click || []).forEach(fn => fn()); }
  };
  return el;
}

function boot(storage, hash = '', opts = {}) {
  const ids = {};
  const document = {
    hidden: false,
    getElementById: id => ids[id] || (ids[id] = makeEl('div')),
    createElement: tag => makeEl(tag),
    createTextNode: t => ({ textContent: String(t) }),
    addEventListener() {}
  };
  const timers = [];
  const location = { protocol: 'file:', hash };
  const history = { replaceState: (a, b, h) => { location.hash = h; } };
  const window = {
    NOMI_CONFIG: undefined, localStorage: storage, fetch: opts.fetch || (() => Promise.reject(new Error('offline'))),
    addEventListener() {}, history, scrollTo() {}
  };
  const ctx = {
    window, document, console, JSON, Date, Math, Promise, Error, TypeError, Object, Array, String, Number,
    navigator: { onLine: opts.online !== false }, location, history, crypto: globalThis.crypto,
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout() {}, setInterval() {}
  };
  window.window = window;
  vm.createContext(ctx);
  for (const f of ['config.js', 'core.js', 'sync.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(DOCS, f), 'utf8'), ctx, { filename: f });
    if (f === 'config.js' && opts.config) Object.assign(window.NOMI_CONFIG, opts.config);
  }
  return { ids, timers, ctx, location };
}

function memoryStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

test('初期表示: データ不足なら「学習中」を最大表示し、商品が1つなら商品欄を隠す', () => {
  const { ids } = boot(memoryStorage());
  assert.equal(ids['steam-value'].textContent, '学習中');
  assert.match(ids['steam-value'].className, /learning/);
  assert.match(ids['steam-sub'].textContent, /0\/3回/);
  assert.equal(ids['product-field'].hidden, true);
  assert.equal(ids['method-options'].children.length, 3);
  assert.equal(ids['quick-qty'].children.length, 4);
  assert.equal(ids['net'].textContent, '接続確認中…');
});

const tick = () => new Promise(r => setImmediate(r));

test('接続表示: GAS未設定なら「端末内のみ」', () => {
  const { ids } = boot(memoryStorage(), '', { config: { gasUrl: '' } });
  assert.equal(ids['net'].textContent, '端末内のみ');
});

test('接続表示: GASと通信できたら「共有接続済み」', async () => {
  const fetch = (url, o) => Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, records: [] }) });
  const { ids } = boot(memoryStorage(), '', { fetch, config: { gasUrl: 'https://example.test/exec' } });
  for (let i = 0; i < 10; i++) await tick();
  assert.equal(ids['net'].textContent, '共有接続済み');
  assert.match(ids['foot'].textContent, /最終同期/);
});

test('接続表示: 通信に失敗したら「再接続中」', async () => {
  const { ids } = boot(memoryStorage(), '', { config: { gasUrl: 'https://example.test/exec' } });
  for (let i = 0; i < 10; i++) await tick();
  assert.equal(ids['net'].textContent, '再接続中');
});

test('受渡完了: 数量を選んで記録すると最近の受渡に「未送信」で並ぶ', () => {
  const storage = memoryStorage();
  const { ids, timers } = boot(storage);
  ids['quick-qty'].children[2].click();      // 5個
  ids['qty-plus'].listeners.click[0]();      // 6個
  assert.equal(ids['qty'].textContent, '6');
  ids['method-options'].children[1].click(); // 予約受取
  ids['submit'].listeners.click[0]();
  assert.match(ids['toast'].textContent, /記録しました：豚饅 ×6/);
  assert.equal(ids['qty'].textContent, '1');
  assert.equal(ids['submit'].disabled, true); // 連打防止
  const recent = ids['recent'].children;
  assert.equal(recent.length, 1);
  assert.match(recent[0].textContent, /豚饅 ×6（予約受取）/);
  assert.match(recent[0].textContent, /未送信/);
  // 連打しても二重登録されない
  ids['submit'].listeners.click[0]();
  assert.equal(JSON.parse(storage.getItem('nomi.records.v1')).length, 1);
  timers.forEach(fn => fn());
  assert.equal(ids['submit'].disabled, false);
});

test('タブ: 初期はキッチン画面。会計タブで切り替わり、選択は保存・URLに反映される', () => {
  const storage = memoryStorage();
  const { ids, location } = boot(storage);
  assert.equal(ids['view-kitchen'].hidden, false);
  assert.equal(ids['view-register'].hidden, true);
  assert.equal(ids['tab-kitchen'].attrs['aria-selected'], 'true');

  ids['tab-register'].click();
  assert.equal(ids['view-kitchen'].hidden, true);
  assert.equal(ids['view-register'].hidden, false);
  assert.equal(ids['tab-register'].attrs['aria-selected'], 'true');
  assert.equal(ids['tab-kitchen'].attrs['aria-selected'], 'false');
  assert.equal(storage.getItem('nomi.view.v1'), 'register');
  assert.equal(location.hash, '#register');

  // 再読み込みしても会計画面のまま
  const again = boot(storage);
  assert.equal(again.ids['view-register'].hidden, false);
});

test('タブ: URL末尾 #register / #kitchen で直接開ける（保存より優先）', () => {
  const storage = memoryStorage();
  storage.setItem('nomi.view.v1', 'kitchen');
  const { ids } = boot(storage, '#register');
  assert.equal(ids['view-register'].hidden, false);
  assert.equal(ids['view-kitchen'].hidden, true);
});

test('キッチン画面: 会計で記録すると直近30分・今日の受渡数が増える', () => {
  const storage = memoryStorage();
  const { ids } = boot(storage);
  assert.equal(ids['stat-recent'].textContent, '0個');
  ids['tab-register'].click();
  ids['quick-qty'].children[1].click(); // 2個
  ids['submit'].listeners.click[0]();
  assert.equal(ids['stat-recent'].textContent, '2個');
  assert.equal(ids['stat-today'].textContent, '2個');
});

test('接続表示: 端末が圏外なら「圏外」と未送信件数', () => {
  const { ids } = boot(memoryStorage(), '', { online: false, config: { gasUrl: 'https://example.test/exec' } });
  ids['submit'].listeners.click[0]();
  assert.equal(ids['net'].textContent, '圏外 ・ 未送信1');
});
