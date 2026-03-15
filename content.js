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
  if (!rules.enabled) return null;

  if (rules.blockAds && isAdCard(cardEl)) return '广告/推广';

  const upName = normalizeText(cardInfo?.upName);
  if (upName && (rules.upNames || []).some((u) => normalizeText(u) === upName)) {
    return `UP主: ${upName}`;
  }

  const title = normalizeText(cardInfo?.title);
  if (title) {
    const matchedKw = (rules.titleKeywords || []).find((kw) => {
      const k = normalizeText(kw).toLowerCase();
      return k && title.toLowerCase().includes(k);
    });
    if (matchedKw) return `标题关键词: ${matchedKw}`;
  }

  const tagsText = (cardInfo?.tags || []).join(' ');
  if (tagsText) {
    const matchedTag = (rules.tags || []).find((tag) => {
      const t = normalizeText(tag).toLowerCase();
      return t && tagsText.toLowerCase().includes(t);
    });
    if (matchedTag) return `Tag: ${matchedTag}`;
  }

  return null;
}

function removeCard(cardEl, reason, cardInfo) {
  try {
    console.log(
      `%c[Bili Blocker] 已屏蔽`,
      'color: #fb7299; font-weight: bold;',
      `\n  📋 依据: ${reason}`,
      `\n  🎬 标题: ${cardInfo?.title || '(未知)'}`,
      `\n  👤 UP主: ${cardInfo?.upName || '(未知)'}`
    );

    // 找到 grid item: .bili-feed-card 或 .feed-card
    const gridItem = cardEl.closest('.bili-feed-card') || cardEl.closest('.feed-card');
    const target = gridItem || cardEl;

    // 直接移除整个 grid item，不留白框
    target.remove();

    blockedCount += 1;
  } catch {
    // ignore
  }
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
    const reason = shouldBlock(info, cardEl);
    if (reason) {
      removeCard(cardEl, reason, info);
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
          const reason = shouldBlock(info, card);
          if (reason) {
            removeCard(card, reason, info);
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

// ==================== 播放页弹幕获取功能 ====================

let danmakuFetched = false; // 防止重复获取

/**
 * 检查当前是否是播放页
 */
function isPlayPage() {
  const pathname = location.pathname;
  return pathname.includes('/video/') || pathname.includes('/v/');
}

/**
 * 从页面提取 cid
 * 尝试多种方法获取 cid
 */
function extractCidFromPage() {
  // 方法1: 从 window.__INITIAL_STATE__ 获取
  try {
    const initialState = window.__INITIAL_STATE__;
    if (initialState) {
      // 普通视频页
      if (initialState.videoData?.cid) {
        return String(initialState.videoData.cid);
      }
      // 有些页面结构不同
      if (initialState.cid) {
        return String(initialState.cid);
      }
      // 尝试从 epList 或 pages 中获取
      if (initialState.epInfo?.cid) {
        return String(initialState.epInfo.cid);
      }
      // 从视频列表中获取当前 cid
      if (initialState.videoData?.pages?.length > 0) {
        const p = parseInt(new URLSearchParams(location.search).get('p')) || 1;
        const page = initialState.videoData.pages[p - 1];
        if (page?.cid) {
          return String(page.cid);
        }
      }
    }
  } catch {
    // ignore
  }

  // 方法2: 从 window.__playinfo__ 获取
  try {
    const playinfo = window.__playinfo__;
    if (playinfo?.data?.cid) {
      return String(playinfo.data.cid);
    }
    if (playinfo?.result?.cid) {
      return String(playinfo.result.cid);
    }
  } catch {
    // ignore
  }

  // 方法3: 从 video 元素的 data 属性或 src 获取
  try {
    const video = document.querySelector('video');
    if (video) {
      const dataCid = video.getAttribute('data-cid') || video.dataset.cid;
      if (dataCid) return String(dataCid);

      // 从 src 中提取 cid
      const src = video.src || '';
      const cidMatch = src.match(/[?&]cid=(\d+)/);
      if (cidMatch) return cidMatch[1];
    }
  } catch {
    // ignore
  }

  // 方法4: 从页面 script 标签中查找 JSON 数据
  const scripts = document.querySelectorAll('script:not([src])');
  for (const script of scripts) {
    const text = script.textContent || '';

    // 匹配 "cid":123456 或 "cid": 123456
    const cidMatch = text.match(/"cid"\s*:\s*(\d{4,})/);
    if (cidMatch) {
      return cidMatch[1];
    }

    // 匹配 __INITIAL_STATE__ = {...} 并尝试解析
    const stateMatch = text.match(/window\.__INITIAL_STATE__\s*=\s*({.+?});/);
    if (stateMatch) {
      try {
        const state = JSON.parse(stateMatch[1]);
        if (state.videoData?.cid) {
          return String(state.videoData.cid);
        }
        if (state.cid) {
          return String(state.cid);
        }
      } catch {
        // ignore parse error
      }
    }

    // 匹配 __playinfo__ = {...}
    const playinfoMatch = text.match(/window\.__playinfo__\s*=\s*({.+?});/);
    if (playinfoMatch) {
      try {
        const info = JSON.parse(playinfoMatch[1]);
        if (info.data?.cid) {
          return String(info.data.cid);
        }
        if (info.result?.cid) {
          return String(info.result.cid);
        }
      } catch {
        // ignore parse error
      }
    }
  }

  // 方法5: 从 URL 参数获取（某些页面）
  const urlParams = new URLSearchParams(location.search);
  const cidFromUrl = urlParams.get('cid');
  if (cidFromUrl) {
    return cidFromUrl;
  }

  // 方法6: 从播放器容器的数据属性获取
  try {
    const player = document.querySelector('#bilibili-player, .bilibili-player, #player, .bpx-player-container');
    if (player) {
      const dataCid = player.getAttribute('data-cid') || player.dataset.cid;
      if (dataCid) return String(dataCid);
    }
  } catch {
    // ignore
  }

  return null;
}

/**
 * 打印弹幕统计信息到控制台
 */
function logDanmakuStats(data) {
  console.log(
    `%c[Bili Blocker] 弹幕统计`,
    'color: #fb7299; font-weight: bold; font-size: 14px;'
  );

  if (data.error) {
    console.log(`  ⚠️ 错误: ${data.error}`);
  }

  console.log(`  📊 总条数: ${data.count}`);
  console.log(`  📝 文本总长度: ${data.totalLength} 字符`);

  if (data.count === 0) {
    console.log('  💡 提示: 该视频可能没有弹幕，或弹幕接口返回为空');
    return;
  }

  if (data.first10 && data.first10.length > 0) {
    console.log(`  ⏱️ 前 10 条（按时间）:`);
    data.first10.forEach((d, i) => {
      const timeStr = formatTime(d.time);
      console.log(`    ${i + 1}. [${timeStr}] ${d.content}`);
    });
  }

  if (data.last10 && data.last10.length > 0) {
    console.log(`  ⏱️ 后 10 条（按时间）:`);
    data.last10.forEach((d, i) => {
      const timeStr = formatTime(d.time);
      const idx = data.count - data.last10.length + i + 1;
      console.log(`    ${idx}. [${timeStr}] ${d.content}`);
    });
  }
}

/**
 * 将秒数格式化为 MM:SS
 */
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * 解析弹幕 XML
 */
function parseDanmakuXml(xmlText) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

  // 检查是否是错误响应
  const parserError = xmlDoc.querySelector('parsererror');
  if (parserError) {
    throw new Error('XML parse error');
  }

  // 解析所有弹幕节点
  const danmakuNodes = xmlDoc.querySelectorAll('d');
  const danmakuList = [];

  for (const node of danmakuNodes) {
    const pAttr = node.getAttribute('p');
    const content = node.textContent || '';
    if (!pAttr) continue;

    // p属性格式: "时间,类型,大小,颜色,时间戳,弹幕池,用户哈希,弹幕ID"
    const parts = pAttr.split(',');
    const timeSeconds = parseFloat(parts[0]) || 0;

    danmakuList.push({
      time: timeSeconds,
      content: content,
      type: parseInt(parts[1]) || 0,
      size: parseInt(parts[2]) || 0,
      color: parseInt(parts[3]) || 0
    });
  }

  return danmakuList;
}

/**
 * 请求 background 获取弹幕列表
 */
async function fetchDanmakuFromBackground(cid) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'BB_FETCH_DANMAKU',
      cid: cid
    });

    if (response?.ok && response.xml) {
      // 在 content script 中解析 XML（有 DOM 环境）
      const danmakuList = parseDanmakuXml(response.xml);

      // 按时间排序
      danmakuList.sort((a, b) => a.time - b.time);

      const data = {
        count: danmakuList.length,
        totalLength: danmakuList.reduce((sum, d) => sum + d.content.length, 0),
        first10: danmakuList.slice(0, 10).map(d => ({
          time: d.time,
          content: d.content
        })),
        last10: danmakuList.slice(-10).map(d => ({
          time: d.time,
          content: d.content
        }))
      };

      logDanmakuStats(data);
    } else {
      console.error('[Bili Blocker] 获取弹幕失败:', response?.error || '未知错误');
      logDanmakuStats({ count: 0, totalLength: 0, first10: [], last10: [], error: response?.error });
    }
  } catch (error) {
    console.error('[Bili Blocker] 请求弹幕出错:', error);
    logDanmakuStats({ count: 0, totalLength: 0, first10: [], last10: [], error: error.message });
  }
}

/**
 * 从 URL 提取 bvid
 */
function extractBvidFromUrl() {
  const match = location.pathname.match(/(BV[\w]+)/);
  return match ? match[1] : null;
}

/**
 * 调试日志：输出可用的全局数据
 */
function logDebugInfo() {
  console.log('[Bili Blocker] 调试信息:');
  console.log('  __INITIAL_STATE__:', window.__INITIAL_STATE__ ? '存在' : '不存在');
  console.log('  __playinfo__:', window.__playinfo__ ? '存在' : '不存在');
  console.log('  URL:', location.href);
  console.log('  BV号:', extractBvidFromUrl() || '未找到');

  if (window.__INITIAL_STATE__) {
    const state = window.__INITIAL_STATE__;
    console.log('  videoData?.cid:', state.videoData?.cid);
    console.log('  cid:', state.cid);
    console.log('  epInfo?.cid:', state.epInfo?.cid);
  }
}

/**
 * 通过 bvid 从 background 获取 cid
 */
async function fetchCidByBvidFromBackground(bvid) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'BB_FETCH_CID_BY_BVID',
      bvid: bvid
    });
    return response?.ok ? response.cid : null;
  } catch (error) {
    console.error('[Bili Blocker] 通过 bvid 获取 cid 出错:', error);
    return null;
  }
}

/**
 * 初始化播放页弹幕获取
 */
function initPlayPageDanmaku() {
  if (!isPlayPage() || danmakuFetched) return;

  // 延迟执行，等待页面数据加载
  setTimeout(async () => {
    let cid = extractCidFromPage();

    // 如果页面提取失败，尝试通过 bvid API 获取
    if (!cid) {
      const bvid = extractBvidFromUrl();
      if (bvid) {
        console.log(`[Bili Blocker] 页面未找到 cid，尝试通过 API 获取 (bvid: ${bvid})`);
        cid = await fetchCidByBvidFromBackground(bvid);
      }
    }

    if (cid) {
      console.log(`[Bili Blocker] 检测到播放页，开始获取弹幕 (cid: ${cid})`);
      danmakuFetched = true;
      fetchDanmakuFromBackground(cid);
    } else {
      // 输出调试信息帮助排查
      logDebugInfo();
      console.log('[Bili Blocker] 未能提取到 cid，跳过弹幕获取');
      console.log('[Bili Blocker] 提示: 刷新页面后若仍无法获取，请检查控制台输出的调试信息');
    }
  }, 2000); // 等待 2 秒确保页面数据已加载
}

/**
 * 监听 SPA 路由变化，重新检测播放页
 */
function setupRouteChangeListener() {
  let lastUrl = location.href;

  const observer = new MutationObserver(() => {
    const currentUrl = location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      danmakuFetched = false; // 重置标记，允许新页面获取弹幕
      initPlayPageDanmaku();
    }
  });

  observer.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true
  });

  // 同时监听 popstate 事件
  window.addEventListener('popstate', () => {
    danmakuFetched = false;
    initPlayPageDanmaku();
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

  // 播放页弹幕获取功能
  initPlayPageDanmaku();
  setupRouteChangeListener();
})();
