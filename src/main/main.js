/**
 * TestFlow — Main Process Entry Point
 * 
 * Initializes the Electron application, creates the main IDE window,
 * registers all IPC handlers, and bootstraps core services.
 */

const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const { WindowManager } = require('./window-manager');
const { registerIpcHandlers } = require('./ipc-handlers');
const { buildAppMenu } = require('./menu');
const { ProjectManager } = require('./project-manager');
const { BrowserEngine } = require('./services/browser-engine');
const { RecorderEngine } = require('./services/recorder-engine');
const { ReplayEngine } = require('./services/replay-engine');
const { LocatorEngine } = require('./services/locator-engine');
const { FlowEngine } = require('./services/flow-engine');
const { ScreenshotService } = require('./services/screenshot-service');
const { FreezeService } = require('./services/freeze-service');
const { ExportEngine } = require('./services/export-engine');
const { ShareService } = require('./services/share-service');
const { AuthService } = require('./services/auth-service');

// ─── Application Singleton Context ───────────────────────────────
const context = {
  windowManager: null,
  projectManager: null,
  browserEngine: null,
  recorderEngine: null,
  replayEngine: null,
  locatorEngine: null,
  flowEngine: null,
  screenshotService: null,
  freezeService: null,
  exportEngine: null,
  shareService: null,
  authService: null,
};

// ─── App Lifecycle ───────────────────────────────────────────────
app.whenReady().then(async () => {
  // Content Security Policy — only for the IDE renderer, not for the embedded BrowserView.
  // We store the renderer's webContents id after the window is created and filter on it.

  // Initialize services
  context.projectManager = new ProjectManager();
  context.locatorEngine = new LocatorEngine();
  context.flowEngine = new FlowEngine(context.projectManager);
  context.screenshotService = new ScreenshotService(context.projectManager);
  context.freezeService = new FreezeService();
  context.exportEngine = new ExportEngine();
  context.shareService = new ShareService();
  context.authService = new AuthService();

  // Window management
  context.windowManager = new WindowManager();
  const mainWindow = context.windowManager.createMainWindow();

  // Apply CSP only to the IDE renderer, not to the embedded BrowserView (target sites).
  const rendererWebContentsId = mainWindow.webContents.id;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.webContentsId === rendererWebContentsId) {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:;"
          ]
        }
      });
    } else {
      // Let embedded BrowserView (target sites) load normally — no CSP override
      callback({ responseHeaders: details.responseHeaders });
    }
  });

  // Browser engine requires the main window for BrowserView embedding
  context.browserEngine = new BrowserEngine(mainWindow);
  context.recorderEngine = new RecorderEngine(context.browserEngine, context.locatorEngine, context.flowEngine);
  context.replayEngine = new ReplayEngine(context.browserEngine, context.locatorEngine);

  // Register IPC handlers (renderer ↔ main bridge)
  registerIpcHandlers(context);

  // Build application menu
  buildAppMenu(context);

  // Load the IDE renderer
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    context.windowManager.createMainWindow();
  }
});

// Prevent navigation in main window (security)
app.on('web-contents-created', (event, contents) => {
  contents.on('will-navigate', (navEvent, url) => {
    // Only allow navigation in the embedded browser view
    if (contents.getType() !== 'browserView') {
      navEvent.preventDefault();
    }
  });
});

process.on('uncaughtException', (error) => {
  console.error('[TestFlow] Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('[TestFlow] Unhandled rejection:', reason);
});
