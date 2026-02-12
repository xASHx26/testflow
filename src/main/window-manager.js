/**
 * TestFlow — Window Manager
 * 
 * Manages the main IDE window, embedded BrowserView,
 * and any auxiliary windows (mini inspector, etc.)
 */

const { BrowserWindow, BrowserView, screen } = require('electron');
const path = require('path');

class WindowManager {
  constructor() {
    this.mainWindow = null;
    this.browserView = null;
    this.miniInspectorWindow = null;
    this.reportSettingsWindow = null;
    this.reportProgressWindow = null;
    this.aboutWindow = null;
    this.shortcutsWindow = null;
    this._browserViewHidden = false;
    this._savedBrowserBounds = null;

    // Pop-out panel windows  { browser, inspector, console }
    this.popoutWindows = {};
    this._activePopout = null;   // which panel is currently popped out
  }

  /**
   * Create the main IDE window with professional defaults
   */
  createMainWindow() {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;

    this.mainWindow = new BrowserWindow({
      width: Math.min(1600, width),
      height: Math.min(1000, height),
      minWidth: 1024,
      minHeight: 680,
      title: 'TestFlow — Test Automation IDE',
      show: false,
      backgroundColor: '#1e1e2e',
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        webviewTag: false,
      },
      frame: true,
    });

    // Set app icon – try PNG first, fall back to creating one from SVG at runtime
    try {
      const { nativeImage } = require('electron');
      const fs = require('fs');
      const pngPath = path.join(__dirname, '..', '..', 'assets', 'icon.png');
      if (fs.existsSync(pngPath)) {
        this.mainWindow.setIcon(pngPath);
      }
    } catch (e) {
      // Silently ignore icon errors
    }

    // Maximize on first launch for IDE feel
    this.mainWindow.maximize();

    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
      this.browserView = null;
    });

    return this.mainWindow;
  }

  /**
   * Attach a BrowserView (the embedded automation browser) to the main window.
   * The BrowserView occupies the "browser panel" area.
   */
  attachBrowserView(bounds) {
    if (!this.mainWindow) return null;

    // Remove existing view if any
    if (this.browserView) {
      this.mainWindow.removeBrowserView(this.browserView);
    }

    this.browserView = new BrowserView({
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'browser-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        javascript: true,
        partition: 'persist:testflow-browser',
      },
    });

    this.mainWindow.addBrowserView(this.browserView);
    this.browserView.setBounds(bounds);
    this.browserView.setAutoResize({
      width: false,
      height: false,
      horizontal: false,
      vertical: false,
    });

    return this.browserView;
  }

  /**
   * Update the BrowserView bounds when panels resize
   */
  updateBrowserViewBounds(bounds) {
    if (this.browserView && !this._browserViewHidden) {
      this.browserView.setBounds(bounds);
    }
  }

  /**
   * Temporarily hide the BrowserView by removing it from the window.
   * The view itself is NOT destroyed — its webContents stay alive.
   */
  hideBrowserView() {
    if (this.mainWindow && this.browserView && !this._browserViewHidden) {
      this._browserViewHidden = true;
      this._savedBrowserBounds = this.browserView.getBounds();
      this.mainWindow.removeBrowserView(this.browserView);
    }
  }

  /**
   * Restore a previously-hidden BrowserView by re-adding it to the window.
   */
  showBrowserView() {
    if (this.mainWindow && this.browserView && this._browserViewHidden) {
      this._browserViewHidden = false;
      this.mainWindow.addBrowserView(this.browserView);
      if (this._savedBrowserBounds) {
        this.browserView.setBounds(this._savedBrowserBounds);
        delete this._savedBrowserBounds;
      }
    }
  }

  /**
   * Whether the BrowserView is currently hidden
   */
  isBrowserViewHidden() {
    return !!this._browserViewHidden;
  }

  /**
   * Remove the BrowserView (destroys it permanently)
   */
  detachBrowserView() {
    if (this.mainWindow && this.browserView) {
      this.mainWindow.removeBrowserView(this.browserView);
      this.browserView.webContents.destroy();
      this.browserView = null;
    }
  }

  /**
   * Create the floating Mini Inspector window
   */
  createMiniInspectorWindow() {
    if (this.miniInspectorWindow) {
      this.miniInspectorWindow.focus();
      return this.miniInspectorWindow;
    }

    this.miniInspectorWindow = new BrowserWindow({
      width: 380,
      height: 500,
      minWidth: 300,
      minHeight: 300,
      title: 'Mini Inspector',
      parent: this.mainWindow,
      alwaysOnTop: true,
      frame: false,
      transparent: false,
      backgroundColor: '#1e1e2e',
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    this.miniInspectorWindow.loadFile(
      path.join(__dirname, '..', 'renderer', 'mini-inspector.html')
    );

    this.miniInspectorWindow.on('closed', () => {
      this.miniInspectorWindow = null;
    });

    return this.miniInspectorWindow;
  }

  /**
   * Close the Mini Inspector window
   */
  closeMiniInspectorWindow() {
    if (this.miniInspectorWindow) {
      this.miniInspectorWindow.close();
      this.miniInspectorWindow = null;
    }
  }

  // ─── Editor Window (modal BrowserWindow) ──────────────────
  /**
   * Open a modal editor window for editing a test case.
   * @param {Object} payload  { tc, mode }  — mode is 'edit' or 'pagedata'
   */
  openEditorWindow(payload) {
    // If one is already open, focus it
    if (this.editorWindow && !this.editorWindow.isDestroyed()) {
      this.editorWindow.focus();
      return;
    }

    this._editorPayload = payload;

    this.editorWindow = new BrowserWindow({
      width: 740,
      height: 560,
      minWidth: 520,
      minHeight: 400,
      parent: this.mainWindow,
      modal: true,
      show: false,
      frame: false,
      resizable: true,
      backgroundColor: '#1e1e2e',
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'editor-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    this.editorWindow.loadFile(
      path.join(__dirname, '..', 'renderer', 'editor-window.html')
    );

    this.editorWindow.once('ready-to-show', () => {
      this.editorWindow.show();
    });

    this.editorWindow.on('closed', () => {
      this.editorWindow = null;
      this._editorPayload = null;
    });
  }

  /**
   * Returns the payload stored for the editor window (called by the editor's preload).
   */
  getEditorPayload() {
    return this._editorPayload || null;
  }

  /**
   * Close the editor window if open.
   */
  closeEditorWindow() {
    if (this.editorWindow && !this.editorWindow.isDestroyed()) {
      this.editorWindow.close();
    }
    this.editorWindow = null;
    this._editorPayload = null;
  }

  // ─── Report Settings Window (modal BrowserWindow) ─────────
  /**
   * Open a modal window for editing report settings.
   */
  openReportSettingsWindow() {
    if (this.reportSettingsWindow && !this.reportSettingsWindow.isDestroyed()) {
      this.reportSettingsWindow.focus();
      return;
    }

    this.reportSettingsWindow = new BrowserWindow({
      width: 540,
      height: 750,
      minWidth: 440,
      minHeight: 500,
      parent: this.mainWindow,
      modal: true,
      show: false,
      frame: false,
      resizable: true,
      backgroundColor: '#1e1e2e',
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'report-settings-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    this.reportSettingsWindow.loadFile(
      path.join(__dirname, '..', 'renderer', 'report-settings.html')
    );

    this.reportSettingsWindow.once('ready-to-show', () => {
      this.reportSettingsWindow.show();
    });

    this.reportSettingsWindow.on('closed', () => {
      this.reportSettingsWindow = null;
    });
  }

  /**
   * Close the report settings window if open.
   */
  closeReportSettingsWindow() {
    if (this.reportSettingsWindow && !this.reportSettingsWindow.isDestroyed()) {
      this.reportSettingsWindow.close();
    }
    this.reportSettingsWindow = null;
  }

  // ─── Report Progress Window (modal BrowserWindow) ─────────
  /**
   * Open a modal progress window for report generation.
   * Returns a Promise that resolves when the window is fully loaded.
   */
  openReportProgressWindow() {
    if (this.reportProgressWindow && !this.reportProgressWindow.isDestroyed()) {
      this.reportProgressWindow.focus();
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.reportProgressWindow = new BrowserWindow({
        width: 480,
        height: 340,
        minWidth: 400,
        minHeight: 300,
        parent: this.mainWindow,
        modal: true,
        show: false,
        frame: false,
        resizable: false,
        backgroundColor: '#1e1e2e',
        webPreferences: {
          preload: path.join(__dirname, '..', 'preload', 'report-progress-preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
        },
      });

      this.reportProgressWindow.loadFile(
        path.join(__dirname, '..', 'renderer', 'report-progress.html')
      );

      this.reportProgressWindow.webContents.once('did-finish-load', () => {
        this.reportProgressWindow.show();
        resolve();
      });

      this.reportProgressWindow.on('closed', () => {
        this.reportProgressWindow = null;
      });
    });
  }

  /**
   * Send a progress update to the progress window.
   */
  sendProgressUpdate(pct, label) {
    if (this.reportProgressWindow && !this.reportProgressWindow.isDestroyed()) {
      this.reportProgressWindow.webContents.send('report:progress', { pct, label });
    }
  }

  /**
   * Send the final result to the progress window so it transitions to result view.
   */
  sendProgressResult(result) {
    if (this.reportProgressWindow && !this.reportProgressWindow.isDestroyed()) {
      this.reportProgressWindow.webContents.send('report:result', result);
    }
  }

  /**
   * Close the report progress window if open.
   */
  closeReportProgressWindow() {
    if (this.reportProgressWindow && !this.reportProgressWindow.isDestroyed()) {
      this.reportProgressWindow.close();
    }
    this.reportProgressWindow = null;
  }

  // ─── About Window (modal BrowserWindow) ───────────────────
  openAboutWindow() {
    if (this.aboutWindow && !this.aboutWindow.isDestroyed()) {
      this.aboutWindow.focus();
      return;
    }

    this.aboutWindow = new BrowserWindow({
      width: 560,
      height: 680,
      minWidth: 440,
      minHeight: 500,
      parent: this.mainWindow,
      modal: true,
      show: false,
      frame: false,
      resizable: true,
      backgroundColor: '#1e1e2e',
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'about-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    this.aboutWindow.loadFile(
      path.join(__dirname, '..', 'renderer', 'about.html')
    );

    this.aboutWindow.once('ready-to-show', () => {
      this.aboutWindow.show();
    });

    this.aboutWindow.on('closed', () => {
      this.aboutWindow = null;
    });
  }

  closeAboutWindow() {
    if (this.aboutWindow && !this.aboutWindow.isDestroyed()) {
      this.aboutWindow.close();
    }
    this.aboutWindow = null;
  }

  // ─── Shortcuts Window (modal BrowserWindow) ───────────────
  openShortcutsWindow() {
    if (this.shortcutsWindow && !this.shortcutsWindow.isDestroyed()) {
      this.shortcutsWindow.focus();
      return;
    }

    this.shortcutsWindow = new BrowserWindow({
      width: 520,
      height: 620,
      minWidth: 400,
      minHeight: 450,
      parent: this.mainWindow,
      modal: true,
      show: false,
      frame: false,
      resizable: true,
      backgroundColor: '#1e1e2e',
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'shortcuts-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    this.shortcutsWindow.loadFile(
      path.join(__dirname, '..', 'renderer', 'shortcuts.html')
    );

    this.shortcutsWindow.once('ready-to-show', () => {
      this.shortcutsWindow.show();
    });

    this.shortcutsWindow.on('closed', () => {
      this.shortcutsWindow = null;
    });
  }

  closeShortcutsWindow() {
    if (this.shortcutsWindow && !this.shortcutsWindow.isDestroyed()) {
      this.shortcutsWindow.close();
    }
    this.shortcutsWindow = null;
  }

  // ─── Pop-out Panel Windows ─────────────────────────────────

  /**
   * Open a panel in its own separate window (for multi-monitor use).
   * Supported panels: browser, flows, inspector, console, network,
   *                   replay-log, bottom-all, right-all
   */
  openPopoutWindow(panelType) {
    // If this panel is already popped out, focus it
    if (this.popoutWindows[panelType] && !this.popoutWindows[panelType].isDestroyed()) {
      this.popoutWindows[panelType].focus();
      return this.popoutWindows[panelType];
    }

    const sizes = {
      browser:      { width: 1024, height: 768 },
      flows:        { width: 340,  height: 600 },
      inspector:    { width: 420,  height: 600 },
      console:      { width: 800,  height: 400 },
      network:      { width: 900,  height: 450 },
      'replay-log': { width: 900,  height: 500 },
      'bottom-all': { width: 960,  height: 480 },
      'right-all':  { width: 460,  height: 620 },
    };

    const size = sizes[panelType] || { width: 800, height: 600 };

    // Try to position on a second monitor if available
    const displays = screen.getAllDisplays();
    let targetDisplay = displays.length > 1
      ? displays.find(d => d.id !== screen.getPrimaryDisplay().id) || displays[0]
      : displays[0];

    const popoutWindow = new BrowserWindow({
      width: size.width,
      height: size.height,
      x: targetDisplay.workArea.x + 50,
      y: targetDisplay.workArea.y + 50,
      title: `TestFlow — ${panelType.charAt(0).toUpperCase() + panelType.slice(1)}`,
      parent: null,                  // independent window, not modal
      alwaysOnTop: false,
      frame: false,
      backgroundColor: '#1e1e2e',
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'popout-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    popoutWindow.loadFile(
      path.join(__dirname, '..', 'renderer', 'popout-panel.html'),
      { query: { panel: panelType } }
    );

    // For the browser panel, move the BrowserView to this window
    if (panelType === 'browser' && this.browserView && this.mainWindow) {
      popoutWindow.once('ready-to-show', () => {
        // Move BrowserView from main window to popout
        this.mainWindow.removeBrowserView(this.browserView);
        popoutWindow.addBrowserView(this.browserView);

        // Fill the popout window below the title bar (34px)
        const { width, height } = popoutWindow.getContentBounds();
        this.browserView.setBounds({ x: 0, y: 34, width, height: height - 34 });
        this.browserView.setAutoResize({ width: true, height: true });
        this._browserViewHidden = true;
      });

      // Re-layout BrowserView on popout resize
      popoutWindow.on('resize', () => {
        if (this.browserView) {
          const { width, height } = popoutWindow.getContentBounds();
          this.browserView.setBounds({ x: 0, y: 34, width, height: height - 34 });
        }
      });
    }

    popoutWindow.once('ready-to-show', () => {
      popoutWindow.show();
    });

    popoutWindow.on('closed', () => {
      // If this was the browser popout, re-dock automatically
      if (panelType === 'browser') {
        this._dockBrowserView();
      }
      delete this.popoutWindows[panelType];
      // Notify renderer that the panel was docked back
      this.sendToRenderer('popout:docked', panelType);
    });

    this.popoutWindows[panelType] = popoutWindow;
    // Track which panel type each window belongs to (for dock IPC)
    popoutWindow._panelType = panelType;

    // Tell the renderer to hide the panel area since it's popped out
    this.sendToRenderer('popout:opened', panelType);

    return popoutWindow;
  }

  /**
   * Dock a popped-out panel back into the main window.
   * If panelType is not given, it is resolved from the BrowserWindow that sent the IPC.
   */
  dockPopoutWindow(panelType, senderWebContents) {
    let pType = panelType;

    // Resolve from the sender if not explicitly provided
    if (!pType && senderWebContents) {
      for (const [key, win] of Object.entries(this.popoutWindows)) {
        if (win && !win.isDestroyed() && win.webContents === senderWebContents) {
          pType = key;
          break;
        }
      }
    }
    if (!pType) return;

    const win = this.popoutWindows[pType];
    if (!win || win.isDestroyed()) return;

    if (pType === 'browser') {
      this._dockBrowserView();
    }

    win.close();
    // 'closed' handler above cleans up popoutWindows + notifies renderer
  }

  /**
   * Internal: move BrowserView back from popout to main window
   */
  _dockBrowserView() {
    if (!this.browserView || !this.mainWindow) return;

    const popout = this.popoutWindows['browser'];
    if (popout && !popout.isDestroyed()) {
      try {
        popout.removeBrowserView(this.browserView);
      } catch (_e) { /* already removed */ }
    }

    this.browserView.setAutoResize({ width: false, height: false });
    this.mainWindow.addBrowserView(this.browserView);
    this._browserViewHidden = false;

    // Renderer will recalculate bounds on 'popout:docked' event
  }

  /**
   * Get all currently popped-out panel types.
   */
  getActivePopouts() {
    return Object.keys(this.popoutWindows).filter(
      k => this.popoutWindows[k] && !this.popoutWindows[k].isDestroyed()
    );
  }

  /**
   * Get the main window instance
   */
  getMainWindow() {
    return this.mainWindow;
  }

  /**
   * Get the BrowserView instance
   */
  getBrowserView() {
    return this.browserView;
  }

  /**
   * Send a message to the renderer process
   */
  sendToRenderer(channel, ...args) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, ...args);
    }
    // Also forward relevant events to popout windows
    this._forwardToPopouts(channel, ...args);
  }

  /**
   * Forward events to the appropriate popout windows so they get live data.
   */
  _forwardToPopouts(channel, ...args) {
    // Map of channel prefixes → which popout panel types should receive them
    const channelToPopouts = {
      'console:log':               ['console', 'bottom-all'],
      'network:request':           ['network', 'bottom-all'],
      'network:clear':             ['network', 'bottom-all'],
      'inspector:element-hovered': ['inspector', 'right-all'],
      'inspector:element-selected':['inspector', 'right-all'],
      'replay:step-started':       ['replay-log', 'bottom-all'],
      'replay:step-completed':     ['replay-log', 'bottom-all'],
      'replay:started':            ['replay-log', 'bottom-all'],
      'replay:finished':           ['replay-log', 'bottom-all'],
      'replay:error':              ['replay-log', 'bottom-all'],
    };

    const targets = channelToPopouts[channel];
    if (!targets) return;

    const activeKeys = Object.keys(this.popoutWindows).filter(
      k => this.popoutWindows[k] && !this.popoutWindows[k].isDestroyed()
    );

    for (const pType of targets) {
      const win = this.popoutWindows[pType];
      if (win && !win.isDestroyed()) {
        try {
          win.webContents.send(channel, ...args);
          console.log(`[popout-fwd] ✅ Sent ${channel} → ${pType}`);
        } catch (err) {
          console.error(`[popout-fwd] ❌ Failed ${channel} → ${pType}:`, err.message);
        }
      }
    }
  }
}

module.exports = { WindowManager };
