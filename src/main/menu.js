/**
 * TestFlow — Application Menu
 * 
 * Defines the native application menu with all TestFlow-specific actions.
 */

const { Menu, globalShortcut } = require('electron');

function buildAppMenu(context) {
  const { windowManager, recorderEngine, freezeService, browserEngine } = context;

  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Project',
          accelerator: 'CmdOrCtrl+N',
          click: () => windowManager.sendToRenderer('menu:new-project'),
        },
        {
          label: 'Open Project',
          accelerator: 'CmdOrCtrl+O',
          click: () => windowManager.sendToRenderer('menu:open-project'),
        },
        {
          label: 'Save Project',
          accelerator: 'CmdOrCtrl+S',
          click: () => windowManager.sendToRenderer('menu:save-project'),
        },
        { type: 'separator' },
        {
          label: 'Import Package',
          click: () => windowManager.sendToRenderer('menu:import-package'),
        },
        {
          label: 'Export Package (View)',
          click: () => windowManager.sendToRenderer('menu:export-package', 'view'),
        },
        {
          label: 'Export Package (Edit)',
          click: () => windowManager.sendToRenderer('menu:export-package', 'edit'),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Recording',
      submenu: [
        {
          label: 'Start Recording',
          accelerator: 'F2',
          click: () => windowManager.sendToRenderer('menu:recorder-start'),
        },
        {
          label: 'Stop Recording',
          accelerator: 'Shift+F2',
          click: () => windowManager.sendToRenderer('menu:recorder-stop'),
        },
        {
          label: 'Pause/Resume Recording',
          accelerator: 'F3',
          click: () => windowManager.sendToRenderer('menu:recorder-toggle-pause'),
        },
        { type: 'separator' },
        {
          label: 'Start Replay',
          accelerator: 'F5',
          click: () => windowManager.sendToRenderer('menu:replay-start'),
        },
        {
          label: 'Stop Replay',
          accelerator: 'Shift+F5',
          click: () => windowManager.sendToRenderer('menu:replay-stop'),
        },
        {
          label: 'Step Over',
          accelerator: 'F10',
          click: () => windowManager.sendToRenderer('menu:replay-step'),
        },
      ],
    },
    {
      label: 'Tools',
      submenu: [
        {
          label: 'Freeze Website',
          accelerator: 'F4',
          click: () => windowManager.sendToRenderer('menu:freeze-toggle'),
        },
        {
          label: 'Capture Screenshot',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => windowManager.sendToRenderer('menu:screenshot'),
        },
        { type: 'separator' },
        {
          label: 'Toggle Mini Inspector',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => windowManager.sendToRenderer('menu:mini-inspector-toggle'),
        },
        {
          label: 'Toggle Element Inspector',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => windowManager.sendToRenderer('menu:inspector-toggle'),
        },
      ],
    },
    {
      label: 'Workspace',
      submenu: [
        {
          label: 'Recorder Mode',
          click: () => windowManager.sendToRenderer('menu:workspace-preset', 'recorder'),
        },
        {
          label: 'Inspector Mode',
          click: () => windowManager.sendToRenderer('menu:workspace-preset', 'inspector'),
        },
        {
          label: 'Debug Mode',
          click: () => windowManager.sendToRenderer('menu:workspace-preset', 'debug'),
        },
        {
          label: 'Review Mode',
          click: () => windowManager.sendToRenderer('menu:workspace-preset', 'review'),
        },
        { type: 'separator' },
        {
          label: 'Browser Only',
          click: () => windowManager.sendToRenderer('menu:workspace-preset', 'browser-only'),
        },
        {
          label: 'Browser + Inspector',
          click: () => windowManager.sendToRenderer('menu:workspace-preset', 'browser-inspector'),
        },
        {
          label: 'Browser + Flows',
          click: () => windowManager.sendToRenderer('menu:workspace-preset', 'browser-flows'),
        },
        {
          label: 'Compact',
          click: () => windowManager.sendToRenderer('menu:workspace-preset', 'compact'),
        },
        {
          label: 'Full IDE',
          click: () => windowManager.sendToRenderer('menu:workspace-preset', 'full'),
        },
        { type: 'separator' },
        {
          label: 'Pop Out Browser',
          accelerator: 'CmdOrCtrl+Shift+B',
          click: () => windowManager.sendToRenderer('menu:popout-panel', 'browser'),
        },
        {
          label: 'Pop Out Inspector',
          click: () => windowManager.sendToRenderer('menu:popout-panel', 'inspector'),
        },
        {
          label: 'Pop Out Console',
          click: () => windowManager.sendToRenderer('menu:popout-panel', 'console'),
        },
      ],
    },
    {
      label: 'Export',
      submenu: [
        {
          label: 'Selenium (Python)',
          click: () => windowManager.sendToRenderer('menu:export-selenium-python'),
        },
        {
          label: 'Markdown Report',
          click: () => windowManager.sendToRenderer('menu:export-markdown'),
        },
        { type: 'separator' },
        {
          label: 'JSON Flow Data',
          click: () => windowManager.sendToRenderer('menu:export-json'),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Console',
          accelerator: 'CmdOrCtrl+`',
          click: () => windowManager.sendToRenderer('menu:toggle-console'),
        },
        {
          label: 'Toggle Network Panel',
          click: () => windowManager.sendToRenderer('menu:toggle-network'),
        },
        { type: 'separator' },
        {
          label: 'Developer Tools (IDE)',
          accelerator: 'Ctrl+Shift+I',
          click: (menuItem, browserWindow) => {
            if (browserWindow) {
              browserWindow.webContents.toggleDevTools({ mode: 'detach' });
            }
          },
        },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Options',
      submenu: [
        {
          label: 'Report Settings',
          click: () => windowManager.openReportSettingsWindow(),
        },
        {
          label: 'Keyboard Shortcuts',
          accelerator: 'CmdOrCtrl+K',
          click: () => windowManager.openShortcutsWindow(),
        },
        { type: 'separator' },
        {
          label: 'About TestFlow',
          click: () => windowManager.openAboutWindow(),
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

module.exports = { buildAppMenu };
