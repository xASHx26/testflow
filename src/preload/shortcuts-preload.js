/* ================================================================
 *  shortcuts-preload.js  —  Preload for Keyboard Shortcuts window
 * ================================================================ */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shortcutsBridge', {
  /** Close this window */
  close: () => ipcRenderer.invoke('shortcuts:close'),
});
