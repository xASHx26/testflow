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
      icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    });

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
