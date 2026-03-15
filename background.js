/* Bili Blocker - background service worker (MV3) */

const STORAGE_KEY = 'blockRules';

const DEFAULT_RULES = {
  enabled: true,
  blockAds: true,
  upNames: [],
  tags: [],
  titleKeywords: []
};

const MENU = {
  BLOCK_UP: 'bb_block_up',
  BLOCK_TITLE: 'bb_block_title',
  TOGGLE_ENABLED: 'bb_toggle_enabled',
  FORCE_RESCAN: 'bb_force_rescan'
};

async function getRules() {
  const data = await chrome.storage.sync.get([STORAGE_KEY]);
  const r = data?.[STORAGE_KEY];
  if (!r || typeof r !== 'object') return { ...DEFAULT_RULES };
  return { ...DEFAULT_RULES, ...r };
}

async function setRules(next) {
  await chrome.storage.sync.set({ [STORAGE_KEY]: next });
}

function uniqPush(list, item) {
  const v = (item ?? '').toString().trim();
  if (!v) return list;
  if (list.some((x) => (x ?? '').toString().trim() === v)) return list;
  return [...list, v];
}

async function ensureMenus() {
  try {
    await chrome.contextMenus.removeAll();
  } catch {
    // ignore
  }

  chrome.contextMenus.create({
    id: MENU.BLOCK_UP,
    title: 'Bili Blocker：屏蔽该 UP 主',
    contexts: ['page', 'link', 'image', 'video']
  });

  chrome.contextMenus.create({
    id: MENU.BLOCK_TITLE,
    title: 'Bili Blocker：屏蔽该标题（作为关键词）',
    contexts: ['page', 'link', 'image', 'video']
  });

  chrome.contextMenus.create({
    id: MENU.TOGGLE_ENABLED,
    title: 'Bili Blocker：启用/禁用',
    contexts: ['page']
  });

  chrome.contextMenus.create({
    id: MENU.FORCE_RESCAN,
    title: 'Bili Blocker：立即重新扫描本页',
    contexts: ['page']
  });
}

async function getActiveTabIdFromClick(tab) {
  if (tab?.id != null) return tab.id;
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs?.[0]?.id;
}

async function requestLastHoveredCard(tabId) {
  if (tabId == null) return null;

  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'BB_GET_LAST_HOVERED_CARD' });
    if (res?.ok) return res.card || null;
    return null;
  } catch {
    return null;
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureMenus();

  // 初始化默认规则（不覆盖已有）
  const data = await chrome.storage.sync.get([STORAGE_KEY]);
  if (!data?.[STORAGE_KEY]) {
    await chrome.storage.sync.set({ [STORAGE_KEY]: DEFAULT_RULES });
  }
});

chrome.runtime.onStartup?.addListener(async () => {
  await ensureMenus();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const tabId = await getActiveTabIdFromClick(tab);
  if (tabId == null) return;

  if (info.menuItemId === MENU.TOGGLE_ENABLED) {
    const r = await getRules();
    await setRules({ ...r, enabled: !r.enabled });
    return;
  }

  if (info.menuItemId === MENU.FORCE_RESCAN) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'BB_FORCE_RESCAN' });
    } catch {
      // ignore
    }
    return;
  }

  const card = await requestLastHoveredCard(tabId);
  if (!card) return;

  const r = await getRules();

  if (info.menuItemId === MENU.BLOCK_UP) {
    const upName = (card.upName || '').trim();
    if (!upName) return;
    await setRules({ ...r, upNames: uniqPush(r.upNames || [], upName) });
    return;
  }

  if (info.menuItemId === MENU.BLOCK_TITLE) {
    const title = (card.title || '').trim();
    if (!title) return;
    await setRules({ ...r, titleKeywords: uniqPush(r.titleKeywords || [], title) });
  }
});
