/**
 * TestFlow — Event Bus
 * 
 * Central event bus for state synchronization across all renderer modules.
 */

class EventBus {
  constructor() {
    this._listeners = {};
  }

  on(event, callback) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
  }

  emit(event, ...args) {
    if (!this._listeners[event]) return;
    this._listeners[event].forEach(cb => {
      try {
        cb(...args);
      } catch (err) {
        console.error(`[EventBus] Error in ${event} handler:`, err);
      }
    });
  }

  once(event, callback) {
    const wrapper = (...args) => {
      this.off(event, wrapper);
      callback(...args);
    };
    this.on(event, wrapper);
  }
}

window.EventBus = new EventBus();
