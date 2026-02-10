/**
 * TestFlow — Inspector UI
 *
 * Accumulates inspected elements and locators in the Inspector tab.
 * Test data in the Test Data tab.
 * Each entry can be renamed, edited, or deleted.
 * Test data can be exported as JSON.
 */

class InspectorUI {
  constructor() {
    this.elements = [];     // { id, label, data, locators[] }
    this.testDataRows = []; // { id, key, value, source }

    this._counter = 0;

    this.elementDisplay = document.getElementById('inspector-content');
    this.locatorList    = document.getElementById('locator-list');
    this.testDataContainer = document.getElementById('testdata-content');

    this._listen();
    this._renderElements();
    this._renderTestData();
  }

  _uid() { return `iui-${++this._counter}-${Date.now()}`; }

  _listen() {
    window.EventBus.on('step:selected', (step) => this._importStep(step));

    if (window.testflow?.inspector?.onHover) {
      window.testflow.inspector.onHover((data) => this._showPreview(data));
    }
    if (window.testflow?.inspector?.onSelect) {
      window.testflow.inspector.onSelect((data) => this._captureElement(data));
    }
  }

  // ─── Preview (hover) ─────────────────────────────────────
  _showPreview(data) {
    let strip = this.elementDisplay.querySelector('.inspector-live-preview');
    if (!strip) {
      strip = document.createElement('div');
      strip.className = 'inspector-live-preview';
      this.elementDisplay.prepend(strip);
    }
    if (!data) { strip.textContent = ''; return; }
    strip.innerHTML = `<span class="preview-tag">&lt;${this._esc(data.tag || '?')}${data.id ? '#' + this._esc(data.id) : ''}${data.classes ? '.' + this._esc(data.classes.split(' ')[0]) : ''}&gt;</span>`;
  }

  // ─── Capture element (click in inspector) ────────────────
  async _captureElement(data) {
    if (!data) return;

    const label = data.id || data.name || data.tag || 'Element';
    const entry = { id: this._uid(), label, data: { ...data }, locators: [] };

    // Generate locators
    try {
      const locs = await window.testflow.locator.generate(data);
      if (locs && locs.length) {
        entry.locators = locs.map(loc => ({
          id: this._uid(),
          strategy: loc.strategy,
          value: loc.value,
          confidence: loc.confidence
        }));
      }
    } catch (e) { console.error('Locator gen failed', e); }

    this.elements.push(entry);
    this._renderElements();

    // Extract test data
    this._extractTestData(data, label);
  }

  // ─── Import from step selection ──────────────────────────
  _importStep(step) {
    if (!step) return;
    if (step.element) {
      const label = step.element.id || step.element.name || step.element.tag || 'Step Element';
      const entry = { id: this._uid(), label, data: { ...step.element }, locators: [] };
      if (step.locators && step.locators.length) {
        entry.locators = step.locators.map(loc => ({
          id: this._uid(), strategy: loc.strategy, value: loc.value, confidence: loc.confidence
        }));
      }
      this.elements.push(entry);
      this._renderElements();
    }
    if (step.testData) {
      const arr = Array.isArray(step.testData) ? step.testData
        : Object.entries(step.testData).map(([k, v]) => ({ key: k, value: String(v), source: 'step' }));
      arr.forEach(td => this.testDataRows.push({ id: this._uid(), key: td.key, value: td.value, source: td.source || 'step' }));
      this._renderTestData();
    }
  }

  // ════════════════════════════════════════════════════════════
  //  INSPECTOR TAB  (elements + locators combined)
  // ════════════════════════════════════════════════════════════
  _renderElements() {
    this.elementDisplay.innerHTML = '';

    const bar = this._actionBar([
      { label: 'Clear All', cls: 'danger', handler: () => { this.elements = []; this._renderElements(); } }
    ]);
    this.elementDisplay.appendChild(bar);

    if (this.elements.length === 0) {
      this.elementDisplay.insertAdjacentHTML('beforeend',
        '<div class="empty-state"><span class="empty-icon"><span class="icon icon-2xl icon-crosshair"></span></span><p>Click elements in the browser to capture</p></div>');
      this.locatorList.innerHTML = '';
      return;
    }

    const list = document.createElement('div');
    list.className = 'inspector-element-list';

    this.elements.forEach((entry, idx) => {
      const card = document.createElement('div');
      card.className = 'element-card';
      card.dataset.id = entry.id;

      const d = entry.data;
      const props = [];
      if (d.id) props.push(`id="${this._esc(d.id)}"`);
      if (d.name) props.push(`name="${this._esc(d.name)}"`);
      if (d.classes) props.push(`class="${this._esc(d.classes)}"`);
      if (d.type) props.push(`type="${this._esc(d.type)}"`);
      if (d.text) props.push(`text="${this._esc(d.text.substring(0, 60))}"`);
      if (d.value) props.push(`value="${this._esc(d.value.substring(0, 60))}"`);
      if (d.role) props.push(`role="${this._esc(d.role)}"`);
      if (d.ariaLabel) props.push(`aria="${this._esc(d.ariaLabel)}"`);
      if (d.rect) props.push(`size=${Math.round(d.rect.width)}×${Math.round(d.rect.height)}`);

      card.innerHTML = `
        <div class="element-card-header">
          <span class="element-index">${idx + 1}</span>
          <span class="element-label" title="Double-click to rename">${this._esc(entry.label)}</span>
          <div class="element-card-actions">
            <button class="ec-btn ec-rename" title="Rename">✎</button>
            <button class="ec-btn ec-delete danger" title="Delete">&times;</button>
          </div>
        </div>
        <div class="element-card-tag">&lt;${this._esc(d.tag || '?')}&gt;</div>
        <div class="element-card-props">${props.join(' · ')}</div>
      `;

      const renameBtn = card.querySelector('.ec-rename');
      const labelEl = card.querySelector('.element-label');
      const startRename = () => this._inlineRename(labelEl, entry.label, (v) => { entry.label = v; });
      renameBtn.addEventListener('click', (e) => { e.stopPropagation(); startRename(); });
      labelEl.addEventListener('dblclick', (e) => { e.stopPropagation(); startRename(); });

      card.querySelector('.ec-delete').addEventListener('click', (e) => {
        e.stopPropagation();
        this.elements = this.elements.filter(x => x.id !== entry.id);
        this._renderElements();
      });

      list.appendChild(card);
    });

    this.elementDisplay.appendChild(list);

    // ─── Locators section (below elements, same tab) ───────
    this._renderLocators();
  }

  _renderLocators() {
    this.locatorList.innerHTML = '';

    // Collect all locators from all elements
    const allLocs = [];
    this.elements.forEach(entry => {
      (entry.locators || []).forEach(loc => {
        allLocs.push({ ...loc, elementLabel: entry.label });
      });
    });

    if (allLocs.length === 0) return;

    const header = document.createElement('div');
    header.className = 'locator-section-header';
    header.innerHTML = `<span class="locator-section-title">Locators</span><span class="badge">${allLocs.length}</span>`;
    this.locatorList.appendChild(header);

    const list = document.createElement('div');
    list.className = 'locator-entries';

    allLocs.forEach((loc) => {
      const card = document.createElement('div');
      card.className = 'locator-card';
      const pct = Math.round((loc.confidence || 0) * 100);
      const barColor = pct >= 80 ? 'var(--accent-green)' : pct >= 50 ? 'var(--accent-yellow)' : 'var(--accent-red)';

      card.innerHTML = `
        <div class="locator-card-header">
          <span class="locator-strategy-badge">${this._esc(loc.strategy)}</span>
          <span class="locator-elem-label">${this._esc(loc.elementLabel || '')}</span>
          <span class="locator-confidence">${pct}%</span>
          <button class="ec-btn loc-copy" title="Copy">📋</button>
        </div>
        <div class="locator-value" title="${this._esc(loc.value)}">${this._esc(loc.value)}</div>
        <div class="locator-confidence-bar"><div class="locator-confidence-fill" style="width:${pct}%;background:${barColor}"></div></div>
      `;

      card.querySelector('.loc-copy').addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(loc.value);
        const btn = e.target;
        btn.textContent = '✅';
        setTimeout(() => btn.textContent = '📋', 1500);
      });

      list.appendChild(card);
    });

    this.locatorList.appendChild(list);
  }

  // ════════════════════════════════════════════════════════════
  //  TEST DATA TAB
  // ════════════════════════════════════════════════════════════
  _extractTestData(data, elementLabel) {
    const src = elementLabel || 'element';
    if (data.value) this.testDataRows.push({ id: this._uid(), key: data.name || data.id || 'value', value: data.value, source: src });
    if (data.placeholder) this.testDataRows.push({ id: this._uid(), key: 'placeholder', value: data.placeholder, source: src });
    if (data.href) this.testDataRows.push({ id: this._uid(), key: 'href', value: data.href, source: src });
    if (data.text && data.text.length < 200) this.testDataRows.push({ id: this._uid(), key: 'text', value: data.text, source: src });
    this._renderTestData();
  }

  _renderTestData() {
    this.testDataContainer.innerHTML = '';

    const bar = this._actionBar([
      { label: '+ Add Row', handler: () => { this.testDataRows.push({ id: this._uid(), key: 'key', value: '', source: 'manual' }); this._renderTestData(); } },
      { label: '↓ Export JSON', handler: () => this._exportTestDataJSON() },
      { label: 'Clear All', cls: 'danger', handler: () => { this.testDataRows = []; this._renderTestData(); } }
    ]);
    this.testDataContainer.appendChild(bar);

    if (this.testDataRows.length === 0) {
      this.testDataContainer.insertAdjacentHTML('beforeend',
        '<div class="empty-state"><span class="empty-icon"><span class="icon icon-2xl icon-bar-chart"></span></span><p>Test data will appear here</p></div>');
      return;
    }

    const table = document.createElement('table');
    table.className = 'testdata-table';
    table.innerHTML = '<thead><tr><th>Key</th><th>Value</th><th>Source</th><th></th></tr></thead>';
    const tbody = document.createElement('tbody');

    this.testDataRows.forEach(row => {
      const tr = document.createElement('tr');
      tr.dataset.id = row.id;
      tr.innerHTML = `
        <td><input type="text" class="td-input td-key" value="${this._esc(row.key)}" /></td>
        <td><input type="text" class="td-input td-value" value="${this._esc(row.value)}" /></td>
        <td><span class="td-source">${this._esc(row.source || 'manual')}</span></td>
        <td><button class="ec-btn ec-delete danger" title="Delete row">&times;</button></td>
      `;

      tr.querySelector('.td-key').addEventListener('change', (e) => { row.key = e.target.value; });
      tr.querySelector('.td-value').addEventListener('change', (e) => { row.value = e.target.value; });
      tr.querySelector('.ec-delete').addEventListener('click', (e) => {
        e.stopPropagation();
        this.testDataRows = this.testDataRows.filter(x => x.id !== row.id);
        this._renderTestData();
      });

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    this.testDataContainer.appendChild(table);
  }

  _exportTestDataJSON() {
    if (this.testDataRows.length === 0) return;
    const obj = {};
    this.testDataRows.forEach(r => { obj[r.key] = r.value; });
    const json = JSON.stringify(obj, null, 2);

    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'testdata.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ─── Shared helpers ──────────────────────────────────────
  _actionBar(buttons) {
    const bar = document.createElement('div');
    bar.className = 'inspector-action-bar';
    buttons.forEach(b => {
      const btn = document.createElement('button');
      btn.className = `inspector-action-btn${b.cls ? ' ' + b.cls : ''}`;
      btn.textContent = b.label;
      btn.addEventListener('click', b.handler);
      bar.appendChild(btn);
    });
    return bar;
  }

  _inlineRename(el, currentVal, onCommit) {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentVal;
    input.className = 'inline-rename-input';
    el.replaceWith(input);
    input.focus();
    input.select();

    const commit = () => {
      const v = input.value.trim() || currentVal;
      onCommit(v);
      const span = document.createElement('span');
      span.className = 'element-label';
      span.title = 'Double-click to rename';
      span.textContent = v;
      span.addEventListener('dblclick', () => this._inlineRename(span, v, onCommit));
      input.replaceWith(span);
    };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') { input.value = currentVal; input.blur(); }
    });
  }

  _esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }
}

window.InspectorUI = new InspectorUI();
