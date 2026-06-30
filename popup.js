// TabSweep Popup Script

// ============ 导航切换 ============
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    // 切换按钮状态
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    // 切换面板
    const panelId = btn.dataset.panel;
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.getElementById(`panel-${panelId}`).classList.add('active');
    
    // 加载面板数据
    if (panelId === 'dashboard') loadStats();
    if (panelId === 'search') loadAllTabs();
    if (panelId === 'history') loadHistory();
    if (panelId === 'settings') loadSettings();
  });
});

// ============ 概览面板 ============
async function loadStats() {
  const stats = await sendMessage({ action: 'getStats' });
  if (!stats) {
    document.getElementById('stat-total').textContent = '?';
    document.getElementById('stat-duplicates').textContent = '?';
    document.getElementById('stat-inactive').textContent = '?';
    return;
  }
  document.getElementById('stat-total').textContent = stats.totalTabs;
  document.getElementById('stat-duplicates').textContent = stats.duplicateCount;
  document.getElementById('stat-inactive').textContent = stats.inactiveCount;
}

document.getElementById('btn-close-duplicates').addEventListener('click', async () => {
  const result = await sendMessage({ action: 'closeDuplicates' });
  if (result) {
    showResult(`已关闭 ${result.closedCount} 个重复标签页`);
  }
  loadStats();
});

document.getElementById('btn-close-inactive').addEventListener('click', async () => {
  const result = await sendMessage({ action: 'closeInactive' });
  if (result) {
    showResult(`已清理 ${result.closedCount} 个超时标签页`);
  }
  loadStats();
});

function showResult(text) {
  const el = document.getElementById('action-result');
  el.textContent = text;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 3000);
}

// ============ 搜索面板 ============
let allTabs = [];

async function loadAllTabs() {
  allTabs = await sendMessage({ action: 'getAllTabs' }) || [];
  renderTabList(allTabs);
}

document.getElementById('search-input').addEventListener('input', (e) => {
  const query = e.target.value.toLowerCase().trim();
  if (!query) {
    renderTabList(allTabs);
    return;
  }
  
  const filtered = allTabs.filter(tab => 
    (tab.title && tab.title.toLowerCase().includes(query)) ||
    (tab.url && tab.url.toLowerCase().includes(query))
  );
  renderTabList(filtered);
});

function renderTabList(tabs) {
  const container = document.getElementById('tab-list');
  
  if (tabs.length === 0) {
    container.innerHTML = '<div class="empty-state">没有找到匹配的标签页</div>';
    return;
  }
  
  container.innerHTML = tabs.map(tab => `
    <div class="tab-item" data-tab-id="${tab.id}" data-window-id="${tab.windowId}">
      <img class="favicon" src="${tab.favIconUrl || 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22><rect fill=%22%23ddd%22 width=%2216%22 height=%2216%22 rx=%222%22/></svg>'}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22><rect fill=%22%23ddd%22 width=%2216%22 height=%2216%22 rx=%222%22/></svg>'">
      <div class="tab-info">
        <div class="tab-title">${escapeHtml(tab.title || '无标题')}</div>
        <div class="tab-url">${escapeHtml(truncateUrl(tab.url))}</div>
      </div>
      ${tab.pinned ? '<span class="tab-badge" style="background:#e8f5e9;color:#2e7d32;">📌</span>' : ''}
      ${tab.audible ? '<span class="tab-badge" style="background:#e3f2fd;color:#1565c0;">🔊</span>' : ''}
    </div>
  `).join('');
  
  // 点击跳转
  container.querySelectorAll('.tab-item').forEach(item => {
    item.addEventListener('click', async () => {
      const tabId = parseInt(item.dataset.tabId);
      const windowId = parseInt(item.dataset.windowId);
      await sendMessage({ action: 'switchToTab', data: { tabId, windowId } });
      window.close();
    });
  });
}

// ============ 历史面板 ============
async function loadHistory() {
  const history = await sendMessage({ action: 'getHistory' });
  const container = document.getElementById('history-list');
  
  if (!history || history.length === 0) {
    container.innerHTML = '<div class="empty-state">暂无关闭记录</div>';
    return;
  }
  
  container.innerHTML = history.map(item => `
    <div class="tab-item history-item" data-url="${escapeHtml(item.url)}" data-closed-at="${item.closedAt}">
      <img class="favicon" src="${item.favIconUrl || 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22><rect fill=%22%23ddd%22 width=%2216%22 height=%2216%22 rx=%222%22/></svg>'}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22><rect fill=%22%23ddd%22 width=%2216%22 height=%2216%22 rx=%222%22/></svg>'">
      <div class="tab-info">
        <div class="tab-title">${escapeHtml(item.title || '无标题')}</div>
        <div class="tab-url">${escapeHtml(truncateUrl(item.url))}</div>
      </div>
      <span class="tab-badge ${item.reason === 'duplicate' ? 'badge-duplicate' : 'badge-inactive'}">
        ${item.reason === 'duplicate' ? '重复' : '超时'}
      </span>
      <span class="tab-time">${formatTime(item.closedAt)}</span>
    </div>
  `).join('');
  
  // 点击恢复
  container.querySelectorAll('.history-item').forEach(item => {
    item.addEventListener('click', async () => {
      const url = item.dataset.url;
      const closedAt = parseInt(item.dataset.closedAt);
      await sendMessage({ action: 'restoreTab', data: { url, closedAt } });
      loadHistory();
    });
  });
}

document.getElementById('btn-clear-history').addEventListener('click', async () => {
  await sendMessage({ action: 'clearHistory' });
  loadHistory();
});

// ============ 设置面板 ============
async function loadSettings() {
  const settings = await sendMessage({ action: 'getSettings' });
  if (!settings) return;
  
  document.getElementById('setting-autoDedupe').checked = settings.autoDedupe;
  document.getElementById('setting-dedupeScope').value = settings.dedupeScope;
  document.getElementById('setting-autoCloseInactive').checked = settings.autoCloseInactive;
  document.getElementById('setting-inactiveTimeout').value = settings.inactiveTimeout;
  document.getElementById('setting-protectPinned').checked = settings.protectPinned;
  document.getElementById('setting-protectAudible').checked = settings.protectAudible;
  document.getElementById('setting-protectGrouped').checked = settings.protectGrouped;
  document.getElementById('setting-whitelist').value = (settings.whitelist || []).join('\n');
}

document.getElementById('btn-save-settings').addEventListener('click', async () => {
  const newSettings = {
    autoDedupe: document.getElementById('setting-autoDedupe').checked,
    dedupeScope: document.getElementById('setting-dedupeScope').value,
    autoCloseInactive: document.getElementById('setting-autoCloseInactive').checked,
    inactiveTimeout: parseInt(document.getElementById('setting-inactiveTimeout').value) || 30,
    protectPinned: document.getElementById('setting-protectPinned').checked,
    protectAudible: document.getElementById('setting-protectAudible').checked,
    protectGrouped: document.getElementById('setting-protectGrouped').checked,
    whitelist: document.getElementById('setting-whitelist').value
      .split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 0),
  };
  
  await sendMessage({ action: 'updateSettings', data: newSettings });
  
  // 显示保存成功
  const btn = document.getElementById('btn-save-settings');
  const originalText = btn.textContent;
  btn.textContent = '✓ 已保存';
  btn.style.background = '#27ae60';
  setTimeout(() => {
    btn.textContent = originalText;
    btn.style.background = '';
  }, 2000);
});

// ============ 工具函数 ============
function sendMessage(msg) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('sendMessage error:', chrome.runtime.lastError.message);
          resolve(null);
          return;
        }
        resolve(response);
      });
    } catch (e) {
      console.warn('sendMessage exception:', e);
      resolve(null);
    }
  });
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function truncateUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    const path = u.pathname.length > 30 ? u.pathname.slice(0, 30) + '...' : u.pathname;
    return u.host + path;
  } catch (e) {
    return url.slice(0, 50);
  }
}

function formatTime(timestamp) {
  const diff = Date.now() - timestamp;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
  return Math.floor(diff / 86400000) + '天前';
}

// ============ 初始化 ============
document.addEventListener('DOMContentLoaded', () => {
  loadStats().catch(e => console.warn('loadStats failed:', e));
});
