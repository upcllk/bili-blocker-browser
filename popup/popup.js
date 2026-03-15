/* Popup logic for Bili Blocker */

const STORAGE_KEY = 'blockRules';

const DEFAULT_RULES = {
  enabled: true,
  blockAds: true,
  upNames: [],
  tags: [],
  titleKeywords: []
};

function $(id) {
  return document.getElementById(id);
}

function normalizeText(s) {
  return (s ?? '').toString().replace(/\s+/g, ' ').trim();
}

function uniqPush(list, item) {
  const v = normalizeText(item);
  if (!v) return list;
  if (list.some((x) => normalizeText(x) === v)) return list;
  return [...list, v];
}

function removeOne(list, item) {
  const v = normalizeText(item);
  return (list || []).filter((x) => normalizeText(x) !== v);
}

async function getRules() {
  const data = await chrome.storage.sync.get([STORAGE_KEY]);
  const r = data?.[STORAGE_KEY];
  if (!r || typeof r !== 'object') return { ...DEFAULT_RULES };
  return { ...DEFAULT_RULES, ...r };
}

async function setRules(next) {
  await chrome.storage.sync.set({ [STORAGE_KEY]: next });
}

function renderRuleList(container, list, onDelete) {
  container.innerHTML = '';
  if (!list || list.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'card-desc';
    empty.style.padding = '0 12px 12px';
    empty.textContent = '暂无规则';
    container.appendChild(empty);
    return;
  }

  for (const item of list) {
    const row = document.createElement('div');
    row.className = 'rule-item';

    const text = document.createElement('div');
    text.className = 'rule-text';
    text.title = item;
    text.textContent = item;

    const del = document.createElement('button');
    del.className = 'icon-btn';
    del.textContent = '×';
    del.title = '删除';
    del.addEventListener('click', () => onDelete(item));

    row.appendChild(text);
    row.appendChild(del);
    container.appendChild(row);
  }
}

function renderChipList(container, list, onDelete) {
  container.innerHTML = '';
  if (!list || list.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'card-desc';
    empty.style.padding = '0 12px 12px';
    empty.textContent = '暂无规则';
    container.appendChild(empty);
    return;
  }

  for (const item of list) {
    const chip = document.createElement('div');
    chip.className = 'chip';

    const text = document.createElement('span');
    text.title = item;
    text.textContent = item;

    const del = document.createElement('button');
    del.textContent = '×';
    del.title = '删除';
    del.addEventListener('click', () => onDelete(item));

    chip.appendChild(text);
    chip.appendChild(del);
    container.appendChild(chip);
  }
}

async function refreshBlockedCount() {
  const el = $('blockedCount');
  if (!el) return;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      el.textContent = '0';
      return;
    }

    const res = await chrome.tabs.sendMessage(tab.id, { type: 'BB_GET_BLOCKED_COUNT' });
    el.textContent = String(res?.blockedCount ?? 0);
  } catch {
    el.textContent = '0';
  }
}

async function main() {
  const enabledToggle = $('enabledToggle');
  const adsToggle = $('adsToggle');

  const upList = $('upList');
  const tagList = $('tagList');
  const kwList = $('kwList');

  const upInput = $('upInput');
  const tagInput = $('tagInput');
  const kwInput = $('kwInput');

  const upAddBtn = $('upAddBtn');
  const tagAddBtn = $('tagAddBtn');
  const kwAddBtn = $('kwAddBtn');

  let current = await getRules();

  function renderAll() {
    enabledToggle.checked = !!current.enabled;
    adsToggle.checked = !!current.blockAds;

    renderRuleList(upList, current.upNames || [], async (item) => {
      current = { ...current, upNames: removeOne(current.upNames || [], item) };
      await setRules(current);
    });

    renderChipList(tagList, current.tags || [], async (item) => {
      current = { ...current, tags: removeOne(current.tags || [], item) };
      await setRules(current);
    });

    renderRuleList(kwList, current.titleKeywords || [], async (item) => {
      current = { ...current, titleKeywords: removeOne(current.titleKeywords || [], item) };
      await setRules(current);
    });
  }

  enabledToggle.addEventListener('change', async () => {
    current = { ...current, enabled: enabledToggle.checked };
    await setRules(current);
  });

  adsToggle.addEventListener('change', async () => {
    current = { ...current, blockAds: adsToggle.checked };
    await setRules(current);
  });

  function bindAdd(inputEl, btnEl, getter, setter) {
    const doAdd = async () => {
      const v = normalizeText(inputEl.value);
      if (!v) return;
      inputEl.value = '';
      const nextList = uniqPush(getter(), v);
      current = setter(nextList);
      await setRules(current);
    };

    btnEl.addEventListener('click', doAdd);
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doAdd();
    });
  }

  bindAdd(
    upInput,
    upAddBtn,
    () => current.upNames || [],
    (list) => ({ ...current, upNames: list })
  );

  bindAdd(
    tagInput,
    tagAddBtn,
    () => current.tags || [],
    (list) => ({ ...current, tags: list })
  );

  bindAdd(
    kwInput,
    kwAddBtn,
    () => current.titleKeywords || [],
    (list) => ({ ...current, titleKeywords: list })
  );

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') return;
    if (!changes[STORAGE_KEY]) return;
    current = { ...DEFAULT_RULES, ...(changes[STORAGE_KEY].newValue || {}) };
    renderAll();
  });

  renderAll();
  await refreshBlockedCount();

  // 轻量刷新：打开 popup 时每 700ms 刷一次（只做本页计数显示）
  setInterval(refreshBlockedCount, 700);
}

function setupImportExport() {
  const exportBtn = document.getElementById('exportBtn');
  const importBtn = document.getElementById('importBtn');
  const importFile = document.getElementById('importFile');

  if (!exportBtn || !importBtn || !importFile) return;

  // 导出配置
  exportBtn.addEventListener('click', async () => {
    try {
      const rules = await getRules();
      const blob = new Blob([JSON.stringify(rules, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bili-blocker-config-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      alert('配置已导出！你可以把这个 JSON 文件保存到项目目录，在其他浏览器导入。');
    } catch (err) {
      alert('导出失败: ' + err.message);
    }
  });

  // 导入配置
  importBtn.addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data || typeof data !== 'object') throw new Error('无效的配置文件');

      const newRules = { ...DEFAULT_RULES, ...data };
      await setRules(newRules);
      alert('配置导入成功！');
      location.reload();
    } catch (err) {
      alert('导入失败: ' + err.message);
    } finally {
      importFile.value = ''; // 重置，允许重复导入同一文件
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  main();
  setupImportExport();
});
