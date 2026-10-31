/* 能美豚饅 蒸しHUD 画面制御 */
(function () {
  'use strict';

  var cfg = window.NOMI_CONFIG || {};
  var products = (cfg.products && cfg.products.length) ? cfg.products : [{ id: 'butaman', name: '豚饅' }];
  var methods = (cfg.methods && cfg.methods.length) ? cfg.methods : ['店頭'];
  var quick = cfg.quickQuantities || [1, 2, 5, 10];

  var sync = NomiSync.createSync({
    storage: window.localStorage,
    fetch: window.fetch.bind(window),
    config: cfg
  });

  var state = { productIndex: 0, methodIndex: 0, qty: 1, busy: false };
  var $ = function (id) { return document.getElementById(id); };

  function el(tag, text, cls) {
    var e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }

  function renderSegmented(container, labels, selected, onPick) {
    container.textContent = '';
    labels.forEach(function (label, i) {
      var b = el('button', label);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(i === selected));
      b.addEventListener('click', function () { onPick(i); });
      container.appendChild(b);
    });
  }

  function renderControls() {
    $('product-field').hidden = products.length < 2;
    renderSegmented($('product-options'), products.map(function (p) { return p.name; }), state.productIndex, function (i) {
      state.productIndex = i; renderControls();
    });
    renderSegmented($('method-options'), methods, state.methodIndex, function (i) {
      state.methodIndex = i; renderControls();
    });
    $('qty').textContent = String(state.qty);
  }

  function setQty(n) {
    state.qty = Math.max(1, Math.min(999, n));
    $('qty').textContent = String(state.qty);
  }

  function renderForecast() {
    var f = sync.forecast(new Date());
    var v = $('steam-value');
    var sub = $('steam-sub');
    var list = $('steam-breakdown');
    list.textContent = '';
    v.textContent = '';
    sub.textContent = '';

    if (f.status === 'ready') {
      v.className = 'hud-value';
      v.appendChild(document.createTextNode(String(f.total)));
      v.appendChild(el('span', '個', 'unit'));
      sub.appendChild(document.createTextNode(f.leadMinutes + '分後（' + f.targetHHMM + '頃）の目安 ・ '));
      sub.appendChild(el('strong', f.weekday + '曜 ' + f.slot));
      sub.appendChild(document.createTextNode(' ・ 実績' + f.samples + '回'));
      if (f.byProduct.length > 1) {
        f.byProduct.forEach(function (p) { list.appendChild(el('li', p.productName + ' ' + p.suggest + '個')); });
      }
    } else {
      v.className = 'hud-value learning';
      v.textContent = '学習中';
      sub.appendChild(el('strong', f.weekday + '曜 ' + f.slot));
      sub.appendChild(document.createTextNode(' の実績 ' + f.samples + '/' + f.minSamples + '回（あと' + f.needed + '回で目安を表示）'));
      var meter = el('div', null, 'meter');
      var bar = el('span');
      bar.style.width = Math.round((f.samples / f.minSamples) * 100) + '%';
      meter.appendChild(bar);
      list.appendChild(meter);
    }
  }

  function renderRecent() {
    var ul = $('recent');
    ul.textContent = '';
    var recs = sync.getRecords().slice(-5).reverse();
    if (!recs.length) { ul.appendChild(el('li', 'まだ記録がありません', 'empty')); return; }
    recs.forEach(function (r) {
      var li = el('li');
      li.appendChild(el('span', r.weekday + ' ' + r.time + '  ' + r.productName + ' ×' + r.quantity + '（' + r.method + '）'));
      var badge = r.syncError ? el('span', '送信エラー', 'badge')
        : r.pending ? el('span', '未送信', 'badge') : el('span', '保存済', 'badge done');
      if (r.syncError) badge.title = r.syncError;
      li.appendChild(badge);
      ul.appendChild(li);
    });
  }

  function renderStatus() {
    var net = $('net');
    var q = sync.getQueue().length;
    var online = navigator.onLine !== false;
    net.className = 'net ' + (online ? 'online' : 'offline');
    if (!cfg.gasUrl) net.textContent = '端末内のみ';
    else net.textContent = (online ? 'オンライン' : '圏外') + (q ? ' ・ 未送信' + q : '');
    var m = sync.getMeta();
    var foot = m.lastSyncAt ? '最終同期 ' + new Date(m.lastSyncAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '未同期';
    if (m.lastError) foot += ' ・ ' + m.lastError;
    $('foot').textContent = foot;
  }

  function renderAll() { renderForecast(); renderRecent(); renderStatus(); }

  function toast(msg, isError) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast' + (isError ? ' error' : '');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { t.textContent = ''; }, 3500);
  }

  function submit() {
    if (state.busy) return;
    state.busy = true;
    $('submit').disabled = true;
    try {
      var p = products[state.productIndex];
      var rec = sync.addDelivery({ productId: p.id, productName: p.name, quantity: state.qty, method: methods[state.methodIndex] });
      if (navigator.vibrate) navigator.vibrate(30);
      toast('記録しました：' + rec.productName + ' ×' + rec.quantity);
      setQty(1);
      renderAll();
      sync.flush().then(renderAll);
    } catch (e) {
      toast(e.message, true);
    } finally {
      // 連打による二重登録を防ぐため少し待ってから再有効化
      setTimeout(function () { state.busy = false; $('submit').disabled = false; }, 600);
    }
  }

  function syncNow() {
    renderStatus();
    return sync.flush().then(function () { return sync.pull(); }).catch(function () { /* 圏外時は次回 */ }).then(renderAll);
  }

  // ---- 初期化 ----
  quick.forEach(function (n) {
    var b = el('button', String(n));
    b.type = 'button';
    b.addEventListener('click', function () { setQty(n); });
    $('quick-qty').appendChild(b);
  });
  $('qty-minus').addEventListener('click', function () { setQty(state.qty - 1); });
  $('qty-plus').addEventListener('click', function () { setQty(state.qty + 1); });
  $('submit').addEventListener('click', submit);
  $('sync-now').addEventListener('click', syncNow);
  window.addEventListener('online', syncNow);
  window.addEventListener('offline', renderStatus);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) syncNow(); });

  renderControls();
  renderAll();
  syncNow();
  setInterval(renderForecast, 30000);   // 時間経過で目安の対象時間帯が変わる
  setInterval(syncNow, 120000);         // 他端末の記録を定期取り込み

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(function () { /* LINE内ブラウザ等で非対応でも動作は継続 */ });
  }
})();
