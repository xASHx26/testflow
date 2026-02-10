/**
 * TestFlow — Freeze Inject Script
 * 
 * Injected into the embedded browser to support Freeze Mode.
 * Provides the freeze indicator and coordinates with the FreezeService.
 * (Main freeze logic is in freeze-service.js; this provides visual hooks.)
 */

(function () {
  'use strict';

  if (window.__testflow_freeze) return;

  window.__testflow_freeze = {
    isFrozen() {
      return !!window.__testflow_frozen;
    },

    getState() {
      return {
        frozen: !!window.__testflow_frozen,
        timestamp: Date.now(),
        url: window.location.href,
      };
    },
  };
})();
