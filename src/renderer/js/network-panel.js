/**
 * TestFlow — Network Panel
 * 
 * Renders intercepted network requests from the target site
 * in a sortable table with method, status, type, and timing info.
 */

class NetworkPanel {
  constructor() {
    this.networkBody = document.getElementById('network-body');
    this.maxEntries = 300;
    this.requests = [];

    this._listen();
  }

  _listen() {
    window.testflow.on('network:request', (data) => this._addRequest(data));
    window.testflow.on('network:clear', () => this.clear());
  }

  _addRequest(data) {
    const {
      url = '', method = 'GET', statusCode = 0,
      resourceType = 'other', timestamp = Date.now(),
      responseHeaders = {}, duration = 0, error = null
    } = data;

    if (this.requests.length >= this.maxEntries) {
      this.requests.shift();
      if (this.networkBody.firstChild) {
        this.networkBody.removeChild(this.networkBody.firstChild);
      }
    }

    this.requests.push(data);

    const row = document.createElement('tr');
    row.className = 'network-row';
    if (statusCode >= 400 || error) row.classList.add('network-error');

    const shortUrl = this._shortenUrl(url);
    // Electron responseHeaders values are arrays, e.g. ['12345']
    const rawLen = responseHeaders['content-length'];
    const contentLen = Array.isArray(rawLen) ? rawLen[0] : rawLen;
    const size = this._formatSize(contentLen);
    const statusDisplay = error ? 'ERR' : (statusCode || '—');

    row.innerHTML = `
      <td class="net-method net-method-${method.toLowerCase()}">${method}</td>
      <td class="net-url" title="${this._esc(url)}">${this._esc(shortUrl)}</td>
      <td class="net-status ${this._statusClass(statusCode)}">${statusDisplay}</td>
      <td class="net-type">${this._esc(resourceType)}</td>
      <td class="net-size">${size}</td>
      <td class="net-time">${duration ? duration + ' ms' : '—'}</td>
    `;

    this.networkBody.appendChild(row);
    this.networkBody.parentElement.scrollTop = this.networkBody.parentElement.scrollHeight;

    this._updateBadge();
  }

  clear() {
    this.requests = [];
    this.networkBody.innerHTML = '';
    this._updateBadge();
  }

  /**
   * Load a saved array of requests into the panel (replaces current view).
   */
  loadRequests(requests) {
    this.clear();
    if (!requests || !requests.length) return;
    for (const req of requests) {
      this._addRequest(req);
    }
  }

  /**
   * Return a copy of all captured requests (used to snapshot network log per test).
   */
  getRequests() {
    return this.requests.map(r => ({
      method: r.method,
      url: r.url,
      statusCode: r.statusCode,
      resourceType: r.resourceType,
      duration: r.duration,
      fromCache: r.fromCache,
      error: r.error || null,
    }));
  }

  _updateBadge() {
    const tab = document.querySelector('[data-tab="network"]');
    if (!tab) return;
    let badge = tab.querySelector('.badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'badge';
      tab.appendChild(badge);
    }
    badge.textContent = this.requests.length || '';
    badge.style.display = this.requests.length > 0 ? '' : 'none';
  }

  _shortenUrl(url) {
    try {
      const u = new URL(url);
      return u.pathname + u.search;
    } catch {
      return url.length > 60 ? url.substring(0, 57) + '…' : url;
    }
  }

  _formatSize(bytes) {
    if (!bytes) return '—';
    const b = parseInt(bytes);
    if (isNaN(b)) return '—';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(1) + ' MB';
  }

  _statusClass(code) {
    if (!code) return '';
    if (code >= 500) return 'status-5xx';
    if (code >= 400) return 'status-4xx';
    if (code >= 300) return 'status-3xx';
    if (code >= 200) return 'status-2xx';
    return '';
  }

  _esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }
}

window.NetworkPanel = new NetworkPanel();
