/* ================================================================
 *  report-result-preload.js  —  Preload for Report Result window
 * ================================================================ */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('reportResultBridge', {
  /** Get the result payload { success, reportDir, indexPath, error } */
  getData: () => ipcRenderer.invoke('report-result:get-data'),

  /** Tell main process to open the HTML report */
  openReport: (htmlPath) => ipcRenderer.invoke('report-result:open-report', htmlPath),

  /** Tell main process to open the folder */
  openFolder: (folderPath) => ipcRenderer.invoke('report-result:open-folder', folderPath),

  /** Close this window */
  close: () => ipcRenderer.invoke('report-result:close'),
});
