// Detects PR status and user relevance, then notifies the background worker.

const GROUP_TITLE = 'Pull Requests';

function getLoggedInUser() {
  return document.querySelector('meta[name="user-login"]')?.getAttribute('content') ?? null;
}

function getPRState() {
  // GitHub renders a state badge with classes like State--open, State--draft, State--merged, State--closed
  const badge =
    document.querySelector('.gh-header-meta .State') ||
    document.querySelector('.pull-header-showing .State') ||
    document.querySelector('[data-testid="state-badge"]') ||
    document.querySelector('[class*=" State State"]') ||
    document.querySelector('[class^="State State"]');

  if (!badge) return null;

  const classes = badge.className;
  if (classes.includes('State--draft') || badge.textContent.trim().toLowerCase() === 'draft') return 'draft';
  if (classes.includes('State--merged')) return 'merged';
  if (classes.includes('State--closed')) return 'closed';
  if (classes.includes('State--open')) return 'open';

  // Fallback: read text content
  const text = badge.textContent.trim().toLowerCase();
  if (['open', 'draft', 'merged', 'closed'].includes(text)) return text;

  return null;
}

function getPRAuthor() {
  // The PR author link in the header: "opened this pull request"
  const authorEl =
    document.querySelector('.gh-header-meta a.author') ||
    document.querySelector('[data-testid="pr-header-author"] a') ||
    document.querySelector('.timeline-comment-header a.author');

  return authorEl?.textContent?.trim() ?? null;
}

function getRequestedReviewers() {
  // Sidebar reviewers section — shows usernames of requested reviewers
  const logins = new Set();

  // Approach 1: reviewer list items (modern GitHub)
  document.querySelectorAll('[id^="reviewers-"] .AvatarStack, [data-testid="reviewers-section"] img[alt]').forEach(el => {
    const alt = el.getAttribute('alt');
    if (alt?.startsWith('@')) logins.add(alt.slice(1));
  });

  // Approach 2: anchor tags in the reviewers panel
  document.querySelectorAll('#reviewers-select-menu .select-menu-item-text a, .reviewer-avatar a, [aria-label^="Reviewers"] a').forEach(a => {
    const login = a.textContent.trim() || a.href?.split('/').pop();
    if (login) logins.add(login);
  });

  // Approach 3: assigned reviewer name spans in sidebar
  document.querySelectorAll('[data-testid="reviewer"] [data-login], [data-login]').forEach(el => {
    const login = el.getAttribute('data-login');
    if (login) logins.add(login);
  });

  // Approach 4: img alt tags in reviewer section
  document.querySelectorAll('.reviewer .avatar, #reviewers-select-menu img.avatar, .review-status-item img').forEach(img => {
    const alt = img.getAttribute('alt');
    if (alt?.startsWith('@')) logins.add(alt.slice(1));
  });

  return logins;
}

function isPRPage() {
  return /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/.test(window.location.href);
}

async function evaluate() {
  if (!isPRPage()) return;

  // Check if auto-grouping is enabled
  const { enabled = true } = await chrome.storage.sync.get('enabled');
  if (!enabled) return;

  const currentUser = getLoggedInUser();
  if (!currentUser) return; // Not logged in

  const state = getPRState();
  if (state !== 'open') {
    chrome.runtime.sendMessage({ type: 'REMOVE_FROM_GROUP' });
    return;
  }

  const author = getPRAuthor();
  const reviewers = getRequestedReviewers();

  const isRelevant = author === currentUser || reviewers.has(currentUser);

  if (isRelevant) {
    chrome.runtime.sendMessage({ type: 'ADD_TO_GROUP' });
  } else {
    chrome.runtime.sendMessage({ type: 'REMOVE_FROM_GROUP' });
  }
}

// Run on initial page load
evaluate();

// Re-run on GitHub's Turbo/Turbolinks SPA navigation
document.addEventListener('turbo:load', evaluate);
document.addEventListener('turbolinks:load', evaluate);

// Watch for in-page status changes (e.g., draft → ready for review button click)
const headerObserver = new MutationObserver(() => evaluate());
function attachObserver() {
  const header = document.querySelector('.gh-header-meta') || document.querySelector('[data-testid="pr-header"]');
  if (header) {
    headerObserver.observe(header, { childList: true, subtree: true, characterData: true });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', attachObserver);
} else {
  attachObserver();
}
