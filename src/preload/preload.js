/**
 * TestFlow — Main Window Preload Script
 * 
 * Exposes a safe API to the renderer process via contextBridge.
 * The renderer uses window.testflow.* to communicate with the main process.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('testflow', {
  // ─── Project ───────────────────────────────────────────────
  project: {
    new: (name) => ipcRenderer.invoke('project:new', name),
    open: () => ipcRenderer.invoke('project:open'),
    save: () => ipcRenderer.invoke('project:save'),
    getInfo: () => ipcRenderer.invoke('project:getInfo'),
    saveState: (state) => ipcRenderer.invoke('project:saveState', state),
    loadState: () => ipcRenderer.invoke('project:loadState'),
  },

  // ─── Browser ───────────────────────────────────────────────
  browser: {
    navigate: (url) => ipcRenderer.invoke('browser:navigate', url),
    back: () => ipcRenderer.invoke('browser:back'),
    forward: () => ipcRenderer.invoke('browser:forward'),
    reload: () => ipcRenderer.invoke('browser:reload'),
    getUrl: () => ipcRenderer.invoke('browser:getUrl'),
    attachView: (bounds) => ipcRenderer.invoke('browser:attachView', bounds),
    updateBounds: (bounds) => ipcRenderer.invoke('browser:updateBounds', bounds),
    hide: () => ipcRenderer.invoke('browser:hide'),
    show: () => ipcRenderer.invoke('browser:show'),
    onNavigated: (callback) => ipcRenderer.on('browser:navigated', (_, url) => callback(url)),
  },

  // ─── Recorder ──────────────────────────────────────────────
  recorder: {
    start: (flowId) => ipcRenderer.invoke('recorder:start', flowId),
    stop: () => ipcRenderer.invoke('recorder:stop'),
    pause: () => ipcRenderer.invoke('recorder:pause'),
    resume: () => ipcRenderer.invoke('recorder:resume'),
    getState: () => ipcRenderer.invoke('recorder:getState'),
    onAction: (callback) => ipcRenderer.on('recorder:action-recorded', (_, data) => callback(data)),
  },

  // ─── Replay ────────────────────────────────────────────────
  replay: {
    start: (flowId) => ipcRenderer.invoke('replay:start', flowId),
    stop: () => ipcRenderer.invoke('replay:stop'),
    stepOver: () => ipcRenderer.invoke('replay:stepOver'),
    getState: () => ipcRenderer.invoke('replay:getState'),
    runTestCase: (testCase) => ipcRenderer.invoke('replay:testcase', testCase),
    onStepComplete: (callback) => ipcRenderer.on('replay:step-complete', (_, data) => callback(data)),
    onStepStarted: (callback) => ipcRenderer.on('replay:step-started', (_, data) => callback(data)),
    onStepCompleted: (callback) => ipcRenderer.on('replay:step-completed', (_, data) => callback(data)),
    onStarted: (callback) => ipcRenderer.on('replay:started', (_, data) => callback(data)),
    onFinished: (callback) => ipcRenderer.on('replay:finished', (_, data) => callback(data)),
    onError: (callback) => ipcRenderer.on('replay:error', (_, data) => callback(data)),
  },

  // ─── Test Case ─────────────────────────────────────────────
  testcase: {
    onGenerated: (callback) => ipcRenderer.on('testcase:generated', (_, data) => callback(data)),
  },

  // ─── Editor Window ─────────────────────────────────────────
  editor: {
    open: (payload) => ipcRenderer.invoke('editor:open', payload),
    onSaved: (callback) => ipcRenderer.on('editor:saved', (_, data) => callback(data)),
  },

  // ─── Locator ───────────────────────────────────────────────
  locator: {
    generate: (elementData) => ipcRenderer.invoke('locator:generate', elementData),
    rank: (locators) => ipcRenderer.invoke('locator:rank', locators),
    validate: (locator) => ipcRenderer.invoke('locator:validate', locator),
  },

  // ─── Flow ──────────────────────────────────────────────────
  flow: {
    create: (name) => ipcRenderer.invoke('flow:create', name),
    getAll: () => ipcRenderer.invoke('flow:getAll'),
    get: (flowId) => ipcRenderer.invoke('flow:get', flowId),
    addStep: (flowId, step) => ipcRenderer.invoke('flow:addStep', flowId, step),
    updateStep: (flowId, stepId, updates) => ipcRenderer.invoke('flow:updateStep', flowId, stepId, updates),
    removeStep: (flowId, stepId) => ipcRenderer.invoke('flow:removeStep', flowId, stepId),
    reorderSteps: (flowId, ids) => ipcRenderer.invoke('flow:reorderSteps', flowId, ids),
    toggleStep: (flowId, stepId, enabled) => ipcRenderer.invoke('flow:toggleStep', flowId, stepId, enabled),
    delete: (flowId) => ipcRenderer.invoke('flow:delete', flowId),
    rename: (flowId, newName) => ipcRenderer.invoke('flow:rename', flowId, newName),
    setActive: (flowId) => ipcRenderer.invoke('flow:setActive', flowId),
  },

  // ─── Screenshot ────────────────────────────────────────────
  screenshot: {
    capture: (options) => ipcRenderer.invoke('screenshot:capture', options),
    captureElement: (selector, options) => ipcRenderer.invoke('screenshot:captureElement', selector, options),
  },

  // ─── Freeze ────────────────────────────────────────────────
  freeze: {
    toggle: () => ipcRenderer.invoke('freeze:toggle'),
    getState: () => ipcRenderer.invoke('freeze:getState'),
  },

  // ─── Inspector ─────────────────────────────────────────────
  inspector: {
    enable: () => ipcRenderer.invoke('inspector:enable'),
    disable: () => ipcRenderer.invoke('inspector:disable'),
    getElementInfo: (point) => ipcRenderer.invoke('inspector:getElementInfo', point),
    onHover: (callback) => ipcRenderer.on('inspector:element-hovered', (_, data) => callback(data)),
    onSelect: (callback) => ipcRenderer.on('inspector:element-selected', (_, data) => callback(data)),
  },

  // ─── Mini Inspector ────────────────────────────────────────
  miniInspector: {
    toggle: () => ipcRenderer.invoke('mini-inspector:toggle'),
  },

  // ─── Export ────────────────────────────────────────────────
  export: {
    validate: (flowId) => ipcRenderer.invoke('export:validate', flowId),
    seleniumPython: (flowId, options) => ipcRenderer.invoke('export:selenium-python', flowId, options),
    markdown: (flowId) => ipcRenderer.invoke('export:markdown', flowId),
    json: (flowId) => ipcRenderer.invoke('export:json', flowId),
  },

  // ─── Share ─────────────────────────────────────────────────
  share: {
    package: (mode) => ipcRenderer.invoke('share:package', mode),
    import: () => ipcRenderer.invoke('share:import'),
  },

  // ─── Workspace ─────────────────────────────────────────────
  workspace: {
    setPreset: (preset) => ipcRenderer.invoke('workspace:setPreset', preset),
  },

  // ─── Event Listeners (from main process / menu) ────────────
  on: (channel, callback) => {
    const validChannels = [
      'menu:new-project', 'menu:open-project', 'menu:save-project',
      'menu:import-package', 'menu:export-package',
      'menu:recorder-start', 'menu:recorder-stop', 'menu:recorder-toggle-pause',
      'menu:replay-start', 'menu:replay-stop', 'menu:replay-step',
      'menu:freeze-toggle', 'menu:screenshot',
      'menu:mini-inspector-toggle', 'menu:inspector-toggle',
      'menu:workspace-preset',
      'menu:export-selenium-python', 'menu:export-markdown', 'menu:export-json',
      'menu:toggle-console', 'menu:toggle-network',
      'menu:about', 'menu:shortcuts',
      'console:log', 'network:request', 'network:clear',
      'workspace:preset-changed',
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (_, ...args) => callback(...args));
    }
  },

  removeListener: (channel, callback) => {
    ipcRenderer.removeListener(channel, callback);
  },
});
