/**
 * TestFlow — Freeze Service
 * 
 * Freezes the embedded browser by pausing JS execution and DOM mutations.
 * Allows accurate element inspection on dynamic UIs.
 */

class FreezeService {
  constructor() {
    this._frozen = false;
  }

  /**
   * Toggle freeze state
   */
  async toggle(browserEngine) {
    if (this._frozen) {
      return this.unfreeze(browserEngine);
    } else {
      return this.freeze(browserEngine);
    }
  }

  /**
   * Freeze: pause all timers, intervals, mutation observers, animations
   */
  async freeze(browserEngine) {
    await browserEngine.executeScript(`
      (() => {
        if (window.__testflow_frozen) return;
        window.__testflow_frozen = true;

        // Store originals
        window.__testflow_freeze_originals = {
          setTimeout: window.setTimeout,
          setInterval: window.setInterval,
          requestAnimationFrame: window.requestAnimationFrame,
          MutationObserver: window.MutationObserver,
        };

        // Pause all future timers
        const pendingTimeouts = [];
        window.setTimeout = (fn, delay, ...args) => {
          const id = window.__testflow_freeze_originals.setTimeout(() => {}, 999999999);
          pendingTimeouts.push({ id, fn, delay, args });
          return id;
        };

        window.setInterval = (fn, delay, ...args) => {
          return -1; // Block new intervals
        };

        window.requestAnimationFrame = (fn) => {
          return -1; // Block new animation frames
        };

        // Stop mutation observers
        window.MutationObserver = class FrozenMutationObserver {
          observe() {}
          disconnect() {}
          takeRecords() { return []; }
        };

        // Pause CSS animations
        document.documentElement.style.setProperty('--testflow-freeze', 'paused');
        const style = document.createElement('style');
        style.id = '__testflow_freeze_style';
        style.textContent = '*, *::before, *::after { animation-play-state: paused !important; transition: none !important; }';
        document.head.appendChild(style);

        // Visual indicator
        const indicator = document.createElement('div');
        indicator.id = '__testflow_freeze_indicator';
        indicator.style.cssText = 'position:fixed;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,#00d4ff,#0099ff,#00d4ff);z-index:999999;animation:none;';
        document.body.appendChild(indicator);

        window.__testflow_pending_timeouts = pendingTimeouts;
      })()
    `);

    this._frozen = true;
    return { frozen: true };
  }

  /**
   * Unfreeze: restore all original behavior
   */
  async unfreeze(browserEngine) {
    await browserEngine.executeScript(`
      (() => {
        if (!window.__testflow_frozen) return;

        // Restore originals
        if (window.__testflow_freeze_originals) {
          window.setTimeout = window.__testflow_freeze_originals.setTimeout;
          window.setInterval = window.__testflow_freeze_originals.setInterval;
          window.requestAnimationFrame = window.__testflow_freeze_originals.requestAnimationFrame;
          window.MutationObserver = window.__testflow_freeze_originals.MutationObserver;
        }

        // Remove freeze style
        const style = document.getElementById('__testflow_freeze_style');
        if (style) style.remove();

        // Remove indicator
        const indicator = document.getElementById('__testflow_freeze_indicator');
        if (indicator) indicator.remove();

        window.__testflow_frozen = false;
        delete window.__testflow_freeze_originals;
        delete window.__testflow_pending_timeouts;
      })()
    `);

    this._frozen = false;
    return { frozen: false };
  }

  /**
   * Get the current freeze state
   */
  isFrozen() {
    return this._frozen;
  }
}

module.exports = { FreezeService };
