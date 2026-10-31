// 自動生成: docs/core.js のコピーです。直接編集せず `npm run sync:gas` を実行してください。
/*
 * 能美豚饅 ハイブリッド版 共通ロジック（ブラウザ / Google Apps Script / Node テスト共用）
 *
 * このファイルは docs/core.js が正本です。
 * gas/Core.gs は `npm run sync:gas` で生成されるコピーです（直接編集しないこと）。
 *
 * 時刻はすべて日本時間（UTC+9、サマータイムなし）で解釈します。
 */
var NomiCore = (function () {
  'use strict';

  var JST_OFFSET_MS = 9 * 60 * 60 * 1000;
  var WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

  var DEFAULTS = {
    slotMinutes: 30,     // 時間帯の幅（分）
    leadMinutes: 40,     // 何分後の需要を蒸し目安にするか
    minSamples: 3,       // 同じ曜日・時間帯で必要な実績回数（異なる日付の数）
    lookbackDays: 56     // 何日前までの実績を使うか（季節変動への追従）
  };

  function merge(base, extra) {
    var out = {};
    var k;
    for (k in base) if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k];
    if (extra) for (k in extra) if (Object.prototype.hasOwnProperty.call(extra, k) && extra[k] !== undefined) out[k] = extra[k];
    return out;
  }

  function toDate(value) {
    var d = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (isNaN(d.getTime())) throw new Error('不正な日時です: ' + value);
    return d;
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  /** 日本時間での日付・曜日・分を返す */
  function jstParts(value) {
    var d = toDate(value);
    var j = new Date(d.getTime() + JST_OFFSET_MS);
    var y = j.getUTCFullYear();
    var m = j.getUTCMonth() + 1;
    var day = j.getUTCDate();
    return {
      dateKey: y + '-' + pad2(m) + '-' + pad2(day),
      weekday: j.getUTCDay(),
      minutesOfDay: j.getUTCHours() * 60 + j.getUTCMinutes(),
      hhmm: pad2(j.getUTCHours()) + ':' + pad2(j.getUTCMinutes())
    };
  }

  function minutesToHHMM(min) {
    var m = ((min % 1440) + 1440) % 1440;
    if (min === 1440) return '24:00';
    return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
  }

  /** 日時 → 曜日・時間帯 */
  function slotOf(value, slotMinutes) {
    var size = slotMinutes || DEFAULTS.slotMinutes;
    var p = jstParts(value);
    var index = Math.floor(p.minutesOfDay / size);
    var start = index * size;
    return {
      dateKey: p.dateKey,
      weekday: p.weekday,
      weekdayLabel: WEEKDAYS[p.weekday],
      slotIndex: index,
      slotLabel: minutesToHHMM(start) + '-' + minutesToHHMM(Math.min(start + size, 1440)),
      time: p.hhmm
    };
  }

  function sanitizeText(value, maxLen) {
    var s = value == null ? '' : String(value);
    s = s.replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (s.length > maxLen) s = s.slice(0, maxLen);
    return s;
  }

  /**
   * 受渡記録を検証・正規化する。曜日・時間帯は受渡日時から必ず再計算する。
   * @returns {{ok:true, record:Object}|{ok:false, error:string}}
   */
  function normalizeDelivery(input, options) {
    var opt = merge(DEFAULTS, options);
    var now = opt.now ? toDate(opt.now) : new Date();
    if (!input || typeof input !== 'object') return { ok: false, error: '記録がありません' };

    var id = sanitizeText(input.id, 64);
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) return { ok: false, error: '記録IDが不正です' };

    var productId = sanitizeText(input.productId, 32);
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(productId)) return { ok: false, error: '商品IDが不正です' };
    var productName = sanitizeText(input.productName, 40) || productId;

    var qty = Number(input.quantity);
    if (!isFinite(qty) || Math.floor(qty) !== qty || qty < 1 || qty > 999) {
      return { ok: false, error: '数量は1〜999の整数にしてください' };
    }

    var method = sanitizeText(input.method, 20);
    if (!method) return { ok: false, error: '受渡方法がありません' };

    var occurred;
    try {
      occurred = toDate(input.occurredAt);
    } catch (e) {
      return { ok: false, error: '受渡日時が不正です' };
    }
    if (occurred.getTime() > now.getTime() + 10 * 60 * 1000) {
      return { ok: false, error: '受渡日時が未来です' };
    }
    if (occurred.getTime() < now.getTime() - 60 * 24 * 60 * 60 * 1000) {
      return { ok: false, error: '受渡日時が古すぎます（60日以上前）' };
    }

    var slot = slotOf(occurred, opt.slotMinutes);
    return {
      ok: true,
      record: {
        id: id,
        occurredAt: occurred.toISOString(),
        dateKey: slot.dateKey,
        weekday: slot.weekdayLabel,
        time: slot.time,
        slot: slot.slotLabel,
        productId: productId,
        productName: productName,
        quantity: qty,
        method: method,
        deviceId: sanitizeText(input.deviceId, 64)
      }
    };
  }

  /**
   * 40分後の蒸し目安を計算する。
   * - 目標時刻 = now + leadMinutes。その曜日・時間帯と一致する過去実績を集める。
   * - 当日分は途中経過のため除外。lookbackDays より古い実績も除外。
   * - 異なる日付が minSamples 回以上あれば、商品ごとに「1回あたり平均数量」を切り上げて提示。
   * - 不足時は status: 'learning'。
   */
  function forecast(records, now, options) {
    var opt = merge(DEFAULTS, options);
    var nowDate = now ? toDate(now) : new Date();
    var target = new Date(nowDate.getTime() + opt.leadMinutes * 60 * 1000);
    var tSlot = slotOf(target, opt.slotMinutes);
    var minTime = nowDate.getTime() - opt.lookbackDays * 24 * 60 * 60 * 1000;

    var dates = {};
    var dateCount = 0;
    var totals = {};
    var names = {};
    var list = records || [];

    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || !r.occurredAt) continue;
      var t;
      try { t = toDate(r.occurredAt); } catch (e) { continue; }
      if (t.getTime() < minTime || t.getTime() > nowDate.getTime()) continue;
      var s = slotOf(t, opt.slotMinutes);
      if (s.weekday !== tSlot.weekday || s.slotIndex !== tSlot.slotIndex) continue;
      if (s.dateKey === tSlot.dateKey) continue;
      var q = Number(r.quantity);
      if (!isFinite(q) || q <= 0) continue;
      if (opt.excludeProducts && opt.excludeProducts.indexOf(r.productId) >= 0) continue;
      if (!dates[s.dateKey]) { dates[s.dateKey] = true; dateCount++; }
      var pid = r.productId || 'unknown';
      totals[pid] = (totals[pid] || 0) + q;
      if (r.productName) names[pid] = r.productName;
    }

    var base = {
      targetTime: target.toISOString(),
      targetHHMM: tSlot.time,
      weekday: tSlot.weekdayLabel,
      slot: tSlot.slotLabel,
      samples: dateCount,
      minSamples: opt.minSamples,
      leadMinutes: opt.leadMinutes
    };

    if (dateCount < opt.minSamples) {
      base.status = 'learning';
      base.needed = opt.minSamples - dateCount;
      base.total = null;
      base.byProduct = [];
      return base;
    }

    var byProduct = [];
    var total = 0;
    for (var pidKey in totals) {
      if (!Object.prototype.hasOwnProperty.call(totals, pidKey)) continue;
      var avg = totals[pidKey] / dateCount;
      var suggest = Math.ceil(avg);
      total += suggest;
      byProduct.push({
        productId: pidKey,
        productName: names[pidKey] || pidKey,
        average: Math.round(avg * 10) / 10,
        suggest: suggest
      });
    }
    byProduct.sort(function (a, b) { return b.suggest - a.suggest || (a.productId < b.productId ? -1 : 1); });

    base.status = 'ready';
    base.needed = 0;
    base.total = total;
    base.byProduct = byProduct;
    return base;
  }

  /** 曜日×時間帯×商品の販売ナレッジ集計（GASのナレッジシート用） */
  function summarize(records, options) {
    var opt = merge(DEFAULTS, options);
    var groups = {};
    var list = records || [];
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || !r.occurredAt) continue;
      var s;
      try { s = slotOf(r.occurredAt, opt.slotMinutes); } catch (e) { continue; }
      var key = s.weekday + '|' + s.slotIndex + '|' + r.productId;
      var g = groups[key];
      if (!g) {
        g = groups[key] = {
          weekdayIndex: s.weekday, weekday: s.weekdayLabel, slotIndex: s.slotIndex, slot: s.slotLabel,
          productId: r.productId, productName: r.productName || r.productId,
          totalQuantity: 0, dates: {}, samples: 0
        };
      }
      g.totalQuantity += Number(r.quantity) || 0;
      if (!g.dates[s.dateKey]) { g.dates[s.dateKey] = true; g.samples++; }
    }
    var out = [];
    for (var k in groups) {
      if (!Object.prototype.hasOwnProperty.call(groups, k)) continue;
      var gg = groups[k];
      out.push({
        weekdayIndex: gg.weekdayIndex, weekday: gg.weekday, slotIndex: gg.slotIndex, slot: gg.slot,
        productId: gg.productId, productName: gg.productName,
        samples: gg.samples, totalQuantity: gg.totalQuantity,
        average: Math.round((gg.totalQuantity / gg.samples) * 10) / 10,
        status: gg.samples >= opt.minSamples ? '目安あり' : '学習中'
      });
    }
    out.sort(function (a, b) {
      return a.weekdayIndex - b.weekdayIndex || a.slotIndex - b.slotIndex || (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0);
    });
    return out;
  }

  /** 記録IDで重複排除して結合（後勝ちではなく先勝ち = 既存を保持） */
  function mergeRecords(existing, incoming) {
    var seen = {};
    var out = [];
    var all = (existing || []).concat(incoming || []);
    for (var i = 0; i < all.length; i++) {
      var r = all[i];
      if (!r || !r.id || seen[r.id]) continue;
      seen[r.id] = true;
      out.push(r);
    }
    out.sort(function (a, b) { return a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : 0; });
    return out;
  }

  /** キッチン画面用: 直近N分と当日（日本時間）の受渡数量合計 */
  function deliveryStats(records, now, recentMinutes) {
    var nowDate = now ? toDate(now) : new Date();
    var since = nowDate.getTime() - (recentMinutes || 30) * 60 * 1000;
    var today = jstParts(nowDate).dateKey;
    var recent = 0;
    var todayTotal = 0;
    var list = records || [];
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || !r.occurredAt) continue;
      var t;
      try { t = toDate(r.occurredAt); } catch (e) { continue; }
      var q = Number(r.quantity);
      if (!isFinite(q) || q <= 0 || t.getTime() > nowDate.getTime()) continue;
      if (t.getTime() >= since) recent += q;
      if (jstParts(t).dateKey === today) todayTotal += q;
    }
    return { recent: recent, today: todayTotal, recentMinutes: recentMinutes || 30 };
  }

  /* ================================================================
   * 蒸し・販売の共有操作（オペレーションログ方式）
   * 各スマホは「操作」を追記するだけ。全員が同じ操作列から同じ状態を計算する。
   * 操作IDで重複排除するので、再送・同時操作でも二重計上しない。
   * ================================================================ */
  var OP_TYPES = ['batch_start', 'batch_ready', 'batch_cancel', 'waste',
    'order_create', 'order_paid', 'order_fulfill', 'order_cancel'];

  var KITCHEN_DEFAULTS = {
    steamMinutes: 40,          // 冷凍から蒸し上がりまで（本人運用値）
    serviceEvery: 5,           // 有料まん類5個ごとにサービス1個
    serviceOn: true,
    friedFromSteamed: true,    // 揚げ品も蒸し上がり在庫から使う（未確認・設定で変更可）
    lossYenPerPiece: 250,      // 出店者負担ロス単価（確定）
    manProducts: null,         // まん類の商品ID（null なら豚まん・あんバタまん）
    tiers: null                // 未指定なら defaultTiers()
  };

  /** 段の初期構成: 通常1セット目1〜4、2セット目5〜8（5個/段）、電気9〜12（6個/段・実容量未確認） */
  function defaultTiers() {
    var out = [];
    for (var i = 1; i <= 12; i++) {
      var group = i <= 4 ? '通常1' : i <= 8 ? '通常2' : '電気';
      out.push({ id: i, group: group, capacity: i <= 8 ? 5 : 6 });
    }
    return out;
  }

  function normalizeOp(input, options) {
    var now = options && options.now ? toDate(options.now) : new Date();
    if (!input || typeof input !== 'object') return { ok: false, error: '操作がありません' };
    var id = sanitizeText(input.id, 64);
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) return { ok: false, error: '操作IDが不正です' };
    var type = String(input.type || '');
    if (OP_TYPES.indexOf(type) < 0) return { ok: false, error: '未対応の操作です: ' + type };
    if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) {
      return { ok: false, error: '操作内容が不正です' };
    }
    var json = JSON.stringify(input.payload);
    if (json.length > 4000) return { ok: false, error: '操作内容が大きすぎます' };
    var at;
    try { at = toDate(input.at); } catch (e) { return { ok: false, error: '操作日時が不正です' }; }
    if (at.getTime() > now.getTime() + 10 * 60 * 1000) return { ok: false, error: '操作日時が未来です' };
    if (at.getTime() < now.getTime() - 3 * 24 * 60 * 60 * 1000) return { ok: false, error: '操作日時が古すぎます' };
    return {
      ok: true,
      op: {
        id: id, type: type, payload: JSON.parse(json), at: at.toISOString(),
        date: jstParts(at).dateKey, device: sanitizeText(input.device, 64)
      }
    };
  }

  function isMan(product, opt) {
    var list = opt && opt.manProducts;
    return list ? list.indexOf(product) >= 0 : (product === 'butaman' || product === 'anbata');
  }

  /* ---------------- 商品マスター（全端末で共有） ---------------- */
  var METHODS = ['steam', 'fry'];

  function defaultCatalog() {
    return {
      version: 0,
      products: [
        { id: 'butaman', name: '豚まん', short: '豚', man: true, methods: ['steam', 'fry'], prices: {}, enabled: true },
        { id: 'anbata', name: 'あんバタまん', short: 'あんバタ', man: true, methods: ['steam', 'fry'], prices: {}, enabled: true },
        { id: 'potato', name: 'ポテト', short: 'ポテト', man: false, methods: [], prices: {}, enabled: false }
      ],
      options: { serviceOn: true, serviceEvery: 5, friedFromSteamed: true }
    };
  }

  function priceOrNull(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) && Math.floor(n) === n && n >= 0 && n <= 100000 ? n : undefined;
  }

  /** 商品マスターの検証・正規化 */
  function normalizeCatalog(input) {
    if (!input || typeof input !== 'object' || !Array.isArray(input.products)) return { ok: false, error: '商品データが不正です' };
    if (input.products.length > 30) return { ok: false, error: '商品は30件までです' };
    var seen = {};
    var products = [];
    for (var i = 0; i < input.products.length; i++) {
      var p = input.products[i] || {};
      var id = sanitizeText(p.id, 32);
      if (!/^[A-Za-z0-9_-]{1,32}$/.test(id)) return { ok: false, error: '商品IDが不正です（' + (i + 1) + '件目）' };
      if (seen[id]) return { ok: false, error: '商品IDが重複しています: ' + id };
      seen[id] = true;
      var name = sanitizeText(p.name, 20);
      if (!name) return { ok: false, error: '商品名を入力してください（' + (i + 1) + '件目）' };
      var methods = (Array.isArray(p.methods) ? p.methods : []).filter(function (m, k, arr) { return METHODS.indexOf(m) >= 0 && arr.indexOf(m) === k; });
      var prices = {};
      var keys = methods.length ? methods : [''];
      for (var k = 0; k < keys.length; k++) {
        var pv = priceOrNull(p.prices ? p.prices[keys[k]] : null);
        if (pv === undefined) return { ok: false, error: name + ' の価格が不正です（0以上の整数）' };
        if (pv !== null) prices[keys[k]] = pv;
      }
      products.push({
        id: id, name: name, short: sanitizeText(p.short, 8) || name.slice(0, 4),
        man: !!p.man, methods: methods, prices: prices, enabled: p.enabled !== false
      });
    }
    var o = input.options || {};
    var every = Math.floor(Number(o.serviceEvery));
    return {
      ok: true,
      catalog: {
        version: Math.max(0, Math.floor(Number(input.version) || 0)),
        updatedAt: input.updatedAt || null,
        products: products,
        options: {
          serviceOn: o.serviceOn !== false,
          serviceEvery: every >= 1 && every <= 100 ? every : 5,
          friedFromSteamed: o.friedFromSteamed !== false
        }
      }
    };
  }

  /** 会計ボタン一覧（販売中の商品×調理方法） */
  function menuFromCatalog(catalog) {
    var out = [];
    (catalog.products || []).forEach(function (p) {
      if (!p.enabled) return;
      var methods = p.methods && p.methods.length ? p.methods : [''];
      methods.forEach(function (m) {
        var price = p.prices ? p.prices[m] : undefined;
        out.push({ key: p.id + (m ? '_' + m : ''), product: p.id, method: m, name: p.name, man: !!p.man, price: typeof price === 'number' ? price : null });
      });
    });
    return out;
  }

  /** 商品マスターから在庫計算用オプションを作る */
  function catalogOptions(catalog) {
    var o = catalog.options || {};
    return {
      manProducts: (catalog.products || []).filter(function (p) { return p.man; }).map(function (p) { return p.id; }),
      serviceOn: o.serviceOn !== false,
      serviceEvery: o.serviceEvery || 5,
      friedFromSteamed: o.friedFromSteamed !== false
    };
  }

  /** 有料まん類の個数からサービス付与数を計算（無料品・ポテトは数えない） */
  function serviceEntitled(lines, options) {
    var opt = merge(KITCHEN_DEFAULTS, options);
    if (!opt.serviceOn) return 0;
    var paid = 0;
    (lines || []).forEach(function (l) { if (isMan(l.product, opt)) paid += Number(l.qty) || 0; });
    return Math.floor(paid / opt.serviceEvery);
  }

  /** 注文が蒸し在庫から必要とする個数（商品別） */
  function orderNeeds(order, options) {
    var opt = merge(KITCHEN_DEFAULTS, options);
    var needs = {};
    (order.lines || []).concat(order.service || []).forEach(function (l) {
      if (!isMan(l.product, opt)) return;
      if (l.method === 'fry' && !opt.friedFromSteamed) return;
      needs[l.product] = (needs[l.product] || 0) + (Number(l.qty) || 0);
    });
    return needs;
  }

  /** 取り出し元の割当: 販売可能→確認待ちの順、蒸し上がりが古い段から */
  function allocate(sources, needs) {
    var list = sources.filter(function (s) { return s.remaining > 0 && (s.status === 'ready' || s.status === 'check'); })
      .sort(function (a, b) {
        var ra = a.status === 'ready' ? 0 : 1, rb = b.status === 'ready' ? 0 : 1;
        return ra - rb || a.endAt - b.endAt || a.tier - b.tier;
      });
    var allocations = [];
    var shortage = 0;
    Object.keys(needs).forEach(function (product) {
      var left = needs[product];
      for (var i = 0; i < list.length && left > 0; i++) {
        var s = list[i];
        if (s.product !== product || s.remaining <= 0) continue;
        var take = Math.min(s.remaining, left);
        s.remaining -= take;
        left -= take;
        allocations.push({ batchId: s.batchId, tier: s.tier, product: product, qty: take });
      }
      shortage += left;
    });
    return { allocations: allocations, shortage: shortage };
  }

  /** 操作列から現在の状態を計算する（純粋関数） */
  function buildState(ops, now, options) {
    var opt = merge(KITCHEN_DEFAULTS, options);
    var nowMs = (now ? toDate(now) : new Date()).getTime();
    var steamMs = opt.steamMinutes * 60 * 1000;
    var tierDefs = opt.tiers || defaultTiers();
    var tiers = tierDefs.map(function (t) { return { id: t.id, group: t.group, capacity: t.capacity, batches: [] }; });
    var tierMap = {};
    tiers.forEach(function (t) { tierMap[t.id] = t; });
    var batches = {};
    var orders = {};
    var orderList = [];
    var wastes = [];
    var seen = {};

    var sorted = (ops || []).filter(function (o) {
      if (!o || !o.id || seen[o.id]) return false;
      seen[o.id] = true;
      return true;
    }).sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : (a.id < b.id ? -1 : 1); });

    sorted.forEach(function (op) {
      var p = op.payload || {};
      var b = p.batchId ? batches[p.batchId] : null;
      var o = p.orderId ? orders[p.orderId] : null;
      switch (op.type) {
        case 'batch_start':
          if (b || !tierMap[p.tier]) return;
          var qty = Math.max(0, Math.floor(Number(p.qty) || 0));
          if (!qty) return;
          var started = toDate(p.startedAt || op.at).getTime();
          b = batches[p.batchId] = {
            batchId: p.batchId, tier: p.tier, product: /^[A-Za-z0-9_-]{1,32}$/.test(String(p.product || '')) ? String(p.product) : 'butaman',
            qty: qty, remaining: qty, startedAt: new Date(started).toISOString(), endAt: started + steamMs,
            confirmedAt: null, cancelled: false
          };
          tierMap[p.tier].batches.push(b);
          return;
        case 'batch_ready':
          if (b && !b.confirmedAt) b.confirmedAt = op.at;
          return;
        case 'batch_cancel':
          if (b) b.cancelled = true;
          return;
        case 'waste':
          var wq = Math.max(0, Math.floor(Number(p.qty) || 0));
          if (b) { wq = Math.min(wq, b.remaining); b.remaining -= wq; }
          if (wq) wastes.push({ batchId: p.batchId || null, product: b ? b.product : p.product, qty: wq, burden: p.burden === 'hq' ? 'hq' : 'store', reason: p.reason || '', at: op.at });
          return;
        case 'order_create':
          if (o) return;
          o = orders[p.orderId] = {
            orderId: p.orderId, number: Number(p.number) || 0, lines: p.lines || [], service: p.service || [],
            serviceDeclined: !!p.serviceDeclined, paid: !!p.paid, createdAt: op.at, device: op.device || '',
            fulfilled: false, cancelled: false, allocations: [], shortage: 0
          };
          orderList.push(o);
          return;
        case 'order_paid':
          if (o) o.paid = true;
          return;
        case 'order_cancel':
          if (o && !o.fulfilled) o.cancelled = true;
          return;
        case 'order_fulfill':
          if (!o || o.fulfilled || o.cancelled) return;
          o.fulfilled = true;
          o.paid = o.paid || !!p.paid;
          o.fulfilledAt = op.at;
          o.shortage = Number(p.shortage) || 0;
          (p.allocations || []).forEach(function (a) {
            var src = batches[a.batchId];
            var want = Math.max(0, Math.floor(Number(a.qty) || 0));
            var take = src && !src.cancelled ? Math.min(src.remaining, want) : 0;
            if (src) src.remaining -= take;
            if (take) o.allocations.push({ batchId: a.batchId, tier: src.tier, product: src.product, qty: take });
            o.shortage += want - take;
          });
          return;
      }
    });

    // 段ごとの状態
    var totals = { steaming: 0, check: 0, ready: 0, byProduct: {} };
    var nextReady = null;
    var sources = [];
    tiers.forEach(function (t) {
      t.batches = t.batches.filter(function (x) { return !x.cancelled && x.remaining > 0; });
      t.batches.forEach(function (x) {
        x.status = x.confirmedAt ? 'ready' : (nowMs < x.endAt ? 'steaming' : 'check');
        x.remainingMinutes = Math.max(0, Math.ceil((x.endAt - nowMs) / 60000));
        x.progress = Math.max(0, Math.min(1, 1 - (x.endAt - nowMs) / steamMs));
        totals[x.status] += x.remaining;
        var bp = totals.byProduct[x.product] || (totals.byProduct[x.product] = { steaming: 0, check: 0, ready: 0 });
        bp[x.status] += x.remaining;
        if (x.status === 'steaming' && (!nextReady || x.endAt < nextReady.endAt)) {
          nextReady = { endAt: x.endAt, minutes: x.remainingMinutes, tier: t.id };
        }
        sources.push({ batchId: x.batchId, tier: t.id, product: x.product, remaining: x.remaining, status: x.status, endAt: x.endAt });
      });
      var qty = 0;
      t.batches.forEach(function (x) { qty += x.remaining; });
      t.qty = qty;
      t.status = !t.batches.length ? 'empty'
        : t.batches.some(function (x) { return x.status === 'check'; }) ? 'check'
        : t.batches.some(function (x) { return x.status === 'steaming'; }) ? 'steaming' : 'ready';
      var steamingBatches = t.batches.filter(function (x) { return x.status === 'steaming'; });
      t.remainingMinutes = steamingBatches.length ? Math.min.apply(null, steamingBatches.map(function (x) { return x.remainingMinutes; })) : 0;
      t.progress = steamingBatches.length ? Math.max.apply(null, steamingBatches.map(function (x) { return x.progress; })) : 1;
      t.free = Math.max(0, t.capacity - qty);
    });

    // 注文番号の重複（オフライン同時受付）には端末記号を付けて区別
    var numCount = {};
    orderList.sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : 1; });
    orderList.forEach(function (x) { numCount[x.number] = (numCount[x.number] || 0) + 1; });
    var maxNumber = 0;
    orderList.forEach(function (x) {
      x.label = String(x.number) + (numCount[x.number] > 1 ? '-' + (x.device || '?').slice(-2).toUpperCase() : '');
      if (x.number > maxNumber) maxNumber = x.number;
      x.delivery = summarizeLines(x.lines.concat(x.service));
    });

    // 待ち注文に取り出し元を予約（同じ在庫を二重に割り当てない）
    var waiting = orderList.filter(function (x) { return !x.fulfilled && !x.cancelled; });
    var reserved = 0;
    waiting.forEach(function (x) {
      x.plan = allocate(sources, orderNeeds(x, opt));
      x.plan.allocations.forEach(function (a) { reserved += a.qty; });
    });

    var lossStore = 0, lossHq = 0;
    wastes.forEach(function (w) { if (w.burden === 'store') lossStore += w.qty; else lossHq += w.qty; });
    var sold = { orders: 0, pieces: 0, service: 0 };
    orderList.forEach(function (x) {
      if (!x.fulfilled) return;
      sold.orders++;
      x.lines.forEach(function (l) { sold.pieces += Number(l.qty) || 0; });
      x.service.forEach(function (l) { sold.service += Number(l.qty) || 0; });
    });

    return {
      tiers: tiers,
      totals: totals,
      available: totals.ready + totals.check - reserved,
      reserved: reserved,
      nextReady: nextReady,
      orders: orderList,
      waiting: waiting,
      nextOrderNumber: maxNumber + 1,
      wastes: wastes,
      loss: { storePieces: lossStore, storeYen: lossStore * opt.lossYenPerPiece, hqPieces: lossHq },
      sold: sold,
      opCount: sorted.length
    };
  }

  /** お渡し時の実割当: 予約に関係なく物理在庫から割り当てる（先にお渡しした注文が優先） */
  function planFulfill(state, order, options) {
    var sources = [];
    state.tiers.forEach(function (t) {
      t.batches.forEach(function (x) {
        sources.push({ batchId: x.batchId, tier: t.id, product: x.product, remaining: x.remaining, status: x.status, endAt: x.endAt });
      });
    });
    return allocate(sources, orderNeeds(order, options));
  }

  /** 商品×調理方法ごとのお渡し数 */
  function summarizeLines(lines) {
    var map = {};
    var order = [];
    (lines || []).forEach(function (l) {
      var key = l.product + '|' + (l.method || '');
      if (!map[key]) { map[key] = { product: l.product, method: l.method || '', qty: 0 }; order.push(key); }
      map[key].qty += Number(l.qty) || 0;
    });
    return order.map(function (k) { return map[k]; }).filter(function (x) { return x.qty > 0; });
  }

  /**
   * 次に蒸す数の助言: 40分後の時間帯の予測需要 − 今ある供給（販売可能＋確認待ち＋蒸し中 − 予約済み）
   * 蒸し中は40分以内に必ず蒸し上がるので供給に含める。
   */
  function steamAdvice(state, fc, options) {
    var capacity = (options && options.tierCapacity) || 5;
    var supply = state.totals.ready + state.totals.check + state.totals.steaming - state.reserved;
    if (!fc || fc.status !== 'ready') {
      return { status: 'learning', supply: supply, samples: fc ? fc.samples : 0, needed: fc ? fc.needed : 3 };
    }
    var need = Math.max(0, fc.total - supply);
    return { status: 'ready', demand: fc.total, supply: supply, need: need, tiers: Math.ceil(need / capacity) };
  }

  /** スプレッドシートの数式インジェクション対策 */
  function safeCell(value) {
    if (typeof value !== 'string') return value;
    return /^[=+\-@]/.test(value) ? "'" + value : value;
  }

  return {
    DEFAULTS: DEFAULTS,
    WEEKDAYS: WEEKDAYS,
    jstParts: jstParts,
    slotOf: slotOf,
    normalizeDelivery: normalizeDelivery,
    forecast: forecast,
    summarize: summarize,
    mergeRecords: mergeRecords,
    deliveryStats: deliveryStats,
    OP_TYPES: OP_TYPES,
    KITCHEN_DEFAULTS: KITCHEN_DEFAULTS,
    defaultTiers: defaultTiers,
    normalizeOp: normalizeOp,
    serviceEntitled: serviceEntitled,
    orderNeeds: orderNeeds,
    allocate: allocate,
    planFulfill: planFulfill,
    buildState: buildState,
    summarizeLines: summarizeLines,
    steamAdvice: steamAdvice,
    defaultCatalog: defaultCatalog,
    normalizeCatalog: normalizeCatalog,
    menuFromCatalog: menuFromCatalog,
    catalogOptions: catalogOptions,
    safeCell: safeCell
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = NomiCore;
}
