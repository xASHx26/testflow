/**
 * TestFlow — Pop-out Panel Preload Script
 *
 * Exposes a minimal API for the pop-out panel window to dock back
 * and to receive forwarded events (console, network, inspector, replay).
 */

const { contextBridge, ipcRenderer } = require('electron');

// Track received events for debugging
const _receivedEvents = [];

contextBridge.exposeInMainWorld('popoutApi', {
  dock: () => ipcRenderer.invoke('popout:dock'),
  getPanel: () => ipcRenderer.invoke('popout:getPanel'),

  // Generic event listener for forwarded events
  on: (channel, callback) => {
    const validChannels = [
      'console:log', 'network:request', 'network:clear',
      'inspector:element-hovered', 'inspector:element-selected',
      'replay:step-started', 'replay:step-completed',
      'replay:started', 'replay:finished', 'replay:error',
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (_, ...args) => {
        _receivedEvents.push({ channel, time: Date.now() });
        callback(...args);
      });
    }
  },

  // Debug: get list of received events
  getReceivedEvents: () => [..._receivedEvents],

  // Debug: request a test event from main
  requestTestEvent: () => ipcRenderer.invoke('popout:testEvent'),
});
