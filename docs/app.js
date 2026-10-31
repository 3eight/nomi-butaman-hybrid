/* 能美豚饅 蒸しHUD 画面制御（キッチン＝タイマー係／会計＝会計係） */
(function () {
  'use strict';

  var cfg = window.NOMI_CONFIG || {};
  var products = (cfg.products && cfg.products.length) ? cfg.products : [
    { id: 'butaman', name: '豚まん', short: '豚', man: true },
    { id: 'anbata', name: 'あんバタまん', short: 'あんバタ', man: true },
    { id: 'potato', name: 'ポテト', short: 'ポテト', man: false }
  ];
  var productMap = {};
  products.forEach(function (p) { productMap[p.id] = p; });
  var MENU = (cfg.menu && cfg.menu.length) ? cfg.menu : [
    { key: 'butaman_steam', product: 'butaman', method: 'steam', enabled: true },
    { key: 'butaman_fry', product: 'butaman', method: 'fry', enabled: true },
    { key: 'anbata_steam', product: 'anbata', method: 'steam', enabled: true },
    { key: 'anbata_fry', product: 'anbata', method: 'fry', enabled: true },
    { key: 'potato', product: 'potato', method: '', enabled: false }
  ];
  var METHOD_LABEL = { steam: '蒸し', fry: '揚げ', '': '' };
  var CIRC = 2 * Math.PI * 44;

  var sync = NomiSync.createSync({ storage: window.localStorage, fetch: window.fetch.bind(window), config: cfg });
  var $ = function (id) { return document.getElementById(id); };

  function el(tag, text, cls) {
    var e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }
  function button(text, cls, onClick) {
    var b = el('button', text, cls);
    b.type = 'button';
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }
  function hhmm(v) {
    var d = new Date(v);
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }
  function pname(id) { return productMap[id] ? productMap[id].name : id; }
  function pshort(id) { return productMap[id] ? productMap[id].short : id; }
  function lineLabel(l) { return pname(l.product) + (METHOD_LABEL[l.method || ''] ? ' ' + METHOD_LABEL[l.method] : ''); }
  function circled(n) { return n >= 1 && n <= 20 ? String.fromCharCode(0x2460 + n - 1) : String(n); }

  /* ---------------- 端末設定 ---------------- */
  var KEY_SETTINGS = 'nomi.settings.v1';
  var settings = (function () {
    var s = {};
    try { s = JSON.parse(window.localStorage.getItem(KEY_SETTINGS) || '{}') || {}; } catch (e) { s = {}; }
    if (!s.menu) { s.menu = {}; MENU.forEach(function (m) { s.menu[m.key] = m.enabled !== false; }); }
    if (s.serviceOn === undefined) s.serviceOn = true;
    if (s.friedFromSteamed === undefined) s.friedFromSteamed = true;
    return s;
  })();
  function saveSettings() { try { window.localStorage.setItem(KEY_SETTINGS, JSON.stringify(settings)); } catch (e) { /* 無視 */ } }
  function enabledMenu() { return MENU.filter(function (m) { return settings.menu[m.key]; }); }

  function kitchenOpts() {
    return {
      steamMinutes: cfg.steamMinutes || 40, serviceEvery: cfg.serviceEvery || 5, serviceOn: settings.serviceOn,
      friedFromSteamed: settings.friedFromSteamed, lossYenPerPiece: cfg.lossYenPerPiece || 250, tiers: cfg.tiers || null
    };
  }
  function currentState() { return NomiCore.buildState(sync.getOps(), new Date(), kitchenOpts()); }

  /* ---------------- 通知（フラッシュ表示・振動・音） ---------------- */
  var flashEl = el('div', null, 'flash');
  flashEl.hidden = true;
  document.body.appendChild(flashEl);
  function flash(msg, opts) {
    opts = opts || {};
    flashEl.textContent = '';
    flashEl.className = 'flash' + (opts.error ? ' error' : opts.alert ? ' alert' : '');
    flashEl.appendChild(el('span', msg));
    if (opts.undo) {
      flashEl.appendChild(button('取消', 'flash-undo', function () { flashEl.hidden = true; opts.undo(); }));
    }
    flashEl.hidden = false;
    clearTimeout(flash.timer);
    flash.timer = setTimeout(function () { flashEl.hidden = true; }, opts.ms || (opts.undo ? 10000 : 3500));
  }
  var audioCtx = null;
  document.addEventListener('click', function () {
    if (!audioCtx && (window.AudioContext || window.webkitAudioContext)) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audioCtx = null; }
    }
  }, true);
  function beep() {
    if (!audioCtx) return;
    try {
      [0, 0.35].forEach(function (t) {
        var o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.frequency.value = 880; o.connect(g); g.connect(audioCtx.destination);
        g.gain.setValueAtTime(0.25, audioCtx.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + t + 0.3);
        o.start(audioCtx.currentTime + t); o.stop(audioCtx.currentTime + t + 0.3);
      });
    } catch (e) { /* 音が出せない端末では無視 */ }
  }
  var knownCheck = null;
  function detectAlerts(state) {
    var now = {};
    var fresh = [];
    state.tiers.forEach(function (t) {
      t.batches.forEach(function (b) {
        if (b.status !== 'check') return;
        now[b.batchId] = true;
        if (knownCheck && !knownCheck[b.batchId]) fresh.push(t.id);
      });
    });
    knownCheck = now;
    if (fresh.length) {
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      beep();
      flash(fresh.map(function (n) { return n + '段'; }).join('・') + ' 蒸し上がり時間です。確認してください', { alert: true, ms: 8000 });
    }
  }

  function addOp(type, payload) {
    var op = sync.addOp(type, payload);
    renderAll();
    syncSoon();
    return op;
  }

  /* ================= キッチン ================= */
  function renderKitchen(state) {
    var t = state.totals;
    setValue($('k-ready'), t.ready);
    var rs = $('k-ready-sub');
    rs.textContent = '';
    if (t.check) { rs.appendChild(document.createTextNode('確認待ち ')); rs.appendChild(el('b', String(t.check))); rs.appendChild(document.createTextNode(' ')); }
    rs.appendChild(document.createTextNode('予約 ' + state.reserved));

    setValue($('k-steaming'), t.steaming);
    var ns = $('k-next');
    ns.textContent = '';
    if (state.nextReady) {
      ns.appendChild(document.createTextNode(state.nextReady.tier + '段 あと'));
      ns.appendChild(el('b', String(state.nextReady.minutes)));
      ns.appendChild(document.createTextNode('分'));
    } else {
      ns.textContent = '蒸し中なし';
    }

    renderAdvice(state);
    renderTiers(state);

    var loss = state.loss;
    var lossText = [];
    if (loss.storePieces) lossText.push('廃棄（出店者負担）' + loss.storePieces + '個 ¥' + loss.storeYen.toLocaleString('ja-JP'));
    if (loss.hqPieces) lossText.push('廃棄（本部負担）' + loss.hqPieces + '個');
    $('k-loss').textContent = lossText.join(' ・ ');
  }

  function setValue(node, n) {
    node.textContent = String(n);
    node.appendChild(el('span', '個', 'unit'));
  }

  function renderAdvice(state) {
    var fc = sync.forecast(new Date());
    var adv = NomiCore.steamAdvice(state, fc, { tierCapacity: 5 });
    var v = $('steam-value');
    var sub = $('steam-sub');
    v.textContent = '';
    sub.textContent = '';
    if (adv.status === 'ready') {
      v.className = 'hud-value' + (adv.need === 0 ? ' zero' : '');
      v.appendChild(document.createTextNode(String(adv.need)));
      v.appendChild(el('span', '個', 'unit'));
      if (adv.need > 0) {
        sub.appendChild(el('b', '通常せいろ あと' + adv.tiers + '段'));
        sub.appendChild(document.createTextNode(' ・ ' + fc.targetHHMM + '頃の需要' + adv.demand + ' − 在庫と蒸し中' + adv.supply));
      } else {
        sub.appendChild(el('b', '今は追加不要'));
        sub.appendChild(document.createTextNode(' ・ ' + fc.targetHHMM + '頃の需要' + adv.demand + ' ≤ 在庫と蒸し中' + adv.supply));
      }
    } else {
      v.className = 'hud-value learning';
      v.textContent = '学習中';
      sub.appendChild(el('b', fc.weekday + '曜 ' + fc.slot));
      sub.appendChild(document.createTextNode(' の実績 ' + fc.samples + '/' + fc.minSamples + '回 ・ 在庫と蒸し中 ' + adv.supply + '個'));
    }
  }

  function svg(tag, attrs, text) {
    var e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text != null) e.textContent = text;
    return e;
  }

  function tierTile(t) {
    var b = button(null, 'tier ' + t.status, function () { openSheet(t.id); });
    b.setAttribute('data-tier', String(t.id));
    var s = svg('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true' });
    s.appendChild(svg('circle', { cx: 50, cy: 50, r: 44, 'class': 'ring-track' }));
    if (t.status !== 'empty') {
      var p = t.status === 'steaming' ? t.progress : 1;
      s.appendChild(svg('circle', { cx: 50, cy: 50, r: 44, 'class': 'ring', 'stroke-dasharray': (CIRC * p).toFixed(1) + ' ' + CIRC.toFixed(1) }));
    }
    s.appendChild(svg('circle', { cx: 50, cy: 50, r: 35, 'class': 'rim' }));
    s.appendChild(svg('line', { x1: 22, y1: 38, x2: 78, y2: 38, 'class': 'slat' }));
    s.appendChild(svg('line', { x1: 22, y1: 64, x2: 78, y2: 64, 'class': 'slat' }));
    s.appendChild(svg('text', { x: 50, y: 31, 'text-anchor': 'middle', 'class': 't-no' }, t.id + '段'));
    if (t.status === 'empty') {
      s.appendChild(svg('text', { x: 50, y: 62, 'text-anchor': 'middle', 'class': 't-empty' }, '空き'));
    } else if (t.status === 'check') {
      s.appendChild(svg('text', { x: 50, y: 63, 'text-anchor': 'middle', 'class': 't-main', style: 'font-size:22px' }, '確認'));
    } else {
      var main = t.status === 'steaming' ? t.remainingMinutes : t.qty;
      var unit = t.status === 'steaming' ? '分' : '個';
      s.appendChild(svg('text', { x: main >= 10 ? 44 : 45, y: 66, 'text-anchor': 'middle', 'class': 't-main' }, String(main)));
      s.appendChild(svg('text', { x: main >= 10 ? 63 : 56, y: 66, 'class': 't-unit' }, unit));
    }
    b.appendChild(s);
    var cap = el('div', null, 'tier-cap');
    if (t.status === 'empty') {
      cap.textContent = t.capacity + '個用';
    } else {
      var parts = {};
      t.batches.forEach(function (x) { parts[x.product] = (parts[x.product] || 0) + x.remaining; });
      Object.keys(parts).forEach(function (k, i) {
        if (i) cap.appendChild(document.createTextNode('+'));
        cap.appendChild(document.createTextNode(pshort(k)));
        cap.appendChild(el('b', String(parts[k])));
      });
    }
    b.appendChild(cap);
    var label = t.id + '段 ' + ({ empty: '空き', steaming: '蒸し中 残り' + t.remainingMinutes + '分', check: '蒸し上がり確認待ち', ready: '販売可能' })[t.status] + (t.qty ? ' ' + t.qty + '個' : '');
    b.setAttribute('aria-label', label);
    return b;
  }

  function renderTiers(state) {
    var box = $('tiers');
    box.textContent = '';
    var groups = [];
    var byGroup = {};
    state.tiers.forEach(function (t) {
      if (!byGroup[t.group]) { byGroup[t.group] = []; groups.push(t.group); }
      byGroup[t.group].push(t);
    });
    groups.forEach(function (g) {
      var wrap = el('div', null, 'tier-group');
      var first = byGroup[g][0];
      wrap.appendChild(el('div', (g === '電気' ? '電気せいろ' : '通常せいろ ' + g.replace('通常', '') + 'セット目') + '（' + first.capacity + '個/段' + (g === '電気' ? '・実容量未確認' : '') + '）', 'tier-group-label'));
      var row = el('div', null, 'tier-row');
      byGroup[g].forEach(function (t) { row.appendChild(tierTile(t)); });
      wrap.appendChild(row);
      box.appendChild(wrap);
    });
  }

  /* ---------- 段の操作シート ---------- */
  var sheet = { tier: null, product: 'butaman', qty: null, wasteFor: null, wasteQty: 1, wasteBurden: 'store' };

  function openSheet(tierId) {
    sheet = { tier: tierId, product: sheet.product || 'butaman', qty: null, wasteFor: null, wasteQty: 1, wasteBurden: 'store' };
    $('sheet').hidden = false;
    renderSheet(currentState());
  }
  function closeSheet() { $('sheet').hidden = true; sheet.tier = null; }

  function renderSheet(state) {
    if (sheet.tier == null || $('sheet').hidden) return;
    var t = state.tiers.filter(function (x) { return x.id === sheet.tier; })[0];
    if (!t) { closeSheet(); return; }
    $('sheet-title').textContent = t.id + '段（' + (t.group === '電気' ? '電気' : '通常' + t.group.replace('通常', '') + 'セット目') + '・' + t.capacity + '個）';
    var body = $('sheet-body');
    body.textContent = '';

    t.batches.forEach(function (b) {
      var box = el('div', null, 'batch ' + b.status);
      var main = el('div', null, 'batch-main');
      var left = el('span');
      left.appendChild(el('span', pname(b.product) + ' ', 'st'));
      left.appendChild(el('span', b.remaining + '個', 'q'));
      main.appendChild(left);
      main.appendChild(el('span', b.status === 'steaming' ? 'あと' + b.remainingMinutes + '分' : b.status === 'check' ? '蒸し上がり確認待ち' : '販売可能', 'st'));
      box.appendChild(main);
      box.appendChild(el('div', '開始 ' + hhmm(b.startedAt) + ' ・ 完成予定 ' + hhmm(b.endAt) + ' ・ 投入 ' + b.qty + '個', 'meta'));
      var acts = el('div', null, 'batch-actions');
      if (b.status !== 'ready') {
        acts.appendChild(button('蒸し上がり確認', 'secondary', function () {
          addOp('batch_ready', { batchId: b.batchId });
          flash(t.id + '段 販売可能にしました');
        }));
      }
      acts.appendChild(button('廃棄', 'secondary', function () {
        sheet.wasteFor = sheet.wasteFor === b.batchId ? null : b.batchId;
        sheet.wasteQty = 1;
        renderSheet(currentState());
      }));
      acts.appendChild(button('取消', 'secondary danger', function () {
        if (!window.confirm(t.id + '段の「' + pname(b.product) + ' ' + b.qty + '個」の投入を取り消しますか？（入れ間違いの訂正用）')) return;
        addOp('batch_cancel', { batchId: b.batchId });
        flash('投入を取り消しました');
      }));
      box.appendChild(acts);
      if (sheet.wasteFor === b.batchId) box.appendChild(wasteForm(b));
      body.appendChild(box);
    });

    // 蒸し開始（空き段 or 追加投入）
    body.appendChild(el('div', t.batches.length ? '追加投入（時刻の違う分は別に管理）' : '蒸し開始', 'field-label'));
    var seg = el('div', null, 'segmented');
    products.filter(function (p) { return p.man; }).forEach(function (p) {
      var b = button(p.name, null, function () { sheet.product = p.id; renderSheet(currentState()); });
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(sheet.product === p.id));
      seg.appendChild(b);
    });
    body.appendChild(seg);
    if (sheet.qty == null) sheet.qty = t.free > 0 ? t.free : t.capacity;
    body.appendChild(stepper(function () { return sheet.qty; }, function (n) { sheet.qty = Math.max(1, Math.min(99, n)); renderSheet(currentState()); }));
    if (sheet.qty > t.free) body.appendChild(el('p', '満載を超えています（空き' + t.free + '個）', 'warn-note'));
    body.appendChild(button('蒸し開始（' + (cfg.steamMinutes || 40) + '分）', 'primary', function () {
      var batchId = NomiSync.makeId();
      var qty = sheet.qty;
      addOp('batch_start', { batchId: batchId, tier: t.id, product: sheet.product, qty: qty, startedAt: new Date().toISOString() });
      closeSheet();
      flash(t.id + '段 ' + pname(sheet.product) + ' ' + qty + '個 蒸し開始', {
        undo: function () { addOp('batch_cancel', { batchId: batchId }); flash('取り消しました'); }
      });
    }));
  }

  function stepper(get, set) {
    var wrap = el('div', null, 'stepper');
    wrap.appendChild(button('−', 'step', function () { set(get() - 1); }));
    wrap.appendChild(el('output', String(get()), 'qty'));
    wrap.appendChild(button('＋', 'step', function () { set(get() + 1); }));
    return wrap;
  }

  function wasteForm(b) {
    var f = el('div', null, 'batch');
    f.appendChild(el('div', '廃棄する個数と負担', 'field-label'));
    f.appendChild(stepper(function () { return sheet.wasteQty; }, function (n) { sheet.wasteQty = Math.max(1, Math.min(b.remaining, n)); renderSheet(currentState()); }));
    var seg = el('div', null, 'segmented');
    [['store', '出店者負担（蒸しすぎ等）¥' + (cfg.lossYenPerPiece || 250) + '/個'], ['hq', '本部負担（商品不良）']].forEach(function (o) {
      var x = button(o[1], null, function () { sheet.wasteBurden = o[0]; renderSheet(currentState()); });
      x.setAttribute('role', 'radio');
      x.setAttribute('aria-checked', String(sheet.wasteBurden === o[0]));
      seg.appendChild(x);
    });
    f.appendChild(seg);
    f.appendChild(button('廃棄を記録', 'secondary danger', function () {
      addOp('waste', { batchId: b.batchId, product: b.product, qty: sheet.wasteQty, burden: sheet.wasteBurden, reason: sheet.wasteBurden === 'hq' ? '商品不良' : '出店者過失' });
      sheet.wasteFor = null;
      flash('廃棄 ' + sheet.wasteQty + '個を記録しました');
    }));
    return f;
  }

  /* ================= 会計 ================= */
  var draft = { qty: {}, service: 'butaman_steam' };

  function draftLines() {
    return enabledMenu().filter(function (m) { return draft.qty[m.key] > 0; })
      .map(function (m) { return { product: m.product, method: m.method, qty: draft.qty[m.key] }; });
  }

  function renderRegister(state) {
    $('order-no').textContent = '#' + state.nextOrderNumber;
    var menu = $('menu');
    menu.textContent = '';
    enabledMenu().forEach(function (m) {
      var q = draft.qty[m.key] || 0;
      var b = button(null, 'menu-item' + (q ? ' has' : ''), function () { draft.qty[m.key] = q + 1; renderAll(); });
      var label = el('div', null, 'menu-label');
      label.appendChild(el('span', pname(m.product), 'menu-name'));
      if (m.method) label.appendChild(el('span', METHOD_LABEL[m.method], 'menu-method ' + m.method));
      b.appendChild(label);
      b.appendChild(el('span', String(q), 'menu-qty'));
      b.setAttribute('aria-label', lineLabel(m) + ' ' + q + '個。タップで1個追加');
      if (q) {
        var minus = el('span', '−', 'menu-minus');
        minus.setAttribute('role', 'button');
        minus.setAttribute('aria-label', lineLabel(m) + 'を1個減らす');
        minus.addEventListener('click', function (ev) { ev.stopPropagation(); draft.qty[m.key] = Math.max(0, q - 1); renderAll(); });
        b.appendChild(minus);
      }
      menu.appendChild(b);
    });

    var lines = draftLines();
    var entitled = NomiCore.serviceEntitled(lines, kitchenOpts());
    var row = $('service-row');
    row.hidden = entitled === 0;
    $('service-count').textContent = String(entitled);
    var so = $('service-options');
    so.textContent = '';
    MENU.filter(function (m) { return productMap[m.product] && productMap[m.product].man; }).concat([{ key: 'decline' }]).forEach(function (m) {
      var b = button(m.key === 'decline' ? '辞退' : lineLabel(m), null, function () { draft.service = m.key; renderAll(); });
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(draft.service === m.key));
      so.appendChild(b);
    });

    var total = 0;
    lines.forEach(function (l) { total += l.qty; });
    var svc = draft.service === 'decline' ? 0 : entitled;
    var sum = $('order-summary');
    sum.textContent = '';
    if (!lines.length) {
      sum.textContent = '商品をタップしてください';
    } else {
      sum.appendChild(document.createTextNode('お渡し合計 '));
      sum.appendChild(el('b', String(total + svc)));
      sum.appendChild(document.createTextNode('個' + (svc ? '（うちサービス' + svc + '）' : '')));
      var yen = priceTotal(lines);
      sum.appendChild(document.createTextNode(yen == null ? ' ・ 金額 未設定' : ' ・ ¥' + yen.toLocaleString('ja-JP')));
    }
    $('order-paid').disabled = !lines.length;
    $('order-later').disabled = !lines.length;

    renderWaiting(state);
    renderDay(state);
  }

  function priceTotal(lines) {
    var prices = cfg.prices || {};
    var sum = 0;
    for (var i = 0; i < lines.length; i++) {
      var key = lines[i].product + (lines[i].method ? '_' + lines[i].method : '');
      if (typeof prices[key] !== 'number') return null;
      sum += prices[key] * lines[i].qty;
    }
    return sum;
  }

  function createOrder(paid) {
    var state = currentState();
    var lines = draftLines();
    if (!lines.length) return;
    var entitled = NomiCore.serviceEntitled(lines, kitchenOpts());
    var service = [];
    var declined = draft.service === 'decline';
    if (entitled && !declined) {
      var m = MENU.filter(function (x) { return x.key === draft.service; })[0] || MENU[0];
      service.push({ product: m.product, method: m.method, qty: entitled });
    }
    addOp('order_create', {
      orderId: NomiSync.makeId(), number: state.nextOrderNumber, lines: lines, service: service,
      serviceDeclined: declined && entitled > 0, paid: !!paid
    });
    draft = { qty: {}, service: draft.service === 'decline' ? 'butaman_steam' : draft.service };
    renderAll();
    flash('#' + state.nextOrderNumber + ' を受付しました' + (paid ? '（支払済）' : '（後払い）'));
  }

  function linesText(lines) {
    return NomiCore.summarizeLines(lines).map(function (l) { return lineLabel(l) + '×' + l.qty; }).join('、');
  }

  function pickText(plan) {
    var byTier = {};
    var order = [];
    plan.allocations.forEach(function (a) {
      if (!byTier[a.tier]) { byTier[a.tier] = 0; order.push(a.tier); }
      byTier[a.tier] += a.qty;
    });
    return order.map(function (tn) { return circled(tn) + '段 ' + byTier[tn] + '個'; }).join(' ・ ');
  }

  function renderWaiting(state) {
    var ul = $('waiting');
    ul.textContent = '';
    $('waiting-count').textContent = String(state.waiting.length);
    if (!state.waiting.length) { ul.appendChild(el('li', 'お渡し待ちはありません', 'empty-note')); return; }
    state.waiting.forEach(function (o) {
      var li = el('li', null, 'order' + (o.paid ? '' : ' unpaid'));
      var top = el('div', null, 'order-top');
      var num = el('span', null, 'order-num');
      num.appendChild(el('small', '注文'));
      num.appendChild(document.createTextNode('#' + o.label));
      top.appendChild(num);
      top.appendChild(el('span', o.paid ? '支払済' : '未払い', 'pay ' + (o.paid ? 'paid' : 'unpaid')));
      li.appendChild(top);
      var lines = el('div', linesText(o.lines), 'order-lines');
      if (o.service.length) lines.appendChild(el('span', ' ＋サービス ' + linesText(o.service), 'svc'));
      if (o.serviceDeclined) lines.appendChild(el('span', '（サービス辞退）', 'svc'));
      li.appendChild(lines);
      var pick = pickText(o.plan);
      var needs = NomiCore.orderNeeds(o, kitchenOpts());
      if (!Object.keys(needs).length) {
        li.appendChild(el('div', '蒸し在庫の取り出しなし', 'pick'));
      } else {
        if (pick) li.appendChild(el('div', '取り出し: ' + pick, 'pick'));
        if (o.plan.shortage) li.appendChild(el('div', '不足 ' + o.plan.shortage + '個（蒸し上がり待ち）', 'pick short'));
      }
      var acts = el('div', null, 'order-actions');
      acts.appendChild(button(o.paid ? 'お渡し完了' : '支払い＋お渡し', 'primary', function () { fulfill(o.orderId); }));
      acts.appendChild(button('取消', 'secondary danger', function () {
        if (!window.confirm('注文 #' + o.label + ' を取り消しますか？')) return;
        addOp('order_cancel', { orderId: o.orderId });
        flash('#' + o.label + ' を取り消しました');
      }));
      li.appendChild(acts);
      ul.appendChild(li);
    });
  }

  function fulfill(orderId) {
    var state = currentState();
    var o = state.orders.filter(function (x) { return x.orderId === orderId; })[0];
    if (!o || o.fulfilled || o.cancelled) return;
    var plan = NomiCore.planFulfill(state, o, kitchenOpts());
    if (!o.paid && !window.confirm('#' + o.label + ' は未払いです。代金を受け取ってお渡し完了にしますか？')) return;
    if (plan.shortage && !window.confirm('蒸し在庫が' + plan.shortage + '個足りません。お渡し完了にしますか？\n（不足分は段の残数に反映されません）')) return;
    addOp('order_fulfill', {
      orderId: o.orderId, paid: true, shortage: plan.shortage,
      allocations: plan.allocations.map(function (a) { return { batchId: a.batchId, qty: a.qty }; })
    });
    // 曜日×時間帯の販売ナレッジ（次に蒸す数の学習）にも記録
    NomiCore.summarizeLines(o.lines.concat(o.service)).forEach(function (l) {
      try {
        sync.addDelivery({ productId: l.product + (l.method ? '_' + l.method : ''), productName: lineLabel(l), quantity: l.qty, method: METHOD_LABEL[l.method || ''] || '—' });
      } catch (e) { /* 学習用の記録失敗はお渡しを妨げない */ }
    });
    var pick = pickText(plan);
    flash('#' + o.label + ' お渡し完了' + (pick ? '（' + pick + '）' : ''));
    renderAll();
    syncSoon();
  }

  function renderDay(state) {
    var box = $('day-stats');
    box.textContent = '';
    [['注文', state.sold.orders], ['販売（有料）', state.sold.pieces], ['サービス', state.sold.service]].forEach(function (s) {
      var d = el('div');
      d.appendChild(el('b', String(s[1])));
      d.appendChild(el('span', s[0]));
      box.appendChild(d);
    });
    var ul = $('recent');
    ul.textContent = '';
    state.orders.filter(function (o) { return o.fulfilled; }).slice(-5).reverse().forEach(function (o) {
      var li = el('li');
      li.appendChild(el('span', '#' + o.label + ' ' + hhmm(o.fulfilledAt) + ' ' + linesText(o.lines.concat(o.service))));
      li.appendChild(el('span', o.shortage ? '不足' + o.shortage : '済', 'badge' + (o.shortage ? '' : ' done')));
      ul.appendChild(li);
    });
  }

  function renderSettings() {
    var box = $('settings');
    box.textContent = '';
    box.appendChild(el('p', 'メニュー（この出店で扱う商品）', 'field-label'));
    MENU.forEach(function (m) {
      box.appendChild(checkbox(lineLabel(m), settings.menu[m.key], function (v) { settings.menu[m.key] = v; }));
    });
    box.appendChild(checkbox('サービス（有料まん類' + (cfg.serviceEvery || 5) + '個ごとに1個）', settings.serviceOn, function (v) { settings.serviceOn = v; }));
    box.appendChild(checkbox('揚げ品も蒸し上がり在庫から使う', settings.friedFromSteamed, function (v) { settings.friedFromSteamed = v; }));
    box.appendChild(el('p', '※揚げの工程は未確認のため仮設定です。各端末で同じ設定にしてください。', 'note'));
  }
  function checkbox(label, checked, onChange) {
    var l = el('label');
    var c = el('input');
    c.type = 'checkbox';
    c.checked = !!checked;
    c.addEventListener('change', function () { onChange(c.checked); saveSettings(); renderAll(); });
    l.appendChild(c);
    l.appendChild(document.createTextNode(label));
    return l;
  }

  /* ================= 共通 ================= */
  var link = 'checking';

  function statusLabel(online, queued) {
    if (!cfg.gasUrl) return { text: '端末内のみ', cls: 'local' };
    if (!online) return { text: '圏外' + (queued ? ' ・ 未送信' + queued : ''), cls: 'offline' };
    if (link === 'ok') return { text: '共有接続済み' + (queued ? ' ・ 未送信' + queued : ''), cls: 'online' };
    if (link === 'error') return { text: '再接続中' + (queued ? ' ・ 未送信' + queued : ''), cls: 'offline' };
    return { text: '接続確認中…', cls: 'local' };
  }

  function renderStatus() {
    var net = $('net');
    var s = statusLabel(navigator.onLine !== false, sync.getQueue().length + sync.getOpQueue().length);
    net.className = 'net ' + s.cls;
    net.textContent = s.text;
    var m = sync.getMeta();
    var foot = m.lastSyncAt ? '最終同期 ' + hhmm(m.lastSyncAt) : '未同期';
    if (m.lastError) foot += ' ・ ' + m.lastError;
    $('foot').textContent = foot;
    $('clock').textContent = hhmm(new Date());
  }

  function renderAll() {
    var state = currentState();
    renderKitchen(state);
    renderRegister(state);
    renderSheet(state);
    renderStatus();
    detectAlerts(state);
  }

  // ---- 同期 ----
  var lastDeliveryPull = 0;
  var syncing = null;
  function syncNow() {
    renderStatus();
    if (!cfg.gasUrl) return Promise.resolve().then(renderAll);
    if (syncing) return syncing;
    syncing = sync.flushOps()
      .then(function () { return sync.flush(); })
      .then(function () { return sync.pullOps(); })
      .then(function () {
        if (Date.now() - lastDeliveryPull > 120000) { lastDeliveryPull = Date.now(); return sync.pull(); }
      })
      .then(function () { link = 'ok'; }, function () { link = 'error'; })
      .then(function () { syncing = null; renderAll(); });
    return syncing;
  }
  var soonTimer = null;
  function syncSoon() {
    clearTimeout(soonTimer);
    soonTimer = setTimeout(syncNow, 300);
  }

  // ---- 画面切替 ----
  var VIEWS = ['kitchen', 'register'];
  var KEY_VIEW = 'nomi.view.v1';
  function viewFromHash() {
    var h = String(location.hash || '').replace('#', '');
    return VIEWS.indexOf(h) >= 0 ? h : null;
  }
  function showView(name, save) {
    if (VIEWS.indexOf(name) < 0) name = 'kitchen';
    VIEWS.forEach(function (v) {
      var active = v === name;
      $('view-' + v).hidden = !active;
      $('tab-' + v).setAttribute('aria-selected', String(active));
      $('tab-' + v).setAttribute('tabindex', active ? '0' : '-1');
    });
    if (save) {
      try { window.localStorage.setItem(KEY_VIEW, name); } catch (e) { /* 保存不可でも切替は有効 */ }
      if (window.history && history.replaceState) history.replaceState(null, '', '#' + name);
    }
    if (window.scrollTo) window.scrollTo(0, 0);
  }

  // ---- 初期化 ----
  VIEWS.forEach(function (v) { $('tab-' + v).addEventListener('click', function () { showView(v, true); }); });
  window.addEventListener('hashchange', function () { var v = viewFromHash(); if (v) showView(v, true); });
  showView(viewFromHash() || window.localStorage.getItem(KEY_VIEW) || 'kitchen', false);

  $('order-paid').addEventListener('click', function () { createOrder(true); });
  $('order-later').addEventListener('click', function () { createOrder(false); });
  $('order-clear').addEventListener('click', function () { draft = { qty: {}, service: 'butaman_steam' }; renderAll(); });
  $('sync-now').addEventListener('click', syncNow);
  $('sheet-close').addEventListener('click', closeSheet);
  $('sheet').addEventListener('click', function (ev) { if (ev.target === $('sheet')) closeSheet(); });
  window.addEventListener('online', syncNow);
  window.addEventListener('offline', renderStatus);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) syncNow(); });

  renderSettings();
  renderAll();
  syncNow();
  setInterval(function () { renderAll(); }, 5000);                                   // 残り時間の更新
  setInterval(function () { if (!document.hidden) syncNow(); }, cfg.pollMs || 15000); // 他のスマホの操作を取り込む

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(function () { /* LINE内ブラウザ等で非対応でも動作は継続 */ });
  }
})();
