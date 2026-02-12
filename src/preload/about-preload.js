/* ================================================================
 *  about-preload.js  —  Preload for About TestFlow window
 * ================================================================ */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aboutBridge', {
  /** Get system info (versions, platform, etc.) */
  getSystemInfo: () => ipcRenderer.invoke('about:getSystemInfo'),

  /** Open a URL in the default browser */
  openExternal: (url) => ipcRenderer.invoke('about:openExternal', url),

  /** Close this window */
  close: () => ipcRenderer.invoke('about:close'),
});
