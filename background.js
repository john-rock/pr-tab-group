// Service worker: manages the "Pull Requests" tab group.
// Auto-syncs PRs where the user is author or requested reviewer every 15 minutes.

const GROUP_TITLE = 'Pull Requests';
const GROUP_COLOR = 'green';
const PR_URL_PATTERN = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/;
const ALARM_NAME = 'pr-sync';
const SYNC_INTERVAL_MINUTES = 15;

// Map of windowId → groupId
const windowGroups = new Map();

async function getGithubToken() {
  const { githubToken } = await chrome.storage.local.get('githubToken');
  if (githubToken) return githubToken;

  // One-time migration from insecure sync storage used by older versions.
  const { githubToken: legacyToken } = await chrome.storage.sync.get('githubToken');
  if (!legacyToken) return null;

  await chrome.storage.local.set({ githubToken: legacyToken });
  await chrome.storage.sync.remove('githubToken');
  return legacyToken;
}

function isPRUrl(url) {
  return url ? PR_URL_PATTERN.test(url) : false;
}

function normalizeUrl(url) {
  if (!url) return '';
  // Collapse github.com/org/repo/pull/123/files → github.com/org/repo/pull/123
  const prBase = url.match(/^(https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+)/);
  if (prBase) return prBase[1];
  return url.replace(/[?#].*$/, '').replace(/\/$/, '');
}

// ── Tab group management ──────────────────────────────────────────────────────

async function getValidGroupId(windowId) {
  const stored = windowGroups.get(windowId);
  if (stored != null) {
    try {
      await chrome.tabGroups.get(stored);
      return stored;
    } catch {
      windowGroups.delete(windowId);
    }
  }

  const groups = await chrome.tabGroups.query({ windowId, title: GROUP_TITLE });
  if (groups.length > 0) {
    windowGroups.set(windowId, groups[0].id);
    return groups[0].id;
  }

  return null;
}

async function addTabToGroup(tabId, windowId) {
  const existingGroupId = await getValidGroupId(windowId);

  if (existingGroupId != null) {
    await chrome.tabs.group({ groupId: existingGroupId, tabIds: [tabId] });
  } else {
    const groupId = await chrome.tabs.group({ tabIds: [tabId] });
    await chrome.tabGroups.update(groupId, { title: GROUP_TITLE, color: GROUP_COLOR });
    windowGroups.set(windowId, groupId);
  }

  await persistGroups();
}

async function removeTabFromGroup(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const groupId = windowGroups.get(tab.windowId);
    if (groupId != null && tab.groupId === groupId) {
      await chrome.tabs.ungroup([tabId]);
      await checkAndCleanGroup(tab.windowId, groupId);
    }
  } catch {
    // Tab may already be closed or ungrouped
  }
}

async function ungroupPRTabs() {
  for (const [, groupId] of windowGroups) {
    try {
      const tabs = await chrome.tabs.query({ groupId });
      if (tabs.length > 0) {
        await chrome.tabs.ungroup(tabs.map(t => t.id));
      }
    } catch {
      // Group may no longer exist
    }
  }
  windowGroups.clear();
  await persistGroups();
}

async function checkAndCleanGroup(windowId, groupId) {
  try {
    const remainingTabs = await chrome.tabs.query({ groupId });
    if (remainingTabs.length === 0) {
      windowGroups.delete(windowId);
      await persistGroups();
    }
  } catch {
    windowGroups.delete(windowId);
    await persistGroups();
  }
}

async function persistGroups() {
  const obj = {};
  for (const [winId, grpId] of windowGroups) obj[winId] = grpId;
  await chrome.storage.session.set({ windowGroups: obj });
}

async function restoreGroups() {
  const { windowGroups: stored } = await chrome.storage.session.get('windowGroups');
  if (stored) {
    for (const [winId, grpId] of Object.entries(stored)) {
      windowGroups.set(Number(winId), grpId);
    }
  }
}

restoreGroups();

// ── GitHub API sync ───────────────────────────────────────────────────────────

async function validateToken(token) {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `HTTP ${res.status}`);
  }

  const user = await res.json();
  const scopeHeader = res.headers.get('X-OAuth-Scopes') ?? '';
  const scopes = scopeHeader.split(',').map(s => s.trim()).filter(Boolean);
  // Fine-grained PATs don't send X-OAuth-Scopes at all
  const isFineGrained = scopes.length === 0;
  const hasRepo = scopes.includes('repo');

  return {
    login: user.login,
    hasRepo,
    isFineGrained,
    // Classic PAT without repo scope means private repos are invisible
    scopeWarning: (!isFineGrained && !hasRepo)
      ? 'Token is missing repo scope — private repos will not be included'
      : null,
  };
}

async function fetchMyPRs(token) {
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const queries = [
    `is:open is:pr author:@me archived:false created:>${since}`,
    `is:open is:pr review-requested:@me archived:false created:>${since}`,
  ];

  const results = new Map();
  const ssoOrgs = new Set();

  for (const q of queries) {
    const res = await fetch(
      `https://api.github.com/search/issues?q=${encodeURIComponent(q)}&per_page=50&sort=updated`,
      { headers }
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || `HTTP ${res.status}`);
    }

    // GitHub includes this header when private org repos are filtered out
    // because the token hasn't been SSO-authorized for that org.
    // e.g. "partial; organizations=myorg,acme"
    const ssoHeader = res.headers.get('X-GitHub-SSO') ?? '';
    const ssoMatch = ssoHeader.match(/organizations=([^\s;]+)/);
    if (ssoMatch) ssoMatch[1].split(',').forEach(o => ssoOrgs.add(o.trim()));

    const data = await res.json();
    for (const item of data.items) results.set(item.html_url, item);
  }

  return { prs: [...results.values()], ssoOrgs: [...ssoOrgs] };
}

async function syncPRTabs() {
  const githubToken = await getGithubToken();
  if (!githubToken) {
    await chrome.storage.local.set({ syncState: { status: 'no_token' } });
    return;
  }

  await chrome.storage.local.set({ syncState: { status: 'syncing' } });

  try {
    const { prs, ssoOrgs } = await fetchMyPRs(githubToken);
    const { enabled = true } = await chrome.storage.sync.get('enabled');

    const existingTabs = await chrome.tabs.query({ url: 'https://github.com/*/pull/*' });
    const existingByUrl = new Map(existingTabs.map(t => [normalizeUrl(t.url), t]));

    // Close grouped tabs whose PRs are no longer open (merged / closed)
    const openUrls = new Set(prs.map(pr => normalizeUrl(pr.html_url)));
    for (const [, groupId] of windowGroups) {
      try {
        const groupedTabs = await chrome.tabs.query({ groupId });
        for (const tab of groupedTabs) {
          if (isPRUrl(tab.url) && !openUrls.has(normalizeUrl(tab.url))) {
            await chrome.tabs.remove(tab.id);
          }
        }
      } catch {
        // Group may no longer exist
      }
    }

    let opened = 0;
    for (const pr of prs) {
      const key = normalizeUrl(pr.html_url);
      const existing = existingByUrl.get(key);

      if (existing) {
        // Tab already open — group it if it isn't already
        if (enabled && existing.groupId < 0) {
          await addTabToGroup(existing.id, existing.windowId);
        }
      } else {
        const tab = await chrome.tabs.create({ url: pr.html_url, active: false });
        if (enabled) await addTabToGroup(tab.id, tab.windowId);
        opened++;
      }
    }

    await chrome.storage.local.set({
      lastPRs: prs.map(pr => ({ url: normalizeUrl(pr.html_url), title: pr.title })),
      syncState: {
        status: 'ok',
        lastSync: Date.now(),
        total: prs.length,
        opened,
        ssoOrgs, // non-empty means private org repos were silently excluded
      },
    });
  } catch (err) {
    await chrome.storage.local.set({
      syncState: { status: 'error', error: err.message, lastSync: Date.now() },
    });
  }
}

// ── Startup / alarm ───────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: SYNC_INTERVAL_MINUTES });
  await groupExistingPRTabs();
  await syncPRTabs();
});

chrome.runtime.onStartup.addListener(async () => {
  const alarm = await chrome.alarms.get(ALARM_NAME);
  if (!alarm) chrome.alarms.create(ALARM_NAME, { periodInMinutes: SYNC_INTERVAL_MINUTES });
  await groupExistingPRTabs();
  await syncPRTabs();
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM_NAME) syncPRTabs();
});

// ── React to tab URL changes ──────────────────────────────────────────────────

async function handleTabUrl(tabId, url, windowId) {
  const { enabled = true } = await chrome.storage.sync.get('enabled');
  if (!enabled) return;

  if (isPRUrl(url)) {
    await addTabToGroup(tabId, windowId);
  } else {
    await removeTabFromGroup(tabId);
  }
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url) return;
  await handleTabUrl(tabId, changeInfo.url, tab.windowId);
});

async function groupExistingPRTabs() {
  const { enabled = true } = await chrome.storage.sync.get('enabled');
  if (!enabled) return;

  const tabs = await chrome.tabs.query({ url: 'https://github.com/*/pull/*' });
  for (const tab of tabs) await addTabToGroup(tab.id, tab.windowId);
}

// ── Message handler ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_STATUS') {
    getStatus()
      .then(status => sendResponse(status))
      .catch(() => sendResponse({ tabs: [], groupCount: 0 }));
    return true;
  }

  if (message.type === 'ENABLE_CHANGED') {
    if (message.enabled) {
      groupExistingPRTabs()
        .then(() => sendResponse({ success: true }))
        .catch(() => sendResponse({ success: false }));
    } else {
      ungroupPRTabs()
        .then(() => sendResponse({ success: true }))
        .catch(() => sendResponse({ success: false }));
    }
    return true;
  }

  if (message.type === 'VALIDATE_TOKEN') {
    validateToken(message.token)
      .then(result => sendResponse({ ok: true, ...result }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'SYNC_NOW') {
    syncPRTabs()
      .then(() => sendResponse({ success: true }))
      .catch(() => sendResponse({ success: false }));
    return true;
  }

  return false;
});

async function getStatus() {
  const { lastPRs = [] } = await chrome.storage.local.get('lastPRs');
  const openTabs = await chrome.tabs.query({ url: 'https://github.com/*/pull/*' });
  const tabByUrl = new Map(openTabs.map(t => [normalizeUrl(t.url), t]));

  const tabs = lastPRs.map(pr => {
    const tab = tabByUrl.get(pr.url);
    return {
      title: pr.title,
      url: pr.url,
      favIconUrl: tab?.favIconUrl ?? null,
      id: tab?.id ?? null,
      windowId: tab?.windowId ?? null,
    };
  });

  return { tabs, groupCount: windowGroups.size };
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

chrome.tabGroups.onRemoved.addListener(async (group) => {
  for (const [winId, grpId] of windowGroups) {
    if (grpId === group.id) {
      windowGroups.delete(winId);
      await persistGroups();
      break;
    }
  }
});

chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  const { windowId, isWindowClosing } = removeInfo;
  if (isWindowClosing) {
    windowGroups.delete(windowId);
    await persistGroups();
    return;
  }
  const groupId = windowGroups.get(windowId);
  if (groupId != null) await checkAndCleanGroup(windowId, groupId);
});
