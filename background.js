/* Bili Blocker - background service worker (MV3) */

const STORAGE_KEY = 'blockRules';

/**
 * 通过 bvid 获取视频 cid
 * @param {string} bvid - 视频的bvid
 * @returns {Promise<{cid?: string, error?: string}>}
 */
async function fetchCidByBvid(bvid) {
  try {
    const url = `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    if (data.code !== 0) {
      throw new Error(`API error: ${data.message}`);
    }

    // 获取第一个分P的cid（默认）
    const cid = data.data?.cid;
    if (cid) {
      return { cid: String(cid) };
    }

    // 如果有多个分P，取第一个
    const pages = data.data?.pages;
    if (pages && pages.length > 0 && pages[0].cid) {
      return { cid: String(pages[0].cid) };
    }

    return { error: 'No cid found in response' };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * 获取原始弹幕 XML
 * @param {string} cid - 视频的cid
 * @returns {Promise<{xml?: string, error?: string}>}
 */
async function fetchDanmakuXmlRaw(cid) {
  // 尝试接口1: list.so
  try {
    const url1 = `https://api.bilibili.com/x/v1/dm/list.so?oid=${cid}`;
    const response1 = await fetch(url1, {
      headers: {
        'Accept': '*/*',
        'Referer': 'https://www.bilibili.com'
      }
    });
    if (response1.ok) {
      const text = await response1.text();
      if (text.includes('<d ')) {
        return { xml: text };
      }
    }
  } catch {
    // ignore
  }

  // 尝试接口2: comment.bilibili.com
  try {
    const url2 = `https://comment.bilibili.com/${cid}.xml`;
    const response2 = await fetch(url2, {
      headers: {
        'Accept': 'application/xml, text/xml, */*',
        'Referer': 'https://www.bilibili.com'
      }
    });
    if (response2.ok) {
      const text = await response2.text();
      if (text.includes('<d ')) {
        return { xml: text };
      }
    }
  } catch {
    // ignore
  }

  return { error: 'Failed to fetch danmaku from all sources' };
}

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

// 监听来自 content script 的消息
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return false;

  if (msg.type === 'BB_FETCH_DANMAKU' && msg.cid) {
    // 返回原始 XML，让 content script 解析（Service Worker 没有 DOMParser）
    fetchDanmakuXmlRaw(msg.cid).then((result) => {
      sendResponse({ ok: !result.error, xml: result.xml, error: result.error });
    });
    return true; // 保持通道开放，等待异步响应
  }

  if (msg.type === 'BB_FETCH_CID_BY_BVID' && msg.bvid) {
    fetchCidByBvid(msg.bvid).then((result) => {
      sendResponse({ ok: !result.error, cid: result.cid, error: result.error });
    });
    return true;
  }

  return false;
});

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
