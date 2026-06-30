// Tabio - 页内 Toast 通知（Content Script）
// 接收来自 background 的消息，在页面右上角展示轻量提示

(function() {
  // 避免重复注入
  if (window.__tabioToastInjected) return;
  window.__tabioToastInjected = true;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'showToast') {
      showToast(message.title, message.body);
      sendResponse({ success: true });
    }
  });

  function showToast(title, body) {
    // 创建容器（如果还没有）
    let container = document.getElementById('tabio-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'tabio-toast-container';
      container.style.cssText = `
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 2147483647;
        display: flex;
        flex-direction: column;
        gap: 8px;
        pointer-events: none;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      `;
      document.body.appendChild(container);
    }

    // 创建 toast 元素
    const toast = document.createElement('div');
    toast.style.cssText = `
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 12px 16px;
      border-radius: 10px;
      box-shadow: 0 4px 20px rgba(102, 126, 234, 0.4);
      max-width: 320px;
      pointer-events: auto;
      cursor: pointer;
      opacity: 0;
      transform: translateX(100%);
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    `;

    toast.innerHTML = `
      <div style="font-size:13px;font-weight:600;margin-bottom:4px;">${escapeHtml(title)}</div>
      <div style="font-size:12px;opacity:0.9;line-height:1.4;">${escapeHtml(body)}</div>
    `;

    // 点击关闭
    toast.addEventListener('click', () => {
      dismissToast(toast);
    });

    container.appendChild(toast);

    // 入场动画
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(0)';
    });

    // 5秒后自动消失
    setTimeout(() => {
      dismissToast(toast);
    }, 5000);
  }

  function dismissToast(toast) {
    if (toast.dataset.dismissed) return;
    toast.dataset.dismissed = 'true';
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => {
      toast.remove();
    }, 300);
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();
