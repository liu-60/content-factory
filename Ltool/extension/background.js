import { checkAuth, listPlatforms, syncArticleBatch } from './sync-engine.js';

const DEFAULT_WS_URL = 'ws://localhost:9527';
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 15000;

let ws = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let lastError = '';
let lastRequest = null;
let lastClient = null;
let lastBatch = null;
let platformCache = [];
let refreshingPlatforms = false;

chrome.runtime.onInstalled.addListener(async () => {
  const config = await chrome.storage.local.get(['token', 'wsUrl', 'enabled']);
  const initial = {};
  if (!config.wsUrl) initial.wsUrl = DEFAULT_WS_URL;
  if (config.enabled === undefined) initial.enabled = true;
  if (Object.keys(initial).length) await chrome.storage.local.set(initial);
  ensureReconnectAlarm();
  connectBridge();
});

chrome.runtime.onStartup.addListener(() => {
  ensureReconnectAlarm();
  connectBridge();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'ltool-reconnect') connectBridge();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'LTOOL_POPUP_STATUS') {
    connectBridge().finally(() => getPopupStatus().then(sendResponse));
    return true;
  }
  if (message?.type === 'LTOOL_POPUP_REFRESH') {
    connectBridge()
      .then(() => refreshPlatformCache(true))
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.enabled || changes.wsUrl || changes.token) {
    disconnectBridge();
    connectBridge();
  }
});

ensureReconnectAlarm();
connectBridge();

function ensureReconnectAlarm() {
  chrome.alarms.create('ltool-reconnect', { periodInMinutes: 1 });
}

async function getSettings() {
  const settings = await chrome.storage.local.get(['token', 'wsUrl', 'enabled']);
  return {
    enabled: settings.enabled !== false,
    token: settings.token || '',
    wsUrl: settings.wsUrl || DEFAULT_WS_URL,
  };
}

async function getPopupStatus() {
  const settings = await getSettings();
  return {
    ok: true,
    bridgeConnected: ws?.readyState === WebSocket.OPEN,
    bridgeState: websocketState(ws?.readyState),
    bridgeUrl: settings.wsUrl,
    enabled: settings.enabled,
    tokenConfigured: Boolean(settings.token),
    extensionVersion: chrome.runtime.getManifest().version,
    lastError,
    lastRequest,
    lastClient,
    lastBatch,
    refreshingPlatforms,
    platforms: platformCache,
  };
}

async function connectBridge() {
  const settings = await getSettings();
  if (!settings.enabled || ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return;

  try {
    ws = new WebSocket(settings.wsUrl);
    ws.onopen = () => {
      reconnectAttempts = 0;
      lastError = '';
      setBadge('ON', '#15803d');
      refreshPlatformCache(false).catch(() => {});
    };
    ws.onclose = () => {
      ws = null;
      setBadge('OFF', '#b91c1c');
      scheduleReconnect();
    };
    ws.onerror = () => {
      lastError = 'WebSocket connection error';
    };
    ws.onmessage = (event) => handleMessage(event.data);
  } catch (error) {
    lastError = error.message;
    scheduleReconnect();
  }
}

function disconnectBridge() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectAttempts += 1;
  const delay = Math.min(RECONNECT_MIN_MS * 2 ** Math.min(reconnectAttempts, 4), RECONNECT_MAX_MS);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectBridge();
  }, delay);
}

function setBadge(text, color) {
  chrome.action.setBadgeText({ text }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color }).catch(() => {});
}

async function handleMessage(raw) {
  let request;
  try {
    request = JSON.parse(raw);
  } catch {
    return;
  }

  lastRequest = {
    method: request.method,
    at: new Date().toISOString(),
  };
  lastClient = request.client || null;

  const response = { id: request.id };
  try {
    const settings = await getSettings();
    if (!settings.token) throw new Error('Token not configured in extension popup');
    if (request.token !== settings.token) throw new Error('Invalid or missing token');
    response.result = await handleMethod(request.method, request.params || {});
  } catch (error) {
    lastError = error.message;
    response.error = { message: error.message };
  }
  ws?.send(JSON.stringify(response));
}

async function handleMethod(method, params) {
  switch (method) {
    case 'getStatus':
      return await getPopupStatus();
    case 'listPlatforms':
      return await refreshPlatformCache(Boolean(params.forceRefresh));
    case 'checkAuth':
      return await checkAuth(params.platform);
    case 'syncArticleBatch': {
      const result = await syncArticleBatch(params);
      lastBatch = {
        batchId: result.batchId,
        at: new Date().toISOString(),
        total: result.results?.length || 0,
        success: result.results?.filter((item) => item.success).length || 0,
      };
      refreshPlatformCache(false).catch(() => {});
      return result;
    }
    default:
      throw new Error(`Unknown method: ${method}`);
  }
}

async function refreshPlatformCache(forceRefresh) {
  refreshingPlatforms = true;
  try {
    platformCache = await listPlatforms(forceRefresh);
    return platformCache;
  } finally {
    refreshingPlatforms = false;
  }
}

function websocketState(state) {
  return ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][state] || 'DISCONNECTED';
}
