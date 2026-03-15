/* Bili Blocker - content script (MV3)
 * - 监听 DOM 动态变化，匹配规则并移除视频卡片
 * - 提供 lastHoveredCard 信息供右键菜单使用
 */

const STORAGE_KEY = 'blockRules';

const DEFAULT_RULES = {
  enabled: true,
  blockAds: true,
  upNames: [],
  tags: [],
  titleKeywords: []
};

/** @type {typeof DEFAULT_RULES} */
let rules = { ...DEFAULT_RULES };
let blockedCount = 0;

/** @type {{upName?: string, title?: string, tags?: string[], url?: string} | null} */
let lastHoveredCard = null;

function normalizeText(s) {
  return (s ?? '').toString().replace(/\s+/g, ' ').trim();
}

function includesAnyKeyword(haystack, keywords) {
  const h = normalizeText(haystack).toLowerCase();
  if (!h) return false;
  return (keywords || []).some((kw) => {
    const k = normalizeText(kw).toLowerCase();
    return k && h.includes(k);
  });
}

function isAdCard(cardEl) {
  if (!cardEl) return false;

  // 1. 明确的广告 class / 属性
  const adSelectors = [
    '[data-type="ad"]',
    '.bili-video-card__mark--ad',
    '.video-card-ad',
    '.bili-ad',
    '.ad-mark',
    '.advertising'
  ];

  for (const sel of adSelectors) {
    try {
      if (cardEl.matches(sel) || cardEl.querySelector(sel)) return true;
    } catch {
      // ignore invalid selectors
    }
  }

  // 2. 链接指向广告追踪域名 cm.bilibili.com
  const adLink = cardEl.querySelector('a[href*="cm.bilibili.com"]');
  if (adLink) return true;

  // 3. 有 data-target-url 属性（广告跳转目标）
  const targetUrl = cardEl.querySelector('[data-target-url]');
  if (targetUrl) return true;

  // 4. stats 区域明确显示"广告"文字
  const statsText = cardEl.querySelector('.bili-video-card__stats--text');
  if (statsText && normalizeText(statsText.textContent) === '广告') return true;

  // 5. owner 区域有 disable-hover 类（广告卡片特有）
  const ownerDisable = cardEl.querySelector('.bili-video-card__info--owner.disable-hover');
  if (ownerDisable) return true;

  return false;
}

function extractCardInfo(cardEl) {
  if (!cardEl) return null;

  // title
  const titleCandidates = [
    '[data-title]',
    'a[title]',
    '.bili-video-card__info--tit a',
    '.bili-video-card__info--tit',
    '.bili-video-card__info--title a',
    '.bili-video-card__info--title',
    '.title',
    '.video-name'
  ];
  let title = '';
  for (const sel of titleCandidates) {
    const el = cardEl.querySelector(sel);
    if (!el) continue;
    title = normalizeText(el.getAttribute('data-title') || el.getAttribute('title') || el.textContent);
    if (title) break;
  }

  // upName
  const upCandidates = [
    '.bili-video-card__info--author',
    '.bili-video-card__info--author a',
    '.up-name',
    '.upname',
    '.author',
    '.bili-video-card__info--owner',
    '.bili-video-card__info--owner a',
    'a[href*="space.bilibili.com"]'
  ];
  let upName = '';
  for (const sel of upCandidates) {
    const el = cardEl.querySelector(sel);
    if (!el) continue;
    upName = normalizeText(el.getAttribute('title') || el.textContent);
    if (upName) break;
  }

  // tags: 只取卡片内能抓到的 tag/话题链接
  const tags = Array.from(cardEl.querySelectorAll('a[href*="/tag/"], a[href*="/topic/"], .tag, .tags .tag'))
    .map((el) => normalizeText(el.textContent))
    .filter(Boolean)
    .slice(0, 12);

  // url
  let url = '';
  const link = cardEl.querySelector('a[href*="/video/"], a[href*="/v/"], a[href*="/bvid"], a[href]');
  if (link) {
    try {
      url = new URL(link.getAttribute('href'), location.href).toString();
    } catch {
      url = link.getAttribute('href') || '';
    }
  }

  return {
    title,
    upName,
    tags,
    url
  };
}

function shouldBlock(cardInfo, cardEl) {
  if (!rules.enabled) return false;

  if (rules.blockAds && isAdCard(cardEl)) return true;

  const upName = normalizeText(cardInfo?.upName);
  if (upName && (rules.upNames || []).some((u) => normalizeText(u) === upName)) return true;

  const title = normalizeText(cardInfo?.title);
  if (title && includesAnyKeyword(title, rules.titleKeywords)) return true;

  const tagsText = (cardInfo?.tags || []).join(' ');
  if (tagsText && includesAnyKeyword(tagsText, rules.tags)) return true;

  return false;
}

function findCardRootFromNode(node) {
  if (!(node instanceof Element)) return null;

  const cardSelectors = [
    '.bili-video-card',
    '.feed-card',
    '.video-card',
    '.bili-video-card__wrap',
    '.bili-video-card__info',
    'li.video-item',
    'div.video-item'
  ];

  for (const sel of cardSelectors) {
    if (node.matches(sel)) return node;
    const closest = node.closest(sel);
    if (closest) return closest;
  }

  return null;
}

function removeCard(cardEl) {
  try {
    cardEl.remove();
    blockedCount += 1;
  } catch {
    // ignore
  }
}

function scanAndBlockWithin(root) {
  if (!rules.enabled) return;

  const candidates = root.querySelectorAll(
    [
      '.bili-video-card',
      '.feed-card',
      '.video-card',
      'li.video-item',
      'div.video-item'
    ].join(',')
  );

  for (const cardEl of candidates) {
    const info = extractCardInfo(cardEl);
    if (shouldBlock(info, cardEl)) {
      removeCard(cardEl);
    }
  }
}

async function loadRules() {
  const data = await chrome.storage.sync.get([STORAGE_KEY]);
  const r = data?.[STORAGE_KEY];
  if (!r || typeof r !== 'object') {
    await chrome.storage.sync.set({ [STORAGE_KEY]: DEFAULT_RULES });
    rules = { ...DEFAULT_RULES };
    return;
  }
  rules = { ...DEFAULT_RULES, ...r };
}

function setupStorageListener() {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') return;
    if (!changes[STORAGE_KEY]) return;

    const next = changes[STORAGE_KEY].newValue;
    rules = { ...DEFAULT_RULES, ...(next || {}) };

    // 规则变化后，做一次全量扫描（轻量兜底）
    try {
      scanAndBlockWithin(document);
    } catch {
      // ignore
    }
  });
}

function setupHoverTracker() {
  // 用 mouseover 捕获"当前指向的视频卡片"，供右键菜单使用
  document.addEventListener(
    'mouseover',
    (e) => {
      const card = findCardRootFromNode(e.target);
      if (!card) return;
      const info = extractCardInfo(card);
      if (!info) return;

      // 只在能提取到关键字段时更新
      if (info.upName || info.title) {
        lastHoveredCard = info;
      }
    },
    { capture: true, passive: true }
  );
}

function setupMessageHandler() {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'BB_GET_LAST_HOVERED_CARD') {
      sendResponse({ ok: true, card: lastHoveredCard });
      return true;
    }

    if (msg.type === 'BB_GET_BLOCKED_COUNT') {
      sendResponse({ ok: true, blockedCount });
      return true;
    }

    if (msg.type === 'BB_FORCE_RESCAN') {
      try {
        scanAndBlockWithin(document);
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
      return true;
    }

    return;
  });
}

function setupObserver() {
  const observer = new MutationObserver((mutations) => {
    if (!rules.enabled) return;

    for (const m of mutations) {
      for (const n of m.addedNodes) {
        const card = findCardRootFromNode(n);
        if (card) {
          const info = extractCardInfo(card);
          if (shouldBlock(info, card)) {
            removeCard(card);
            continue;
          }
        }

        // 有时候新增的是容器而不是卡片本身
        if (n instanceof Element) {
          scanAndBlockWithin(n);
        }
      }
    }
  });

  observer.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true
  });
}

(async function main() {
  try {
    await loadRules();
  } catch {
    rules = { ...DEFAULT_RULES };
  }

  setupStorageListener();
  setupHoverTracker();
  setupMessageHandler();

  // 初始扫描
  try {
    scanAndBlockWithin(document);
  } catch {
    // ignore
  }

  setupObserver();
})();
