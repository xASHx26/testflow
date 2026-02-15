/**
 * TestFlow — Browser Engine
 * 
 * Controls the embedded BrowserView (lightweight Chromium engine).
 * Supports multiple tabs — each tab is a separate BrowserView.
 * Provides navigation, script injection, DOM inspection, and screenshot capture.
 */

const { BrowserView, session } = require('electron');
const path = require('path');
const EventEmitter = require('events');
const { ipcMain } = require('electron');
const { v4: uuidv4 } = require('uuid');

// Isolated session partition for the embedded browser — cleared on quit
const BROWSER_PARTITION = 'persist:testflow-browser';

class BrowserEngine extends EventEmitter {
  constructor(mainWindow) {
    super();
    this.mainWindow = mainWindow;

    // ─── Multi-tab state ───────────────────────────────────
    this.tabs = new Map();          // tabId → { id, view, url, title, consoleMessages, networkRequests }
    this.activeTabId = null;
    this._lastBounds = null;        // remember bounds for new tabs

    // Legacy single-tab compat (points to active tab's data)
    this.browserView = null;
    this.inspectorEnabled = false;
    this.currentUrl = '';
    this.consoleMessages = [];
    this.networkRequests = [];
    this._dialogIpcHandler = null;
    this._dialogSyncIpcHandler = null;
  }

  // ─── Tab Management ──────────────────────────────────────

  /**
   * Create a new tab and optionally navigate to a URL.
   * Returns the new tab descriptor { id, url, title }.
   */
  createTab(url) {
    if (!this._lastBounds) return null;

    const tabId = uuidv4();
    const view = this._createBrowserView();

    const tab = {
      id: tabId,
      view,
      url: url || '',
      title: 'New Tab',
      consoleMessages: [],
      networkRequests: [],
    };

    this.tabs.set(tabId, tab);
    this._wireViewEvents(tab);
    this._setupNetworkInterceptionForTab(tab);

    // Switch to the new tab
    this.switchTab(tabId);

    // Navigate if URL provided
    if (url) {
      this.navigate(url).catch(() => {});
    }

    this.emit('tab-created', { id: tabId, url: tab.url, title: tab.title });
    this.emit('tabs-changed', this.getTabList());
    return { id: tabId, url: tab.url, title: tab.title };
  }

  /**
   * Close a tab by ID.
   */
  closeTab(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return false;

    // Remove from main window if it's the active view
    if (this.activeTabId === tabId) {
      try { this.mainWindow.removeBrowserView(tab.view); } catch (_) {}
    }

    // Destroy the view
    try { tab.view.webContents.destroy(); } catch (_) {}
    this.tabs.delete(tabId);

    // If we closed the active tab, switch to another
    if (this.activeTabId === tabId) {
      this.activeTabId = null;
      this.browserView = null;
      const remaining = Array.from(this.tabs.keys());
      if (remaining.length > 0) {
        this.switchTab(remaining[remaining.length - 1]);
      } else {
        this.currentUrl = '';
        this.consoleMessages = [];
        this.networkRequests = [];
      }
    }

    this.emit('tab-closed', { id: tabId });
    this.emit('tabs-changed', this.getTabList());
    return true;
  }

  /**
   * Switch to a tab by ID — shows its BrowserView, hides the previous one.
   */
  switchTab(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return false;

    // Remove current active view from window
    if (this.activeTabId && this.activeTabId !== tabId) {
      const prev = this.tabs.get(this.activeTabId);
      if (prev) {
        try { this.mainWindow.removeBrowserView(prev.view); } catch (_) {}
      }
    }

    // Add new view
    this.activeTabId = tabId;
    this.browserView = tab.view;
    this.currentUrl = tab.url;
    this.consoleMessages = tab.consoleMessages;
    this.networkRequests = tab.networkRequests;

    try { this.mainWindow.addBrowserView(tab.view); } catch (_) {}
    if (this._lastBounds) {
      tab.view.setBounds(this._lastBounds);
    }

    this.emit('tab-switched', { id: tabId, url: tab.url, title: tab.title });
    this.emit('navigated', tab.url);
    // Emit network for the newly active tab
    this.emit('tabs-changed', this.getTabList());
    return true;
  }

  /**
   * Get a list of all tabs (for rendering the tab bar).
   */
  getTabList() {
    return Array.from(this.tabs.values()).map(t => ({
      id: t.id,
      url: t.url,
      title: t.title,
      active: t.id === this.activeTabId,
    }));
  }

  /**
   * Get the active tab ID.
   */
  getActiveTabId() {
    return this.activeTabId;
  }

  /**
   * Create a BrowserView with standard webPreferences.
   */
  _createBrowserView() {
    return new BrowserView({
      webPreferences: {
        preload: path.join(__dirname, '..', '..', 'preload', 'browser-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        javascript: true,
        webSecurity: true,
        partition: BROWSER_PARTITION,
      },
    });
  }

  /**
   * Attach a BrowserView to the main window at the given bounds.
   * Creates the first tab if none exist.
   */
  attachView(bounds) {
    this._lastBounds = {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    };

    // If we already have tabs, just re-attach the active one
    if (this.tabs.size > 0 && this.activeTabId) {
      const tab = this.tabs.get(this.activeTabId);
      if (tab) {
        try { this.mainWindow.addBrowserView(tab.view); } catch (_) {}
        tab.view.setBounds(this._lastBounds);
        tab.view.setAutoResize({ width: false, height: false });
        return true;
      }
    }

    // Create first tab
    const view = this._createBrowserView();
    const tabId = uuidv4();
    const tab = {
      id: tabId,
      view,
      url: '',
      title: 'New Tab',
      consoleMessages: [],
      networkRequests: [],
    };

    this.tabs.set(tabId, tab);
    this.activeTabId = tabId;
    this.browserView = view;
    this.consoleMessages = tab.consoleMessages;
    this.networkRequests = tab.networkRequests;

    this.mainWindow.addBrowserView(view);
    view.setBounds(this._lastBounds);
    view.setAutoResize({ width: false, height: false });

    this._wireViewEvents(tab);
    this._setupNetworkInterceptionForTab(tab);
    this._setupDialogIpcListeners();

    this.emit('tab-created', { id: tabId, url: '', title: 'New Tab' });
    this.emit('tabs-changed', this.getTabList());

    return true;
  }

  /**
   * Wire console, navigation, and page-load events for a tab.
   */
  _wireViewEvents(tab) {
    const { view } = tab;

    // Intercept console messages
    view.webContents.on('console-message', (event, level, message, line, sourceId) => {
      const entry = {
        level: ['verbose', 'info', 'warning', 'error'][level] || 'info',
        message,
        line,
        source: sourceId,
        timestamp: Date.now(),
      };
      tab.consoleMessages.push(entry);
      // Only emit to renderer if this is the active tab
      if (tab.id === this.activeTabId) {
        this.emit('console-message', entry);
      }
    });

    // Intercept navigation
    view.webContents.on('did-navigate', (event, url) => {
      tab.url = url;
      tab.title = view.webContents.getTitle() || url;
      if (tab.id === this.activeTabId) {
        this.currentUrl = url;
        this.emit('navigated', url);
      }
      this.emit('tabs-changed', this.getTabList());
    });

    view.webContents.on('did-navigate-in-page', (event, url) => {
      tab.url = url;
      if (tab.id === this.activeTabId) {
        this.currentUrl = url;
        this.emit('navigated', url);
      }
      this.emit('tabs-changed', this.getTabList());
    });

    // Update tab title when page title changes
    view.webContents.on('page-title-updated', (event, title) => {
      tab.title = title || tab.url;
      this.emit('tabs-changed', this.getTabList());
    });

    // Auto-inject inspector/dialog scripts after every page load
    view.webContents.on('did-finish-load', async () => {
      tab.title = view.webContents.getTitle() || tab.url;
      this.emit('tabs-changed', this.getTabList());
      try {
        await this._injectIntoView(view);
        if (this.inspectorEnabled) {
          await view.webContents.executeJavaScript('window.__testflow_inspector?.enable()', true);
        }
        await this._injectDialogOverridesForView(view);
      } catch (e) {
        // Non-fatal — page may have redirected
      }
    });

    // Handle beforeunload dialogs
    view.webContents.on('will-prevent-unload', (event) => {
      event.preventDefault();
      this.emit('js-dialog', {
        dialogType: 'beforeunload',
        message: 'Page is trying to prevent unload',
        defaultPrompt: '',
        returnValue: true,
      });
    });
  }

  /**
   * Navigate the embedded browser to a URL
   */
  async navigate(url) {
    if (!this.browserView) throw new Error('Browser view not attached');

    // Auto-add protocol if missing
    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
    }

    try {
      await this.browserView.webContents.loadURL(url);
    } catch (err) {
      // ERR_ABORTED (-3) happens when the server redirects (e.g. Google search).
      // The page still loads fine after the redirect, so ignore this error.
      if (err.code === 'ERR_ABORTED' || err.errno === -3) {
        // Page redirected — get the final URL from webContents
        url = this.browserView.webContents.getURL() || url;
      } else {
        throw err;
      }
    }

    this.currentUrl = this.browserView.webContents.getURL() || url;
    this.emit('navigated', this.currentUrl);
    return this.currentUrl;
  }

  /**
   * Go back in history
   */
  async goBack() {
    if (this.browserView?.webContents.canGoBack()) {
      this.browserView.webContents.goBack();
      return true;
    }
    return false;
  }

  /**
   * Go forward in history
   */
  async goForward() {
    if (this.browserView?.webContents.canGoForward()) {
      this.browserView.webContents.goForward();
      return true;
    }
    return false;
  }

  /**
   * Reload the page
   */
  async reload() {
    if (this.browserView) {
      this.browserView.webContents.reload();
      return true;
    }
    return false;
  }

  /**
   * Get current URL
   */
  getCurrentUrl() {
    return this.browserView?.webContents.getURL() || '';
  }

  /**
   * Execute JavaScript in the embedded browser context
   */
  async executeScript(script) {
    if (!this.browserView) throw new Error('Browser view not attached');
    return this.browserView.webContents.executeJavaScript(script, true);
  }

  /**
   * Inject a script file into the embedded browser
   */
  async injectScript(scriptPath) {
    const fs = require('fs');
    const script = fs.readFileSync(scriptPath, 'utf-8');
    return this.executeScript(script);
  }

  /**
   * Inject the recorder scripts
   */
  async injectRecorder() {
    const recorderScript = path.join(__dirname, '..', '..', 'inject', 'recorder-inject.js');
    return this.injectScript(recorderScript);
  }

  /**
   * Inject the inspector scripts
   */
  async injectInspector() {
    const inspectorScript = path.join(__dirname, '..', '..', 'inject', 'inspector-inject.js');
    return this.injectScript(inspectorScript);
  }

  /**
   * Inject the freeze scripts
   */
  async injectFreeze() {
    const freezeScript = path.join(__dirname, '..', '..', 'inject', 'freeze-inject.js');
    return this.injectScript(freezeScript);
  }

  /**
   * Inject the visual cursor overlay (for replay visualization)
   */
  async injectCursor() {
    const cursorScript = path.join(__dirname, '..', '..', 'inject', 'cursor-inject.js');
    return this.injectScript(cursorScript);
  }

  /**
   * Enable element inspector mode (always on, this is for re-injection if needed)
   */
  async enableInspector() {
    this.inspectorEnabled = true;
    try {
      await this.injectInspector();
      await this.executeScript('window.__testflow_inspector?.enable()');
    } catch (e) { /* page not ready */ }
    return true;
  }

  /**
   * Disable element inspector mode
   */
  async disableInspector() {
    this.inspectorEnabled = false;
    try {
      await this.executeScript('window.__testflow_inspector?.disable()');
    } catch (e) { /* */ }
    return true;
  }

  /**
   * Get element information at a specific point
   */
  async getElementAt(point) {
    const script = `window.__testflow_inspector?.getElementAt(${point.x}, ${point.y})`;
    return this.executeScript(script);
  }

  /**
   * Update the BrowserView bounds (called when panels show/hide/resize)
   */
  updateBounds(bounds) {
    this._lastBounds = {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    };
    if (this.browserView) {
      this.browserView.setBounds(this._lastBounds);
    }
  }

  /**
   * Validate a locator in the current page
   */
  async validateLocator(locator) {
    const escapedValue = locator.value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    let script;
    switch (locator.type) {
      case 'css':
        script = `document.querySelectorAll('${escapedValue}').length`;
        break;
      case 'xpath':
        script = `document.evaluate('${escapedValue}', document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null).snapshotLength`;
        break;
      case 'id':
        script = `document.getElementById('${escapedValue}') ? 1 : 0`;
        break;
      case 'name':
        script = `document.getElementsByName('${escapedValue}').length`;
        break;
      default:
        return { valid: false, count: 0 };
    }

    const count = await this.executeScript(script);
    return { valid: count === 1, count, unique: count === 1 };
  }

  /**
   * Capture a screenshot of the embedded browser
   */
  async captureScreenshot() {
    if (!this.browserView) throw new Error('Browser view not attached');
    const image = await this.browserView.webContents.capturePage();
    return image.toPNG();
  }

  /**
   * Setup network request interception for a specific tab.
   */
  _setupNetworkInterceptionForTab(tab) {
    if (!tab.view) return;

    const filter = { urls: ['*://*/*'] };
    const ses = tab.view.webContents.session;

    ses.webRequest.onBeforeRequest(filter, (details, callback) => {
      const entry = {
        id: details.id,
        url: details.url,
        method: details.method,
        resourceType: details.resourceType,
        startTime: Date.now(),
        timestamp: details.timestamp || Date.now(),
        statusCode: null,
        responseHeaders: {},
        duration: 0,
        fromCache: false,
        error: null,
      };
      tab.networkRequests.push(entry);
      // Trim to prevent memory leak
      if (tab.networkRequests.length > 500) {
        tab.networkRequests.splice(0, tab.networkRequests.length - 400);
      }
      callback({});
    });

    ses.webRequest.onCompleted(filter, (details) => {
      const entry = tab.networkRequests.find(r => r.id === details.id);
      if (entry) {
        entry.statusCode = details.statusCode;
        entry.fromCache = details.fromCache;
        entry.responseHeaders = details.responseHeaders || {};
        entry.duration = Date.now() - entry.startTime;
        if (tab.id === this.activeTabId) {
          this.emit('network-response', { ...entry });
        }
      }
    });

    ses.webRequest.onErrorOccurred(filter, (details) => {
      const entry = tab.networkRequests.find(r => r.id === details.id);
      if (entry) {
        entry.statusCode = 0;
        entry.error = details.error;
        entry.duration = Date.now() - entry.startTime;
        if (tab.id === this.activeTabId) {
          this.emit('network-response', { ...entry });
        }
      }
    });
  }

  /**
   * Inject inspector script into a specific BrowserView.
   */
  async _injectIntoView(view) {
    const fs = require('fs');
    const inspectorScript = path.join(__dirname, '..', '..', 'inject', 'inspector-inject.js');
    const script = fs.readFileSync(inspectorScript, 'utf-8');
    return view.webContents.executeJavaScript(script, true);
  }

  /**
   * Inject dialog overrides into a specific BrowserView.
   */
  async _injectDialogOverridesForView(view) {
    return view.webContents.executeJavaScript(this._getDialogOverrideScript(), true);
  }

  /**
   * Get all console messages
   */
  getConsoleMessages() {
    return this.consoleMessages;
  }

  /**
   * Get all network requests
   */
  getNetworkRequests() {
    return this.networkRequests;
  }

  /**
   * Clear console messages
   */
  clearConsole() {
    this.consoleMessages = [];
  }

  /**
   * Clear network requests
   */
  clearNetwork() {
    this.networkRequests = [];
  }

  /**
   * Get the BrowserView webContents
   */
  getWebContents() {
    return this.browserView?.webContents || null;
  }

  /**
   * Send a native input event to the BrowserView webContents.
   * These events are TRUSTED (isTrusted = true).
   * For mouseMove during drag, include modifiers: ['leftButtonDown']
   * so that event.buttons = 1 and drag libraries see the held button.
   */
  sendNativeInputEvent(event) {
    const wc = this.browserView?.webContents;
    if (!wc) return;
    wc.sendInputEvent(event);
  }

  /**
   * Focus the BrowserView so it receives input events.
   */
  focusView() {
    try { this.browserView?.webContents?.focus(); } catch (_) {}
  }

  /**
   * Get the dialog override script as a string (shared by all tabs).
   */
  _getDialogOverrideScript() {
    return `
      (function() {
        if (window.__testflow_dialogs_patched) return;
        window.__testflow_dialogs_patched = true;

        const bridge = window.__testflow_bridge;
        if (!bridge) return;

        // Prominent centered dialog overlay — looks like a real browser alert
        function _showDialogOverlay(type, msg) {
          // Backdrop
          const overlay = document.createElement('div');
          Object.assign(overlay.style, {
            position:'fixed',top:'0',left:'0',width:'100%',height:'100%',
            background:'rgba(0,0,0,0.45)',zIndex:'2147483647',
            display:'flex',alignItems:'center',justifyContent:'center',
            opacity:'0',transition:'opacity .2s',fontFamily:'system-ui,sans-serif',
          });
          // Dialog box
          const box = document.createElement('div');
          Object.assign(box.style, {
            background:'#fff',borderRadius:'10px',minWidth:'340px',maxWidth:'480px',
            boxShadow:'0 12px 40px rgba(0,0,0,.35)',overflow:'hidden',
          });
          // Header
          const hdr = document.createElement('div');
          const colors = { alert:'#1e88e5', confirm:'#43a047', prompt:'#fb8c00' };
          const icons  = { alert:'⚠', confirm:'✓', prompt:'✏' };
          hdr.textContent = (icons[type]||'') + '  ' + type.charAt(0).toUpperCase()+type.slice(1);
          Object.assign(hdr.style, {
            background:colors[type]||'#1e88e5',color:'#fff',padding:'14px 18px',
            fontWeight:'700',fontSize:'15px',letterSpacing:'.3px',
          });
          // Body
          const body = document.createElement('div');
          body.textContent = msg || '(no message)';
          Object.assign(body.style, {
            padding:'22px 18px 14px',fontSize:'14px',color:'#222',lineHeight:'1.6',
            wordBreak:'break-word',maxHeight:'200px',overflowY:'auto',
          });
          // Footer
          const foot = document.createElement('div');
          Object.assign(foot.style, { padding:'8px 18px 16px',textAlign:'right' });
          const btn = document.createElement('button');
          btn.textContent = 'OK';
          Object.assign(btn.style, {
            background:colors[type]||'#1e88e5',color:'#fff',border:'none',
            padding:'9px 28px',borderRadius:'6px',fontSize:'14px',fontWeight:'600',
            cursor:'pointer',
          });
          function dismiss() {
            overlay.style.opacity='0'; setTimeout(()=>overlay.remove(),200);
          }
          btn.onclick = dismiss;
          overlay.onclick = function(e){ if(e.target===overlay) dismiss(); };
          foot.appendChild(btn);
          box.appendChild(hdr); box.appendChild(body); box.appendChild(foot);
          overlay.appendChild(box);
          document.body.appendChild(overlay);
          requestAnimationFrame(()=>{ overlay.style.opacity='1'; });
          // Auto-dismiss after 3 s
          setTimeout(()=>{ if(overlay.parentNode) dismiss(); }, 3000);
        }

        // Override window.alert
        const origAlert = window.alert;
        window.alert = function(message) {
          try {
            bridge.sendDialogEvent({
              dialogType: 'alert',
              message: String(message || ''),
              defaultPrompt: '',
              url: window.location.href,
              timestamp: Date.now(),
            });
            _showDialogOverlay('alert', message);
          } catch(e) {}
          // alert() returns undefined — just return without blocking
        };

        // Override window.confirm
        const origConfirm = window.confirm;
        window.confirm = function(message) {
          try {
            const result = bridge.sendDialogEventSync({
              dialogType: 'confirm',
              message: String(message || ''),
              defaultPrompt: '',
              url: window.location.href,
              timestamp: Date.now(),
            });
            _showDialogOverlay('confirm', message + ' → OK');
            return result !== undefined ? !!result : true;
          } catch(e) {
            return true; // default: accept
          }
        };

        // Override window.prompt
        const origPrompt = window.prompt;
        window.prompt = function(message, defaultValue) {
          try {
            const result = bridge.sendDialogEventSync({
              dialogType: 'prompt',
              message: String(message || ''),
              defaultPrompt: String(defaultValue || ''),
              url: window.location.href,
              timestamp: Date.now(),
            });
            _showDialogOverlay('prompt', message + ' → ' + (result || defaultValue || ''));
            return result !== undefined ? String(result) : (defaultValue || '');
          } catch(e) {
            return defaultValue || '';
          }
        };
      })();
    `;
  }

  /**
   * Inject window.alert/confirm/prompt overrides into the active tab's page.
   * Legacy method — used by external callers.
   */
  async _injectDialogOverrides() {
    return this.executeScript(this._getDialogOverrideScript());
  }

  /**
   * Set up IPC listeners for dialog events from the injected overrides.
   * Matches against ANY of our tab BrowserViews.
   */
  _setupDialogIpcListeners() {
    if (this._dialogIpcHandler) return; // already set up

    // Async handler for alert (fire-and-forget)
    this._dialogIpcHandler = (event, data) => {
      const isOurs = Array.from(this.tabs.values()).some(t => t.view && event.sender === t.view.webContents);
      if (isOurs) {
        this.emit('js-dialog', {
          dialogType: data.dialogType,
          message: data.message,
          defaultPrompt: data.defaultPrompt || '',
          returnValue: true,
        });
      }
    };
    ipcMain.on('testflow:dialog-event', this._dialogIpcHandler);

    // Sync handler for confirm/prompt (needs return value)
    this._dialogSyncIpcHandler = (event, data) => {
      const isOurs = Array.from(this.tabs.values()).some(t => t.view && event.sender === t.view.webContents);
      if (isOurs) {
        this.emit('js-dialog', {
          dialogType: data.dialogType,
          message: data.message,
          defaultPrompt: data.defaultPrompt || '',
          returnValue: data.dialogType === 'confirm' ? true : (data.defaultPrompt || ''),
        });
        // Return value: true for confirm, defaultPrompt for prompt
        if (data.dialogType === 'confirm') {
          event.returnValue = true;
        } else if (data.dialogType === 'prompt') {
          event.returnValue = data.defaultPrompt || '';
        } else {
          event.returnValue = true;
        }
      } else {
        event.returnValue = true;
      }
    };
    ipcMain.on('testflow:dialog-event-sync', this._dialogSyncIpcHandler);
  }

  /**
   * Clean up dialog IPC listeners
   */
  _teardownDialogIpcListeners() {
    if (this._dialogIpcHandler) {
      ipcMain.removeListener('testflow:dialog-event', this._dialogIpcHandler);
      this._dialogIpcHandler = null;
    }
    if (this._dialogSyncIpcHandler) {
      ipcMain.removeListener('testflow:dialog-event-sync', this._dialogSyncIpcHandler);
      this._dialogSyncIpcHandler = null;
    }
  }

  /**
   * Destroy all tabs and clean up
   */
  destroy() {
    this._teardownDialogIpcListeners();
    for (const [tabId, tab] of this.tabs) {
      try { this.mainWindow.removeBrowserView(tab.view); } catch (_) {}
      try { tab.view.webContents.destroy(); } catch (_) {}
    }
    this.tabs.clear();
    this.activeTabId = null;
    this.browserView = null;
  }
}

module.exports = { BrowserEngine };
