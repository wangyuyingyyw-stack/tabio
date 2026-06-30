// Tabio - Background Service Worker
// 核心功能：重复标签检测、不活跃标签清理、历史记录

// ============ 默认配置 ============
const DEFAULT_SETTINGS = {
  // 重复标签设置
  autoDedupe: true,           // 自动关闭重复标签
  dedupeScope: 'all',         // 'all' = 所有窗口, 'window' = 当前窗口
  
  // 不活跃标签设置
  autoCloseInactive: true,    // 自动关闭不活跃标签
  inactiveTimeout: 30,        // 不活跃超时时间（分钟）
  protectPinned: true,        // 保护固定标签
  protectAudible: true,       // 保护播放音频的标签
  protectGrouped: false,      // 保护分组标签
  
  // 白名单（这些 URL 不会被自动关闭）
  whitelist: [],
  
  // 历史记录
  maxHistory: 100,            // 最多保存多少条关闭记录
};

// ============ 状态管理 ============
let tabLastAccess = {};  // { tabId: timestamp }
let settings = { ...DEFAULT_SETTINGS };
let closedHistory = [];  // [{ url, title, closedAt, reason }]

// Service Worker 每次唤醒时立即从 storage 恢复状态
chrome.storage.local.get(['settings', 'closedHistory']).then(stored => {
  if (stored.settings) {
    settings = { ...DEFAULT_SETTINGS, ...stored.settings };
  }
  if (stored.closedHistory) {
    closedHistory = stored.closedHistory;
  }
});

// ============ 初始化 ============
chrome.runtime.onInstalled.addListener(async (details) => {
  const stored = await chrome.storage.local.get(['settings', 'closedHistory']);
  if (stored.settings) {
    settings = { ...DEFAULT_SETTINGS, ...stored.settings };
  } else {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  }
  closedHistory = stored.closedHistory || [];
  
  // 首次安装时打开欢迎引导页
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
  }
  
  // 初始化所有已打开标签的访问时间
  const tabs = await chrome.tabs.query({});
  const now = Date.now();
  tabs.forEach(tab => {
    tabLastAccess[tab.id] = now;
  });
  
  // 设置定时检查（每分钟）
  chrome.alarms.create('checkInactive', { periodInMinutes: 1 });
});

// 启动时恢复状态
chrome.runtime.onStartup.addListener(async () => {
  const stored = await chrome.storage.local.get(['settings', 'closedHistory']);
  if (stored.settings) {
    settings = { ...DEFAULT_SETTINGS, ...stored.settings };
  }
  closedHistory = stored.closedHistory || [];
  
  const tabs = await chrome.tabs.query({});
  const now = Date.now();
  tabs.forEach(tab => {
    tabLastAccess[tab.id] = now;
  });
  
  chrome.alarms.create('checkInactive', { periodInMinutes: 1 });
});

// ============ 重复标签检测 ============
function normalizeUrl(url) {
  try {
    const u = new URL(url);
    // 去掉尾部斜杠和 hash，统一比较
    let normalized = u.origin + u.pathname.replace(/\/$/, '') + u.search;
    return normalized;
  } catch (e) {
    return url;
  }
}

async function findDuplicates() {
  const queryOpts = settings.dedupeScope === 'window' 
    ? { currentWindow: true } 
    : {};
  const tabs = await chrome.tabs.query(queryOpts);
  
  const urlMap = {};  // normalizedUrl -> [tab, ...]
  const duplicates = [];
  
  for (const tab of tabs) {
    if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
      continue;
    }
    if (isWhitelisted(tab.url)) continue;
    
    const key = normalizeUrl(tab.url);
    if (!urlMap[key]) {
      urlMap[key] = [tab];
    } else {
      urlMap[key].push(tab);
      duplicates.push(tab);
    }
  }
  
  return { urlMap, duplicates };
}

async function closeDuplicates() {
  const { urlMap } = await findDuplicates();
  let closedCount = 0;
  
  for (const [url, tabs] of Object.entries(urlMap)) {
    if (tabs.length <= 1) continue;
    
    // 保留最新打开的（id 最大的），关闭其他旧的
    tabs.sort((a, b) => b.id - a.id);
    
    for (let i = 1; i < tabs.length; i++) {
      const tab = tabs[i];
      if (settings.protectPinned && tab.pinned) continue;
      if (settings.protectAudible && tab.audible) continue;
      
      try {
        await addToHistory(tab, 'duplicate');
        await chrome.tabs.remove(tab.id);
        closedCount++;
      } catch (e) {
        console.log('Tab already closed:', e.message);
      }
    }
  }
  
  return closedCount;
}

// 记录通过"复制"方式创建的标签
let duplicatedTabs = new Set();  // 存储通过复制创建的标签ID

chrome.tabs.onCreated.addListener(async (tab) => {
  tabLastAccess[tab.id] = Date.now();
  
  // 检测是否是通过"复制"标签创建的
  // 复制标签时：新标签有 openerTabId，且 URL 与 opener 相同
  if (tab.openerTabId) {
    try {
      const openerTab = await chrome.tabs.get(tab.openerTabId);
      // 如果新标签的 pendingUrl/url 与 opener 一致，说明是复制操作
      const newUrl = tab.pendingUrl || tab.url;
      if (openerTab.url && newUrl && normalizeUrl(openerTab.url) === normalizeUrl(newUrl)) {
        duplicatedTabs.add(tab.id);
      }
    } catch (e) {
      // opener 不存在，忽略
    }
  }
});

// 标签URL更新时检查重复
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    tabLastAccess[tabId] = Date.now();
    
    if (settings.autoDedupe && tab.url && !tab.url.startsWith('chrome://')) {
      await checkAndCloseDuplicate(tab);
    }
  }
});

async function checkAndCloseDuplicate(newTab) {
  if (!newTab.url || isWhitelisted(newTab.url)) return;
  
  // 如果是通过"复制"标签创建的，跳过去重
  if (duplicatedTabs.has(newTab.id)) {
    duplicatedTabs.delete(newTab.id);
    return;
  }
  
  const normalizedNew = normalizeUrl(newTab.url);
  const queryOpts = settings.dedupeScope === 'window'
    ? { windowId: newTab.windowId }
    : {};
  const allTabs = await chrome.tabs.query(queryOpts);
  
  for (const existingTab of allTabs) {
    if (existingTab.id === newTab.id) continue;
    if (!existingTab.url) continue;
    
    if (normalizeUrl(existingTab.url) === normalizedNew) {
      // 存在重复，保留新打开的，关闭旧的
      try {
        await addToHistory(existingTab, 'duplicate');
        await chrome.tabs.update(newTab.id, { active: true });
        await chrome.tabs.remove(existingTab.id);
        
        // 前 5 次去重时给用户通知提示
        await showDedupeNotification(newTab.title || newTab.url);
      } catch (e) {
        console.log('Tab already closed:', e.message);
      }
      
      // 更新 badge 提示
      updateBadge();
      return;
    }
  }
}

// ============ 不活跃标签清理 ============
// 标签被激活时更新访问时间
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  tabLastAccess[activeInfo.tabId] = Date.now();
  updateBadge();
});

// 标签关闭时清理记录
chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabLastAccess[tabId];
});

// 定时检查不活跃标签
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'checkInactive') {
    if (!settings.autoCloseInactive) return;
    await closeInactiveTabs();
    updateBadge();
  }
});

async function closeInactiveTabs() {
  const now = Date.now();
  const timeoutMs = settings.inactiveTimeout * 60 * 1000;
  const tabs = await chrome.tabs.query({});
  let closedCount = 0;
  
  for (const tab of tabs) {
    // 跳过当前活跃标签
    if (tab.active) {
      tabLastAccess[tab.id] = now;
      continue;
    }
    
    // 保护规则
    if (settings.protectPinned && tab.pinned) continue;
    if (settings.protectAudible && tab.audible) continue;
    if (settings.protectGrouped && tab.groupId && tab.groupId !== -1) continue;
    if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) continue;
    if (isWhitelisted(tab.url)) continue;
    
    const lastAccess = tabLastAccess[tab.id] || now;
    if (now - lastAccess > timeoutMs) {
      try {
        await addToHistory(tab, 'inactive');
        await chrome.tabs.remove(tab.id);
        closedCount++;
      } catch (e) {
        console.log('Tab already closed:', e.message);
      }
    }
  }
  
  return closedCount;
}

// ============ 白名单 ============
function isWhitelisted(url) {
  if (!url) return false;
  return settings.whitelist.some(pattern => {
    try {
      if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        return regex.test(url);
      }
      return url.includes(pattern);
    } catch (e) {
      return url.includes(pattern);
    }
  });
}

// ============ 历史记录 ============
async function addToHistory(tab, reason) {
  closedHistory.unshift({
    url: tab.url,
    title: tab.title || tab.url,
    favIconUrl: tab.favIconUrl || '',
    closedAt: Date.now(),
    reason: reason,  // 'duplicate' or 'inactive'
  });
  
  // 限制历史记录数量
  if (closedHistory.length > settings.maxHistory) {
    closedHistory = closedHistory.slice(0, settings.maxHistory);
  }
  
  await chrome.storage.local.set({ closedHistory });
}

// ============ 去重提示（页内 Toast） ============
async function showDedupeNotification(tabTitle) {
  const toastTitle = 'Tabio: 已关闭旧的重复页面';
  const toastBody = '';
  
  // 向当前活跃标签注入 toast
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!activeTab || !activeTab.id || activeTab.url.startsWith('chrome://') || activeTab.url.startsWith('chrome-extension://')) {
      return;
    }
    
    // 先尝试通过 sendMessage（content script 已就绪时最快）
    try {
      await chrome.tabs.sendMessage(activeTab.id, {
        action: 'showToast',
        title: toastTitle,
        body: toastBody,
      });
    } catch (msgErr) {
      // content script 未就绪，使用 scripting API 动态注入
      await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: injectToast,
        args: [toastTitle, toastBody],
      });
    }
  } catch (e) {
    console.log('Toast failed:', e.message);
  }
}

// 动态注入的 toast 函数（不依赖 content script）
function injectToast(title, body) {
  // 创建容器
  let container = document.getElementById('tabio-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'tabio-toast-container';
    Object.assign(container.style, {
      position: 'fixed',
      top: '16px',
      right: '16px',
      zIndex: '2147483647',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      pointerEvents: 'none',
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    });
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  Object.assign(toast.style, {
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: 'white',
    padding: '12px 16px',
    borderRadius: '10px',
    boxShadow: '0 4px 20px rgba(102, 126, 234, 0.4)',
    maxWidth: '320px',
    pointerEvents: 'auto',
    cursor: 'pointer',
    opacity: '0',
    transform: 'translateX(100%)',
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
  });

  const titleEl = document.createElement('div');
  Object.assign(titleEl.style, { fontSize: '13px', fontWeight: '600' });
  titleEl.textContent = title;
  toast.appendChild(titleEl);

  if (body) {
    const bodyEl = document.createElement('div');
    Object.assign(bodyEl.style, { fontSize: '12px', opacity: '0.9', lineHeight: '1.4', marginTop: '4px' });
    bodyEl.textContent = body;
    toast.appendChild(bodyEl);
  }

  toast.addEventListener('click', () => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
  });

  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(0)';
  });

  setTimeout(() => {
    if (toast.parentNode) {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      setTimeout(() => toast.remove(), 300);
    }
  }, 5000);
}

// ============ Badge 显示 ============
async function updateBadge() {
  const tabs = await chrome.tabs.query({});
  const count = tabs.length;
  
  if (count > 10) {
    chrome.action.setBadgeText({ text: String(count) });
    chrome.action.setBadgeBackgroundColor({ 
      color: count > 30 ? '#e74c3c' : count > 20 ? '#f39c12' : '#3498db' 
    });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// ============ 消息处理（与 Popup 通信） ============
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse);
  return true;  // 保持消息通道开放
});

async function handleMessage(message) {
  switch (message.action) {
    case 'getStats': {
      const tabs = await chrome.tabs.query({});
      const { duplicates } = await findDuplicates();
      const now = Date.now();
      const timeoutMs = settings.inactiveTimeout * 60 * 1000;
      const inactiveCount = tabs.filter(tab => {
        if (tab.active || tab.pinned) return false;
        const lastAccess = tabLastAccess[tab.id] || now;
        return (now - lastAccess) > timeoutMs * 0.7; // 即将过期的（70%时间已过）
      }).length;
      
      return {
        totalTabs: tabs.length,
        duplicateCount: duplicates.length,
        inactiveCount: inactiveCount,
      };
    }
    
    case 'getAllTabs': {
      const tabs = await chrome.tabs.query({});
      const now = Date.now();
      return tabs.map(tab => ({
        id: tab.id,
        title: tab.title,
        url: tab.url,
        favIconUrl: tab.favIconUrl,
        pinned: tab.pinned,
        active: tab.active,
        windowId: tab.windowId,
        lastAccess: tabLastAccess[tab.id] || now,
        audible: tab.audible,
      }));
    }
    
    case 'getSettings': {
      return settings;
    }
    
    case 'updateSettings': {
      settings = { ...settings, ...message.data };
      await chrome.storage.local.set({ settings });
      return { success: true };
    }
    
    case 'closeDuplicates': {
      const count = await closeDuplicates();
      return { closedCount: count };
    }
    
    case 'closeInactive': {
      const count = await closeInactiveTabs();
      return { closedCount: count };
    }
    
    case 'getHistory': {
      return closedHistory;
    }
    
    case 'restoreTab': {
      const { url } = message.data;
      await chrome.tabs.create({ url });
      // 从历史中移除
      closedHistory = closedHistory.filter(h => h.url !== url || h.closedAt !== message.data.closedAt);
      await chrome.storage.local.set({ closedHistory });
      return { success: true };
    }
    
    case 'clearHistory': {
      closedHistory = [];
      await chrome.storage.local.set({ closedHistory });
      return { success: true };
    }
    
    case 'switchToTab': {
      const { tabId, windowId } = message.data;
      await chrome.windows.update(windowId, { focused: true });
      await chrome.tabs.update(tabId, { active: true });
      return { success: true };
    }
    
    default:
      return { error: 'Unknown action' };
  }
}

// ============ Omnibox 地址栏搜索 ============
// 用户在地址栏输入 "go" + Tab 后，输入关键词搜索已打开的标签
chrome.omnibox.onInputStarted.addListener(() => {
  chrome.action.setBadgeText({ text: '🔍' });
});

chrome.omnibox.onInputChanged.addListener(async (text, suggest) => {
  const query = text.toLowerCase().trim();
  if (!query) {
    suggest([]);
    return;
  }
  
  const tabs = await chrome.tabs.query({});
  const matches = tabs.filter(tab => {
    if (!tab.title && !tab.url) return false;
    return (tab.title && tab.title.toLowerCase().includes(query)) ||
           (tab.url && tab.url.toLowerCase().includes(query));
  });
  
  const suggestions = matches.slice(0, 8).map(tab => ({
    content: String(tab.id),
    description: `${escapeXml(tab.title || '无标题')} - <url>${escapeXml(tab.url || '')}</url>`,
  }));
  
  suggest(suggestions);
});

chrome.omnibox.onInputEntered.addListener(async (text, disposition) => {
  // text 可能是 tab id（用户选了建议项）或搜索关键词（用户直接回车）
  const tabId = parseInt(text);
  
  if (!isNaN(tabId)) {
    // 用户选择了某个标签，直接跳转
    try {
      const tab = await chrome.tabs.get(tabId);
      await chrome.windows.update(tab.windowId, { focused: true });
      await chrome.tabs.update(tabId, { active: true });
    } catch (e) {
      console.log('Tab not found:', e.message);
    }
  } else {
    // 用户输入了关键词直接回车，跳转到第一个匹配的标签
    const query = text.toLowerCase().trim();
    const tabs = await chrome.tabs.query({});
    const match = tabs.find(tab =>
      (tab.title && tab.title.toLowerCase().includes(query)) ||
      (tab.url && tab.url.toLowerCase().includes(query))
    );
    
    if (match) {
      await chrome.windows.update(match.windowId, { focused: true });
      await chrome.tabs.update(match.id, { active: true });
    }
  }
  
  updateBadge();
});

// Omnibox 描述需要转义 XML 特殊字符
function escapeXml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
}

// 初始化 badge
updateBadge();
