/**
 * TestFlow — Tab Manager
 * 
 * Manages the browser tab bar UI — create, close, and switch tabs.
 * Each tab maps to a separate BrowserView in the main process.
 */

class TabManager {
  constructor() {
    this.tabsEl = document.getElementById('browser-tabs');
    this.btnNewTab = document.getElementById('btn-new-tab');
    this.tabs = [];

    this._bind();
    this._listen();
  }

  _bind() {
    this.btnNewTab?.addEventListener('click', () => this.createTab());

    // Keyboard shortcut: Ctrl+T = new tab, Ctrl+W = close tab
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 't') {
        e.preventDefault();
        this.createTab();
      }
      if (e.ctrlKey && e.key === 'w') {
        e.preventDefault();
        this.closeActiveTab();
      }
    });
  }

  _listen() {
    // Listen for tab list changes from main process
    window.testflow.tabs.onChanged((tabs) => {
      this.tabs = tabs;
      this.render();
    });
  }

  async createTab(url) {
    try {
      // Ensure browser view is attached first
      const bounds = window.PanelManager.getBrowserBounds();
      await window.testflow.browser.attachView(bounds);

      const placeholder = document.getElementById('browser-placeholder');
      if (placeholder) placeholder.classList.add('hidden');

      await window.testflow.tabs.create(url || null);
    } catch (err) {
      console.error('[TabManager] Failed to create tab:', err);
    }
  }

  async closeTab(tabId) {
    try {
      await window.testflow.tabs.close(tabId);
      // If no tabs remain, show placeholder
      const list = await window.testflow.tabs.getList();
      if (!list || list.length === 0) {
        const placeholder = document.getElementById('browser-placeholder');
        if (placeholder) placeholder.classList.remove('hidden');
      }
    } catch (err) {
      console.error('[TabManager] Failed to close tab:', err);
    }
  }

  async closeActiveTab() {
    const active = this.tabs.find(t => t.active);
    if (active) {
      await this.closeTab(active.id);
    }
  }

  async switchTab(tabId) {
    try {
      await window.testflow.tabs.switch(tabId);
    } catch (err) {
      console.error('[TabManager] Failed to switch tab:', err);
    }
  }

  render() {
    if (!this.tabsEl) return;
    this.tabsEl.innerHTML = '';

    // Always show the tab bar (user needs the + button to create tabs)
    const tabBar = document.getElementById('browser-tab-bar');
    if (tabBar) {
      tabBar.style.display = '';
    }

    this.tabs.forEach((tab) => {
      const el = document.createElement('div');
      el.className = `browser-tab${tab.active ? ' active' : ''}`;
      el.dataset.tabId = tab.id;
      el.title = tab.url || 'New Tab';

      const label = document.createElement('span');
      label.className = 'browser-tab-label';
      label.textContent = this._truncate(tab.title || tab.url || 'New Tab', 24);
      el.appendChild(label);

      const closeBtn = document.createElement('button');
      closeBtn.className = 'browser-tab-close';
      closeBtn.textContent = '×';
      closeBtn.title = 'Close Tab';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeTab(tab.id);
      });
      el.appendChild(closeBtn);

      el.addEventListener('click', () => {
        if (!tab.active) this.switchTab(tab.id);
      });

      // Middle-click to close
      el.addEventListener('auxclick', (e) => {
        if (e.button === 1) {
          e.preventDefault();
          this.closeTab(tab.id);
        }
      });

      this.tabsEl.appendChild(el);
    });
  }

  _truncate(str, maxLen) {
    if (!str) return '';
    return str.length > maxLen ? str.substring(0, maxLen - 1) + '…' : str;
  }
}

window.TabManager = new TabManager();
