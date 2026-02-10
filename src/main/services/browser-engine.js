/**
 * TestFlow — Browser Engine
 * 
 * Controls the embedded BrowserView (lightweight Chromium engine).
 * Provides navigation, script injection, DOM inspection, and screenshot capture.
 */

const { BrowserView } = require('electron');
const path = require('path');
const EventEmitter = require('events');

class BrowserEngine extends EventEmitter {
  constructor(mainWindow) {
    super();
    this.mainWindow = mainWindow;
    this.browserView = null;
    this.inspectorEnabled = false;
    this.currentUrl = '';
    this.consoleMessages = [];
    this.networkRequests = [];
  }

  /**
   * Attach a BrowserView to the main window at the given bounds
   */
  attachView(bounds) {
    if (this.browserView) {
      this.mainWindow.removeBrowserView(this.browserView);
    }

    this.browserView = new BrowserView({
      webPreferences: {
        preload: path.join(__dirname, '..', '..', 'preload', 'browser-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        javascript: true,
        webSecurity: true,
      },
    });

    this.mainWindow.addBrowserView(this.browserView);
    this.browserView.setBounds(bounds);
    this.browserView.setAutoResize({ width: false, height: false });

    // Intercept console messages
    this.browserView.webContents.on('console-message', (event, level, message, line, sourceId) => {
      const entry = {
        level: ['verbose', 'info', 'warning', 'error'][level] || 'info',
        message,
        line,
        source: sourceId,
        timestamp: Date.now(),
      };
      this.consoleMessages.push(entry);
      this.emit('console-message', entry);
    });

    // Intercept navigation
    this.browserView.webContents.on('did-navigate', (event, url) => {
      this.currentUrl = url;
      this.emit('navigated', url);
    });

    this.browserView.webContents.on('did-navigate-in-page', (event, url) => {
      this.currentUrl = url;
      this.emit('navigated', url);
    });

    // Auto-inject inspector script after every page load (ready for when user enables it)
    this.browserView.webContents.on('did-finish-load', async () => {
      try {
        await this.injectInspector();
        // Only auto-enable if user has toggled inspector on
        if (this.inspectorEnabled) {
          await this.executeScript('window.__testflow_inspector?.enable()');
        }
      } catch (e) {
        // Non-fatal — page may have redirected
      }
    });

    // Intercept network requests via webRequest API
    this._setupNetworkInterception();

    return true;
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

    await this.browserView.webContents.loadURL(url);
    this.currentUrl = url;
    this.emit('navigated', url);
    return url;
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
    if (this.browserView) {
      this.browserView.setBounds({
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      });
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
   * Setup network request interception
   */
  _setupNetworkInterception() {
    if (!this.browserView) return;

    const filter = { urls: ['*://*/*'] };
    const session = this.browserView.webContents.session;

    session.webRequest.onBeforeRequest(filter, (details, callback) => {
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
      this.networkRequests.push(entry);
      // Trim to prevent memory leak
      if (this.networkRequests.length > 500) {
        this.networkRequests = this.networkRequests.slice(-400);
      }
      callback({});
    });

    session.webRequest.onCompleted(filter, (details) => {
      const entry = this.networkRequests.find(r => r.id === details.id);
      if (entry) {
        entry.statusCode = details.statusCode;
        entry.fromCache = details.fromCache;
        entry.responseHeaders = details.responseHeaders || {};
        entry.duration = Date.now() - entry.startTime;
        this.emit('network-response', { ...entry });
      }
    });

    session.webRequest.onErrorOccurred(filter, (details) => {
      const entry = this.networkRequests.find(r => r.id === details.id);
      if (entry) {
        entry.statusCode = 0;
        entry.error = details.error;
        entry.duration = Date.now() - entry.startTime;
        this.emit('network-response', { ...entry });
      }
    });
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
   * Destroy the browser view
   */
  destroy() {
    if (this.browserView) {
      this.mainWindow.removeBrowserView(this.browserView);
      this.browserView.webContents.destroy();
      this.browserView = null;
    }
  }
}

module.exports = { BrowserEngine };
