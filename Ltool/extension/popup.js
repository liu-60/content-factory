const DEFAULT_WS_URL = 'ws://localhost:9527';

const els = {
  refreshButton: document.querySelector('#refreshButton'),
  version: document.querySelector('#version'),
  bridgeState: document.querySelector('#bridgeState'),
  bridgeDetail: document.querySelector('#bridgeDetail'),
  tokenState: document.querySelector('#tokenState'),
  tokenDetail: document.querySelector('#tokenDetail'),
  enabledInput: document.querySelector('#enabledInput'),
  wsUrlInput: document.querySelector('#wsUrlInput'),
  tokenInput: document.querySelector('#tokenInput'),
  saveButton: document.querySelector('#saveButton'),
  saveState: document.querySelector('#saveState'),
  refreshState: document.querySelector('#refreshState'),
  platformList: document.querySelector('#platformList'),
  lastClient: document.querySelector('#lastClient'),
  lastMethod: document.querySelector('#lastMethod'),
  lastBatch: document.querySelector('#lastBatch'),
  lastError: document.querySelector('#lastError'),
};

let lastStatus = null;

els.refreshButton.addEventListener('click', () => refreshPlatforms());
els.saveButton.addEventListener('click', () => saveSettings());

await loadSettings();
await loadStatus();

async function loadSettings() {
  const settings = await chrome.storage.local.get(['enabled', 'wsUrl', 'token']);
  els.enabledInput.checked = settings.enabled !== false;
  els.wsUrlInput.value = settings.wsUrl || DEFAULT_WS_URL;
  els.tokenInput.value = settings.token || '';
}

async function saveSettings() {
  els.saveState.textContent = '保存中';
  await chrome.storage.local.set({
    enabled: els.enabledInput.checked,
    wsUrl: els.wsUrlInput.value.trim() || DEFAULT_WS_URL,
    token: els.tokenInput.value.trim(),
  });
  els.saveState.textContent = '已保存';
  setTimeout(() => {
    els.saveState.textContent = '';
  }, 1800);
  await loadStatus();
}

async function loadStatus() {
  const response = await sendMessage({ type: 'LTOOL_POPUP_STATUS' });
  if (!response?.ok) {
    renderError(response?.error || '无法读取插件状态');
    return;
  }
  lastStatus = response;
  renderStatus(response);
}

async function refreshPlatforms() {
  els.refreshButton.disabled = true;
  els.refreshState.textContent = '刷新中';
  const response = await sendMessage({ type: 'LTOOL_POPUP_REFRESH' });
  els.refreshButton.disabled = false;
  if (!response?.ok && response?.error) {
    els.refreshState.textContent = '刷新失败';
    els.lastError.textContent = response.error;
    return;
  }
  els.refreshState.textContent = `已刷新 ${formatTime(new Date())}`;
  await loadStatus();
}

function renderStatus(status) {
  els.version.textContent = `v${status.extensionVersion || '-'}`;
  els.enabledInput.checked = status.enabled;
  els.wsUrlInput.value = status.bridgeUrl || DEFAULT_WS_URL;
  if (!els.tokenInput.value && status.tokenConfigured) els.tokenInput.placeholder = '已配置';

  const bridgeOnline = status.enabled && status.bridgeConnected;
  els.bridgeState.textContent = bridgeOnline ? '在线' : status.enabled ? '等待连接' : '已停用';
  els.bridgeState.style.color = bridgeOnline ? 'var(--ok)' : status.enabled ? 'var(--warn)' : 'var(--muted)';
  els.bridgeDetail.textContent = status.lastClient?.name ? `最近: ${status.lastClient.name}` : status.bridgeState || '-';

  els.tokenState.textContent = status.tokenConfigured ? '已配置' : '未配置';
  els.tokenState.style.color = status.tokenConfigured ? 'var(--ok)' : 'var(--bad)';
  els.tokenDetail.textContent = status.tokenConfigured ? 'CLI/MCP 可鉴权连接' : '先执行 Ltool token set';

  els.refreshState.textContent = status.refreshingPlatforms ? '刷新中' : '';
  renderPlatforms(status.platforms || []);
  renderLastActivity(status);
}

function renderPlatforms(platforms) {
  if (!platforms.length) {
    els.platformList.innerHTML = '<div class="platform-row"><div><div class="platform-name">暂无数据</div><div class="platform-meta">点击右上角刷新</div></div><span class="pill warn">待刷新</span></div>';
    return;
  }
  els.platformList.replaceChildren(...platforms.map((platform) => {
    const row = document.createElement('div');
    row.className = 'platform-row';

    const main = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'platform-name';
    name.textContent = platform.name || platform.id;
    const meta = document.createElement('div');
    meta.className = 'platform-meta';
    meta.textContent = platform.error || platform.username || platform.userId || platform.mode || platform.loginUrl || '-';
    main.append(name, meta);

    const pill = document.createElement('span');
    pill.className = `pill ${platform.isAuthenticated ? 'ok' : platform.error ? 'warn' : 'bad'}`;
    pill.textContent = platform.isAuthenticated ? '已登录' : platform.error ? '异常' : '未登录';
    row.append(main, pill);
    return row;
  }));
}

function renderLastActivity(status) {
  const request = status.lastRequest || {};
  const batch = status.lastBatch || {};
  els.lastClient.textContent = status.lastClient?.name || '-';
  els.lastMethod.textContent = request.method ? `${request.method} ${request.at ? formatTime(request.at) : ''}` : '-';
  els.lastBatch.textContent = batch.batchId ? `${batch.batchId} ${batch.success || 0}/${batch.total || 0}` : '-';
  els.lastError.textContent = status.lastError || '';
}

function renderError(message) {
  els.bridgeState.textContent = '错误';
  els.bridgeState.style.color = 'var(--bad)';
  els.bridgeDetail.textContent = message;
  els.lastError.textContent = message;
}

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
      else resolve(response);
    });
  });
}

function formatTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
