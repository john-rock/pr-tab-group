// ── Element refs ──────────────────────────────────────────────────────────────

const toggle       = document.getElementById('enableToggle');
const settingsBtn  = document.getElementById('settingsBtn');
const settingsPanel= document.getElementById('settingsPanel');
const tokenInput   = document.getElementById('tokenInput');
const saveTokenBtn = document.getElementById('saveTokenBtn');
const clearTokenBtn= document.getElementById('clearTokenBtn');
const tokenFeedback= document.getElementById('tokenFeedback');

const syncBar      = document.getElementById('syncBar');
const syncStatus   = document.getElementById('syncStatus');
const syncNowBtn   = document.getElementById('syncNowBtn');

const loading      = document.getElementById('loading');
const setupEl      = document.getElementById('setup');
const openSettingsBtn = document.getElementById('openSettingsBtn');
const empty        = document.getElementById('empty');
const errorMsg     = document.getElementById('error-msg');
const errorDetail  = document.getElementById('errorDetail');
const prList       = document.getElementById('pr-list');


// ── Utilities ─────────────────────────────────────────────────────────────────

function formatTimeAgo(ts) {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function prTitleText(rawTitle) {
  return rawTitle.replace(/\s*[·•]\s*Pull Request.*/i, '').trim();
}

function sendMsg(type, extra = {}) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type, ...extra }, res => resolve(res ?? {}));
  });
}

async function getGithubToken() {
  const { githubToken } = await chrome.storage.local.get('githubToken');
  if (githubToken) return githubToken;

  // One-time migration from legacy sync storage.
  const { githubToken: legacyToken } = await chrome.storage.sync.get('githubToken');
  if (!legacyToken) return null;

  await chrome.storage.local.set({ githubToken: legacyToken });
  await chrome.storage.sync.remove('githubToken');
  return legacyToken;
}

// ── Theme ─────────────────────────────────────────────────────────────────────

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

function updateThemeButtons(active) {
  for (const btn of document.querySelectorAll('.theme-btn')) {
    btn.classList.toggle('active', btn.dataset.theme === active);
  }
}

async function initTheme() {
  const { theme = 'system' } = await chrome.storage.sync.get('theme');
  applyTheme(theme);
  updateThemeButtons(theme);
}

document.getElementById('themePicker').addEventListener('click', async (e) => {
  const btn = e.target.closest('.theme-btn');
  if (!btn) return;
  const theme = btn.dataset.theme;
  await chrome.storage.sync.set({ theme });
  applyTheme(theme);
  updateThemeButtons(theme);
});

// ── Render helpers ────────────────────────────────────────────────────────────

function renderSyncBar(syncState, hasToken) {
  if (!hasToken || !syncState || syncState.status === 'no_token') {
    syncBar.classList.add('hidden');
    return;
  }

  syncBar.classList.remove('hidden');

  if (syncState.status === 'syncing') {
    syncStatus.className = 'sync-status';
    syncStatus.textContent = 'Syncing…';
    syncNowBtn.classList.add('spinning');
    return;
  }

  syncNowBtn.classList.remove('spinning');

  if (syncState.status === 'error') {
    syncStatus.className = 'sync-status error';
    syncStatus.textContent = `Error: ${syncState.error}`;
    return;
  }

  if (syncState.status === 'ok') {
    const ago = formatTimeAgo(syncState.lastSync);
    const n = syncState.total ?? 0;
    const orgs = syncState.ssoOrgs ?? [];
    if (orgs.length > 0) {
      syncStatus.className = 'sync-status sso-warning';
      const link = document.createElement('a');
      link.href = 'https://github.com/settings/tokens';
      link.target = '_blank';
      link.textContent = 'authorize token for SSO';
      syncStatus.textContent = '';
      syncStatus.append(
        document.createTextNode('⚠ Private repos excluded — '),
        link,
        document.createTextNode(` (${orgs.join(', ')})`),
      );
    } else {
      syncStatus.className = 'sync-status';
      syncStatus.textContent = `Synced ${ago} · ${n} PR${n !== 1 ? 's' : ''}`;
    }
  }
}

function showContent(key) {
  for (const el of [loading, setupEl, empty, errorMsg, prList]) {
    el.classList.add('hidden');
  }
  key.classList.remove('hidden');
}

function renderPRs(tabs) {
  prList.innerHTML = '';

  const countEl = document.createElement('div');
  countEl.className = 'pr-count';
  countEl.textContent = `${tabs.length} PR${tabs.length !== 1 ? 's' : ''} in queue`;
  prList.appendChild(countEl);

  for (const tab of tabs) {
    const li = document.createElement('li');
    li.className = 'pr-item';
    li.title = tab.title;

    const faviconWrapper = document.createElement('span');
    if (tab.favIconUrl) {
      const img = document.createElement('img');
      img.className = 'pr-favicon';
      img.src = tab.favIconUrl;
      img.onerror = () => img.replaceWith(makeFallbackIcon());
      faviconWrapper.appendChild(img);
    } else {
      faviconWrapper.appendChild(makeFallbackIcon());
    }

    const titleEl = document.createElement('span');
    titleEl.className = 'pr-title';
    titleEl.textContent = prTitleText(tab.title);

    const arrow = document.createElement('span');
    arrow.className = 'pr-arrow';
    arrow.innerHTML = `<svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor">
      <path d="M4 2l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/>
    </svg>`;

    li.appendChild(faviconWrapper);
    li.appendChild(titleEl);
    li.appendChild(arrow);

    li.addEventListener('click', () => {
      chrome.tabs.update(tab.id, { active: true });
      chrome.windows.update(tab.windowId ?? chrome.windows.WINDOW_ID_CURRENT, { focused: true });
      window.close();
    });

    prList.appendChild(li);
  }
}

function makeFallbackIcon() {
  const el = document.createElement('span');
  el.className = 'pr-favicon-fallback';
  el.innerHTML = `<svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
    <path d="M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM5 12.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM12.75 5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z"/>
    <path d="M4.25 5.25A.75.75 0 0 0 3.5 6v4a.75.75 0 0 0 1.5 0V6a.75.75 0 0 0-.75-.75ZM11.5 7.25a.75.75 0 0 0-.75.75v.5H8a.75.75 0 0 0 0 1.5h2.75v.5a.75.75 0 1 0 1.5 0v-2.5a.75.75 0 0 0-.75-.75Z"/>
  </svg>`;
  return el;
}

// ── Main state renderer ───────────────────────────────────────────────────────

async function refreshUI() {
  const { enabled = true } = await chrome.storage.sync.get('enabled');
  const githubToken = await getGithubToken();
  const { syncState } = await chrome.storage.local.get('syncState');

  toggle.checked = enabled;
  renderSyncBar(syncState, !!githubToken);

  if (!githubToken) {
    showContent(setupEl);
    return;
  }

  if (syncState?.status === 'error') {
    errorDetail.textContent = syncState.error ?? '';
    showContent(errorMsg);
    return;
  }

  const { tabs = [] } = await sendMsg('GET_STATUS');
  if (tabs.length === 0) {
    showContent(empty);
  } else {
    renderPRs(tabs);
    showContent(prList);
  }
}

// ── Settings panel ────────────────────────────────────────────────────────────

function toggleSettings(forceOpen) {
  const open = forceOpen ?? settingsPanel.classList.contains('hidden');
  settingsPanel.classList.toggle('hidden', !open);
  settingsBtn.classList.toggle('active', open);

  if (open) {
    getGithubToken().then(githubToken => {
      tokenInput.value = githubToken ? '••••••••••••••••' : '';
      tokenFeedback.textContent = '';
      tokenFeedback.className = 'token-feedback';
    });
    tokenInput.focus();
  }
}

settingsBtn.addEventListener('click', () => toggleSettings());
openSettingsBtn.addEventListener('click', () => toggleSettings(true));

saveTokenBtn.addEventListener('click', async () => {
  const raw = tokenInput.value.trim();
  if (!raw || raw.startsWith('•')) {
    tokenFeedback.textContent = 'Enter a new token to update.';
    tokenFeedback.className = 'token-feedback error';
    return;
  }

  saveTokenBtn.disabled = true;
  saveTokenBtn.textContent = 'Validating…';
  tokenFeedback.textContent = '';
  tokenFeedback.className = 'token-feedback';

  const result = await sendMsg('VALIDATE_TOKEN', { token: raw });

  if (!result.ok) {
    tokenFeedback.textContent = `Invalid token: ${result.error}`;
    tokenFeedback.className = 'token-feedback error';
    saveTokenBtn.disabled = false;
    saveTokenBtn.textContent = 'Save & Sync';
    return;
  }

  await chrome.storage.local.set({ githubToken: raw });

  if (result.scopeWarning) {
    tokenFeedback.textContent = `⚠ ${result.scopeWarning}`;
    tokenFeedback.className = 'token-feedback error';
  } else if (result.isFineGrained) {
    tokenFeedback.textContent = `Saved as @${result.login} — note: fine-grained tokens only access selected repos`;
    tokenFeedback.className = 'token-feedback';
  } else {
    tokenFeedback.textContent = `Saved as @${result.login}`;
    tokenFeedback.className = 'token-feedback';
  }

  saveTokenBtn.disabled = false;
  saveTokenBtn.textContent = 'Save & Sync';

  // Keep settings open briefly so user sees the feedback, then sync + close
  setTimeout(async () => {
    toggleSettings(false);
    await sendMsg('SYNC_NOW');
    await refreshUI();
  }, result.scopeWarning ? 2500 : 1200);
});

clearTokenBtn.addEventListener('click', async () => {
  await chrome.storage.local.remove('githubToken');
  await chrome.storage.local.set({ syncState: { status: 'no_token' } });
  tokenInput.value = '';
  tokenFeedback.textContent = 'Token removed.';
  tokenFeedback.className = 'token-feedback';
  toggleSettings(false);
  await refreshUI();
});

// ── Sync now button ───────────────────────────────────────────────────────────

syncNowBtn.addEventListener('click', async () => {
  syncNowBtn.classList.add('spinning');
  await sendMsg('SYNC_NOW');
  await refreshUI();
});

// ── Toggle switch ─────────────────────────────────────────────────────────────

toggle.addEventListener('change', async () => {
  const enabled = toggle.checked;
  await chrome.storage.sync.set({ enabled });
  await sendMsg('ENABLE_CHANGED', { enabled });
  await refreshUI();
});

// ── Live sync state updates (storage listener) ────────────────────────────────

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'local' && changes.syncState) {
    const githubToken = await getGithubToken();
    renderSyncBar(changes.syncState.newValue, !!githubToken);

    // When sync finishes, refresh the PR list
    if (changes.syncState.newValue?.status === 'ok') {
      await refreshUI();
    }
  }
});


// ── Init ──────────────────────────────────────────────────────────────────────

initTheme();
refreshUI();
