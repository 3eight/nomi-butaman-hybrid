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

function boot(storage) {
  const ids = {};
  const document = {
    hidden: false,
    getElementById: id => ids[id] || (ids[id] = makeEl('div')),
    createElement: tag => makeEl(tag),
    createTextNode: t => ({ textContent: String(t) }),
    addEventListener() {}
  };
  const timers = [];
  const window = {
    NOMI_CONFIG: undefined, localStorage: storage, fetch: () => Promise.reject(new Error('offline')),
    addEventListener() {}
  };
  const ctx = {
    window, document, console, JSON, Date, Math, Promise, Error, TypeError, Object, Array, String, Number,
    navigator: { onLine: false }, location: { protocol: 'file:' }, crypto: globalThis.crypto,
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout() {}, setInterval() {}
  };
  window.window = window;
  vm.createContext(ctx);
  for (const f of ['config.js', 'core.js', 'sync.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(DOCS, f), 'utf8'), ctx, { filename: f });
  }
  return { ids, timers, ctx };
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
  assert.equal(ids['net'].textContent, '端末内のみ');
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
