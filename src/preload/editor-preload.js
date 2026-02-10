/**
 * TestFlow — Editor Window Preload
 *
 * Minimal preload for the modal test-case editor window.
 * Exposes IPC channels so the editor can receive the test case data,
 * send back edits, and close itself.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('editorBridge', {
  /** Receive the test case data when the window is ready */
  getData: () => ipcRenderer.invoke('editor:get-data'),

  /** Send the edited test case back and optionally trigger replay */
  save: (editedTc, andReplay) => ipcRenderer.invoke('editor:save', editedTc, andReplay),

  /** Close the editor window without saving */
  close: () => ipcRenderer.invoke('editor:close'),
});
