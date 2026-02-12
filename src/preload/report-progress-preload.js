/* ================================================================
 *  report-progress-preload.js  —  Preload for Report Progress window
 * ================================================================ */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('reportProgressBridge', {
  /** Listen for progress updates { pct, label } */
  onProgress: (callback) => {
    ipcRenderer.on('report:progress', (_, data) => callback(data));
  },

  /** Listen for the final result { success, reportDir, indexPath, error } */
  onResult: (callback) => {
    ipcRenderer.on('report:result', (_, data) => callback(data));
  },

  /** Tell main process to open the HTML report */
  openReport: (htmlPath) => ipcRenderer.invoke('report-progress:open-report', htmlPath),

  /** Tell main process to open the folder */
  openFolder: (folderPath) => ipcRenderer.invoke('report-progress:open-folder', folderPath),

  /** Close this window */
  close: () => ipcRenderer.invoke('report-progress:close'),
});
