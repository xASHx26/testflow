/**
 * TestFlow — Browser Preload Script
 * 
 * Injected into the embedded BrowserView (target website).
 * Provides a safe bridge between injected scripts and the main process.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__testflow_bridge', {
  // Recorder → Main Process
  sendAction: (action) => {
    ipcRenderer.send('recorder:raw-action', action);
  },

  // Inspector → Main Process
  sendInspectorHover: (data) => {
    ipcRenderer.send('inspector:element-hovered', data);
  },

  sendInspectorSelect: (data) => {
    ipcRenderer.send('inspector:element-selected', data);
  },

  // Console → Main Process
  sendConsoleLog: (data) => {
    ipcRenderer.send('console:log', data);
  },

  // Network → Main Process (unused in MVP; network captured at session level)
  sendNetworkRequest: (data) => {
    ipcRenderer.send('network:request', data);
  },

  // Dialog → Main Process (alert/confirm/prompt interception)
  sendDialogEvent: (data) => {
    ipcRenderer.send('testflow:dialog-event', data);
  },

  // Dialog — get response from main process (sync for confirm/prompt)
  sendDialogEventSync: (data) => {
    return ipcRenderer.sendSync('testflow:dialog-event-sync', data);
  },
});
