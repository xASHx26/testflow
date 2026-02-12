/**
 * TestFlow — Console Panel
 * 
 * Renders console output from the target website,
 * supports log levels and clearing.
 */

class ConsolePanel {
  constructor() {
    this.consoleOutput = document.getElementById('console-output');
    this.maxEntries = 500;
    this.entries = [];

    this._listen();
    this._bindClear();
  }

  _listen() {
    // From toolbar / other modules (in-renderer EventBus)
    window.EventBus.on('console:log', (data) => this._addEntry(data));

    // From main process IPC (BrowserView console-message, browser-preload inject)
    window.testflow.on('console:log', (data) => this._addEntry(data));
  }

  _bindClear() {
    const clearBtn = document.getElementById('btn-clear-console');
    if (clearBtn) {
      clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.clear();
      });
    }
  }

  addEntry(level, message, source) {
    this._addEntry({ level, message, source, timestamp: Date.now() });
  }

  _addEntry(data) {
    const { level = 'log', message = '', timestamp = Date.now(), source = '' } = data;

    // Keep buffer bounded
    if (this.entries.length >= this.maxEntries) {
      this.entries.shift();
      if (this.consoleOutput.firstChild) {
        this.consoleOutput.removeChild(this.consoleOutput.firstChild);
      }
    }

    this.entries.push(data);

    const line = document.createElement('div');
    line.className = `console-line console-${level}`;

    const time = new Date(timestamp);
    const ts = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}:${String(time.getSeconds()).padStart(2, '0')}`;

    line.innerHTML = `
      <span class="console-time">${ts}</span>
      <span class="console-level">${this._levelIcon(level)}</span>
      <span class="console-msg">${this._esc(message)}</span>
      ${source ? `<span class="console-source">${this._esc(source)}</span>` : ''}
    `;

    this.consoleOutput.appendChild(line);
    this.consoleOutput.scrollTop = this.consoleOutput.scrollHeight;

    // Update badge count
    this._updateBadge();
  }

  clear() {
    this.entries = [];
    this.consoleOutput.innerHTML = '';
    this._updateBadge();
  }

  _updateBadge() {
    const tab = document.querySelector('[data-tab="console"]');
    if (!tab) return;
    let badge = tab.querySelector('.badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'badge';
      tab.appendChild(badge);
    }
    badge.textContent = this.entries.length || '';
    badge.style.display = this.entries.length > 0 ? '' : 'none';
  }

  _levelIcon(level) {
    const map = {
      log: 'ℹ️', info: 'ℹ️', warn: '⚠️', warning: '⚠️',
      error: '❌', debug: '🐛', recorder: '🔴', replay: '▶️'
    };
    return map[level] || 'ℹ️';
  }

  _esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }
}

window.ConsolePanel = new ConsolePanel();
