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
    this.reportResultWindow = null;
    this._reportResultPayload = null;
    this._browserViewHidden = false;
    this._savedBrowserBounds = null;
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
      width: 520,
      height: 620,
      minWidth: 420,
      minHeight: 450,
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

  // ─── Report Result Window (modal BrowserWindow) ────────
  /**
   * Open a modal window showing report generation result.
   * @param {Object} payload  { success, reportDir, indexPath, error }
   */
  openReportResultWindow(payload) {
    if (this.reportResultWindow && !this.reportResultWindow.isDestroyed()) {
      this.reportResultWindow.focus();
      return;
    }

    this._reportResultPayload = payload;

    this.reportResultWindow = new BrowserWindow({
      width: 440,
      height: 310,
      minWidth: 360,
      minHeight: 260,
      parent: this.mainWindow,
      modal: true,
      show: false,
      frame: false,
      resizable: false,
      backgroundColor: '#1e1e2e',
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'report-result-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    this.reportResultWindow.loadFile(
      path.join(__dirname, '..', 'renderer', 'report-result.html')
    );

    this.reportResultWindow.once('ready-to-show', () => {
      this.reportResultWindow.show();
    });

    this.reportResultWindow.on('closed', () => {
      this.reportResultWindow = null;
      this._reportResultPayload = null;
    });
  }

  /**
   * Returns the payload stored for the report result window.
   */
  getReportResultPayload() {
    return this._reportResultPayload || null;
  }

  /**
   * Close the report result window if open.
   */
  closeReportResultWindow() {
    if (this.reportResultWindow && !this.reportResultWindow.isDestroyed()) {
      this.reportResultWindow.close();
    }
    this.reportResultWindow = null;
    this._reportResultPayload = null;
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
  }
}

module.exports = { WindowManager };
