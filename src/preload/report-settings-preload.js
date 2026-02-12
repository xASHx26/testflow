/* ================================================================
 *  report-settings-preload.js  —  Preload for Report Settings window
 * ================================================================ */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('reportSettingsBridge', {
  /** Retrieve current report settings */
  getSettings: () => ipcRenderer.invoke('report-settings:get-data'),

  /** Save updated settings (partial merge) */
  save: (partial) => ipcRenderer.invoke('report-settings:save', partial),

  /** Reset settings to defaults and return them */
  reset: () => ipcRenderer.invoke('report-settings:reset'),

  /** Close the settings window */
  close: () => ipcRenderer.invoke('report-settings:close'),
});
