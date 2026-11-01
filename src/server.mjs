/**
 * 能美豚饅 蒸し・会計・注文管理システム (v0.2)
 * ローカル開発・現場LAN内全スマホ共有用 Webサーバー + SSE同期 + オフライン永続化
 *
 * 特徴:
 * - 0.0.0.0 バインドにより、同一Wi-Fi / テザリング内の全てのスマートフォン（iPhone / Android）からブラウザでアクセス可能
 * - 複数スマホ間の改訂番号(revision)競合防止・スナップショットファイル自動保存(.data/store-snapshot.json)
 * - スマホで読み取るための接続先URL一覧（LAN IP）の取得API (/api/network-info)
 * - 公開クラウドデプロイ・有料サービス契約・外部送金は一切行わない（ローカル/現場LAN完結）
 * - 仕様通り「同期方式・通信切断時・画面非表示中の通知は現場未検証(UNVERIFIED)」を明示して稼働
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_PERSIST_PATH = path.join(ROOT_DIR, '.data', 'store-snapshot.json');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

/**
 * 同一Wi-Fi / テザリング内のスマホからアクセスできるローカルIPv4アドレス一覧を取得する
 */
export function getLanAddresses(port = 3110) {
  const nets = os.networkInterfaces();
  const urls = [];
  for (const [name, netList] of Object.entries(nets)) {
    if (!Array.isArray(netList)) continue;
    for (const net of netList) {
      if (net.family === 'IPv4' && !net.internal) {
        urls.push({
          interface: name,
          ip: net.address,
          url: `http://${net.address}:${port}`,
        });
      }
    }
  }
  return urls;
}

export function createAppServer({
  initialSnapshot = null,
  persistFilePath = null, // null の場合はメモリのみ（テスト用）、文字列指定でファイル永続化
  port = 3110,
  initialWriterDeviceId = null,
  initialKitchenDeviceId = null,
  initialOrderDeviceId = null,
} = {}) {
  let sharedState = initialSnapshot;
  // 担当ロール管理
  // kitchenDeviceId: キッチン係（せいろ投入・調理確認・廃棄・揚げ在庫追加）
  // orderDeviceId: 注文係（注文作成・変更・キャンセル・会計・お渡し完了・段訂正・イベント設定・経費）
  // 1人運用の場合は同一端末が両方のロールを担当可能
  let kitchenDeviceId = initialKitchenDeviceId || initialWriterDeviceId || null;
  let orderDeviceId = initialOrderDeviceId || initialWriterDeviceId || null;
  let rolesSince = new Date().toISOString();

  const sseClients = new Map(); // res -> { deviceId, connectedAt }
  const metaFilePath = persistFilePath
    ? path.join(path.dirname(persistFilePath), 'server-meta.json')
    : null;

  // 永続化ファイルからの初期復元
  if (persistFilePath && !sharedState) {
    try {
      if (fs.existsSync(persistFilePath)) {
        const raw = fs.readFileSync(persistFilePath, 'utf-8');
        sharedState = JSON.parse(raw);
      }
    } catch {
      // 読み込み失敗時は null のまま開始
    }
  }
  if (metaFilePath) {
    try {
      if (fs.existsSync(metaFilePath)) {
        const meta = JSON.parse(fs.readFileSync(metaFilePath, 'utf-8'));
        if (!kitchenDeviceId && meta.kitchenDeviceId) kitchenDeviceId = meta.kitchenDeviceId;
        if (!orderDeviceId && meta.orderDeviceId) orderDeviceId = meta.orderDeviceId;
        // 旧writerDeviceIdの後方互換
        if (!kitchenDeviceId && meta.writerDeviceId) kitchenDeviceId = meta.writerDeviceId;
        if (!orderDeviceId && meta.writerDeviceId) orderDeviceId = meta.writerDeviceId;
        if (meta.rolesSince) rolesSince = meta.rolesSince;
      }
    } catch {
      // ignore
    }
  }

  function currentRevision() {
    return sharedState?.revision ?? 0;
  }

  function currentKitchenRevision() {
    return sharedState?.kitchenRevision ?? 0;
  }

  function currentOrderRevision() {
    return sharedState?.orderRevision ?? 0;
  }

  function writeFileSafe(filePath, data) {
    if (!filePath) return;
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tmp = `${filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
      fs.renameSync(tmp, filePath);
    } catch {
      // ignore
    }
  }

  function saveToDisk(snapshot) {
    if (!persistFilePath || !snapshot) return;
    writeFileSafe(persistFilePath, snapshot);
  }

  function saveMeta() {
    writeFileSafe(metaFilePath, { kitchenDeviceId, orderDeviceId, rolesSince });
  }

  function sendToAll(message) {
    const payload = JSON.stringify({
      ...message,
      kitchenDeviceId,
      orderDeviceId,
      writerDeviceId: orderDeviceId, // 後方互換
      connectedDevicesCount: sseClients.size,
      serverTime: new Date().toISOString(),
    });
    for (const res of sseClients.keys()) {
      res.write(`data: ${payload}\n\n`);
    }
  }

  function broadcastSnapshot(snapshot, sourceDeviceId = '') {
    sendToAll({ type: 'STATE_SYNC', sourceDeviceId, snapshot });
  }

  function sendJson(res, statusCode, obj) {
    res.writeHead(statusCode, { 'Content-Type': MIME_TYPES['.json'] });
    res.end(
      JSON.stringify({
        ...obj,
        kitchenDeviceId,
        orderDeviceId,
        writerDeviceId: orderDeviceId, // 後方互換
        serverTime: new Date().toISOString(),
      })
    );
  }

  function readJsonBody(req, callback) {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        callback(null, JSON.parse(body || '{}'));
      } catch (err) {
        callback(err);
      }
    });
  }

  function handleRequest(req, res) {
    const urlObj = new URL(req.url, `http://${req.headers?.host || 'localhost'}`);
    const pathname = urlObj.pathname;

    // CORS ヘッダー（LAN内スマホ・WebView等からのアクセスを許可）
    res.setHeader?.('Access-Control-Allow-Origin', '*');
    res.setHeader?.('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader?.('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // 1. SSE エンドポイント（複数スマホ・複数タブへのリアルタイム配信）
    if (req.method === 'GET' && pathname === '/api/events') {
      const deviceId = urlObj.searchParams.get('deviceId') || 'unknown';
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      });
      sseClients.set(res, { deviceId, connectedAt: new Date().toISOString() });
      res.write(
        `data: ${JSON.stringify({
          type: 'CONNECTED',
          connectedDevicesCount: sseClients.size,
          kitchenDeviceId,
          orderDeviceId,
          writerDeviceId: orderDeviceId,
          serverTime: new Date().toISOString(),
          snapshot: sharedState,
        })}\n\n`
      );
      if (typeof req.on === 'function') {
        req.on('close', () => {
          sseClients.delete(res);
        });
      }
      return;
    }

    // 2. スマホ接続案内・LAN IP情報取得 API
    if (req.method === 'GET' && pathname === '/api/network-info') {
      let tunnelUrl = null;
      try {
        const tunnelPath = path.join(ROOT_DIR, '.data', 'tunnel-url.txt');
        if (fs.existsSync(tunnelPath)) {
          tunnelUrl = fs.readFileSync(tunnelPath, 'utf-8').trim();
        }
      } catch {
        // ignore
      }

      sendJson(res, 200, {
        ok: true,
        port,
        localhostUrl: `http://127.0.0.1:${port}`,
        tunnelUrl,
        lanUrls: getLanAddresses(port),
        connectedDevicesCount: sseClients.size,
        syncVerificationStatus: 'UNVERIFIED',
      });
      return;
    }

    // 3. スナップショット取得 API
    if (req.method === 'GET' && pathname === '/api/state') {
      sendJson(res, 200, {
        ok: true,
        syncVerificationStatus: 'UNVERIFIED', // 仕様: 同期方式/通信切断時/画面非表示中通知は未検証扱い
        connectedDevicesCount: sseClients.size,
        revision: currentRevision(),
        kitchenRevision: currentKitchenRevision(),
        orderRevision: currentOrderRevision(),
        rolesSince,
        snapshot: sharedState,
      });
      return;
    }

    // 4. ロール担当の取得・切替 API
    //    - role: 'kitchen' | 'order' | 'both'
    //    - takeover: true の場合、既存担当がいても奪還
    if (req.method === 'POST' && pathname === '/api/roles') {
      readJsonBody(req, (err, parsed) => {
        if (err || !parsed.deviceId || !parsed.role) {
          sendJson(res, 400, { ok: false, code: 'BAD_REQUEST', error: 'deviceId と role が必要です' });
          return;
        }
        const { deviceId, role, takeover } = parsed;
        const wantKitchen = role === 'kitchen' || role === 'both';
        const wantOrder = role === 'order' || role === 'both';

        if (wantKitchen && kitchenDeviceId && kitchenDeviceId !== deviceId && !takeover) {
          sendJson(res, 409, {
            ok: false,
            code: 'ROLE_OCCUPIED',
            role: 'kitchen',
            occupiedBy: kitchenDeviceId,
            revision: currentRevision(),
          });
          return;
        }
        if (wantOrder && orderDeviceId && orderDeviceId !== deviceId && !takeover) {
          sendJson(res, 409, {
            ok: false,
            code: 'ROLE_OCCUPIED',
            role: 'order',
            occupiedBy: orderDeviceId,
            revision: currentRevision(),
          });
          return;
        }

        let changed = false;
        if (wantKitchen && kitchenDeviceId !== deviceId) {
          kitchenDeviceId = deviceId;
          changed = true;
        }
        if (wantOrder && orderDeviceId !== deviceId) {
          orderDeviceId = deviceId;
          changed = true;
        }

        if (changed) {
          rolesSince = new Date().toISOString();
          saveMeta();
          sendToAll({ type: 'ROLES_CHANGED' });
        }

        sendJson(res, 200, {
          ok: true,
          rolesSince,
          revision: currentRevision(),
          snapshot: sharedState,
        });
      });
      return;
    }

    // 旧 /api/writer APIの後方互換
    if (req.method === 'POST' && pathname === '/api/writer') {
      readJsonBody(req, (err, parsed) => {
        if (err || !parsed.deviceId) {
          sendJson(res, 400, { ok: false, code: 'BAD_REQUEST', error: err?.message || 'deviceId が必要です' });
          return;
        }
        // writer = both ロールとして処理
        if ((kitchenDeviceId && kitchenDeviceId !== parsed.deviceId) ||
            (orderDeviceId && orderDeviceId !== parsed.deviceId)) {
          if (!parsed.takeover) {
            sendJson(res, 409, { ok: false, code: 'WRITER_EXISTS', revision: currentRevision() });
            return;
          }
        }
        kitchenDeviceId = parsed.deviceId;
        orderDeviceId = parsed.deviceId;
        rolesSince = new Date().toISOString();
        saveMeta();
        sendToAll({ type: 'ROLES_CHANGED' });
        sendJson(res, 200, {
          ok: true,
          writerSince: rolesSince,
          revision: currentRevision(),
          snapshot: sharedState,
        });
      });
      return;
    }

    // 5. 分割更新 API (/api/state)
    //    domain: 'kitchen' | 'order' | 'all' (デフォルトall)
    //    kitchen更新時: せいろ(tiers)・廃棄(wasteRecords)・非せいろ在庫(nonSteamerReadyStock)のみをマージ
    //    order更新時: 注文(orders, orderSeq)・経費(expenseState)・イベント設定(eventConfig)・段訂正履歴(tierCorrectionHistory)のみをマージ
    if (req.method === 'POST' && pathname === '/api/state') {
      readJsonBody(req, (err, parsed) => {
        if (err) {
          sendJson(res, 400, { ok: false, code: 'BAD_REQUEST', error: err.message });
          return;
        }
        if (!parsed.snapshot || typeof parsed.snapshot !== 'object') {
          sendJson(res, 400, { ok: false, code: 'BAD_REQUEST', error: 'snapshot が必要です' });
          return;
        }

        const domain = parsed.domain || 'all';

        // 権限検証
        if (domain === 'kitchen') {
          if (!kitchenDeviceId) {
            sendJson(res, 403, { ok: false, code: 'NO_KITCHEN_ROLE', revision: currentRevision(), snapshot: sharedState });
            return;
          }
          if (parsed.deviceId !== kitchenDeviceId) {
            sendJson(res, 403, { ok: false, code: 'READ_ONLY_KITCHEN', revision: currentRevision(), snapshot: sharedState });
            return;
          }
        } else if (domain === 'order') {
          if (!orderDeviceId) {
            sendJson(res, 403, { ok: false, code: 'NO_ORDER_ROLE', revision: currentRevision(), snapshot: sharedState });
            return;
          }
          if (parsed.deviceId !== orderDeviceId) {
            sendJson(res, 403, { ok: false, code: 'READ_ONLY_ORDER', revision: currentRevision(), snapshot: sharedState });
            return;
          }
        } else {
          // domain === 'all'
          if (!kitchenDeviceId && !orderDeviceId) {
            sendJson(res, 403, { ok: false, code: 'NO_WRITER', revision: currentRevision(), snapshot: sharedState });
            return;
          }
          const canKitchen = kitchenDeviceId && parsed.deviceId === kitchenDeviceId;
          const canOrder = orderDeviceId && parsed.deviceId === orderDeviceId;
          if (!canKitchen && !canOrder) {
            sendJson(res, 403, { ok: false, code: 'READ_ONLY', revision: currentRevision(), snapshot: sharedState });
            return;
          }
        }

        const currentRev = currentRevision();
        const incomingKitchenRev = currentKitchenRevision();
        const incomingOrderRev = currentOrderRevision();

        if (domain === 'kitchen') {
          if (parsed.baseKitchenRevision !== undefined && parsed.baseKitchenRevision !== incomingKitchenRev) {
            sendJson(res, 409, { ok: false, code: 'CONFLICT_KITCHEN', revision: currentRev, snapshot: sharedState });
            return;
          }
        } else if (domain === 'order') {
          if (parsed.baseOrderRevision !== undefined && parsed.baseOrderRevision !== incomingOrderRev) {
            sendJson(res, 409, { ok: false, code: 'CONFLICT_ORDER', revision: currentRev, snapshot: sharedState });
            return;
          }
        } else {
          if (parsed.baseRevision !== undefined && parsed.baseRevision !== currentRev) {
            sendJson(res, 409, { ok: false, code: 'CONFLICT', revision: currentRev, snapshot: sharedState });
            return;
          }
        }

        // マージ処理
        const prevState = sharedState || {};
        let nextState = structuredClone(prevState);

        if (domain === 'kitchen') {
          nextState.tiers = structuredClone(parsed.snapshot.tiers);
          nextState.wasteRecords = structuredClone(parsed.snapshot.wasteRecords || []);
          nextState.wasteSeq = parsed.snapshot.wasteSeq ?? prevState.wasteSeq ?? 0;
          nextState.batchSeq = parsed.snapshot.batchSeq ?? prevState.batchSeq ?? 0;
          nextState.nonSteamerReadyStock = structuredClone(parsed.snapshot.nonSteamerReadyStock || []);
          nextState.kitchenRevision = incomingKitchenRev + 1;
          nextState.revision = currentRev + 1;
        } else if (domain === 'order') {
          nextState.orders = structuredClone(parsed.snapshot.orders);
          nextState.orderSeq = parsed.snapshot.orderSeq ?? prevState.orderSeq ?? 0;
          nextState.correctionSeq = parsed.snapshot.correctionSeq ?? prevState.correctionSeq ?? 0;
          nextState.tierCorrectionHistory = structuredClone(parsed.snapshot.tierCorrectionHistory || []);
          nextState.expenseState = structuredClone(parsed.snapshot.expenseState || prevState.expenseState);
          if (parsed.snapshot.eventConfig) {
            nextState.eventConfig = structuredClone(parsed.snapshot.eventConfig);
          }
          nextState.orderRevision = incomingOrderRev + 1;
          nextState.revision = currentRev + 1;
        } else {
          // all
          nextState = structuredClone(parsed.snapshot);
          nextState.kitchenRevision = incomingKitchenRev + 1;
          nextState.orderRevision = incomingOrderRev + 1;
          nextState.revision = currentRev + 1;
        }

        nextState.lastUpdatedByDevice = parsed.deviceId;
        nextState.lastUpdatedAt = new Date().toISOString();

        sharedState = nextState;
        saveToDisk(sharedState);
        broadcastSnapshot(sharedState, parsed.deviceId);
        sendJson(res, 200, {
          ok: true,
          revision: sharedState.revision,
          kitchenRevision: sharedState.kitchenRevision,
          orderRevision: sharedState.orderRevision,
        });
      });
      return;
    }

    // 5. 静的ファイル配信 (/public および /src のESモジュール, /sw.js, /manifest.webmanifest)
    let relativePath = pathname === '/' ? '/public/index.html' : pathname;
    if (!relativePath.startsWith('/public/') && !relativePath.startsWith('/src/')) {
      relativePath = `/public${relativePath}`;
    }

    const safePath = path.normalize(path.join(ROOT_DIR, relativePath));
    if (!safePath.startsWith(ROOT_DIR)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.readFile(safePath, (err, content) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return;
      }
      const ext = path.extname(safePath);
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(content);
    });
  }

  const server = http.createServer(handleRequest);

  return { server, handleRequest, getSharedState: () => sharedState };
}

// 直接実行された場合は 0.0.0.0（全ネットワークインターフェース）のポート 3110 で起動し、スマホ接続用URLを表示する
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const port = Number(process.env.PORT || 3110);
  const host = process.env.HOST || '0.0.0.0';
  const { server } = createAppServer({ persistFilePath: DEFAULT_PERSIST_PATH, port });
  server.listen(port, host, () => {
    const lanUrls = getLanAddresses(port);
    console.log('============================================================');
    console.log(' 能美豚饅 蒸し・会計・注文管理システム v0.2 (全スマホ対応)');
    console.log(` PCローカルURL : http://127.0.0.1:${port}`);
    if (lanUrls.length > 0) {
      console.log(' 同一Wi-Fi/テザリング内の各スマホからは以下のURLで開けます:');
      for (const item of lanUrls) {
        console.log(`   -> ${item.url} (${item.interface})`);
      }
    } else {
      console.log(' ※Wi-Fi/テザリング接続時にスマホ用LANアドレスが表示されます');
    }
    console.log('============================================================');
  });
}
