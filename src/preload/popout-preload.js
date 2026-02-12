/**
 * TestFlow — Pop-out Panel Preload Script
 *
 * Exposes a minimal API for the pop-out panel window to dock back.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('popoutApi', {
  dock: () => ipcRenderer.invoke('popout:dock'),
  getPanel: () => ipcRenderer.invoke('popout:getPanel'),
});
