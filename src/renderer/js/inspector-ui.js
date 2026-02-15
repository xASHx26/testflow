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
    this._locatorsCollapsed = false;
    this._valuesCollapsed = false;
    this._singleElementMode = false;  // 🔍 search mode: replaces instead of stacking
    this._elemCollapsed = {};         // per-element collapse state, keyed by entry.id

    this._counter = 0;

    this.elementDisplay = document.getElementById('inspector-content');
    this.locatorList    = document.getElementById('locator-list');
    this.testDataContainer = document.getElementById('testdata-content');

    this._listen();
    this._renderElements();
    this._renderTestData();
    this._setupSectionResizeHandles();
  }

  _uid() { return `iui-${++this._counter}-${Date.now()}`; }

  /** Toggle single-element mode (search inspector: replaces instead of stacking) */
  setSingleElementMode(on) {
    this._singleElementMode = !!on;
  }

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

  // ─── Element fingerprint (for dedup) ──────────────────────
  _elementFingerprint(data) {
    // Use absoluteXpath as the primary unique identifier;
    // fall back to cssSelector, then tag+id+name combo
    if (data.absoluteXpath) return data.absoluteXpath;
    if (data.cssSelector)   return data.cssSelector;
    return `${data.tag || ''}#${data.id || ''}[${data.name || ''}]`;
  }

  // ─── Capture element (click in inspector) ────────────────
  async _captureElement(data) {
    if (!data) return;

    const fingerprint = this._elementFingerprint(data);

    // In single-element mode (🔍 search), clear all previous elements
    if (this._singleElementMode) {
      this.elements = [];
      this.testDataRows = [];
      this._elemCollapsed = {};
    } else {
      // Remove previous entry for the same element (dedup)
      const existingIdx = this.elements.findIndex(
        e => this._elementFingerprint(e.data) === fingerprint
      );
      if (existingIdx !== -1) {
        // Also remove test-data rows that came from this element
        this.testDataRows = this.testDataRows.filter(r => r._fingerprint !== fingerprint);
        const removedId = this.elements[existingIdx].id;
        delete this._elemCollapsed[removedId];
        this.elements.splice(existingIdx, 1);
      }
    }

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
    this._extractTestData(data, label, fingerprint);
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
            <button class="ec-btn ec-copy-all" title="Copy all locators">📋</button>
            <button class="ec-btn ec-rename" title="Rename">✎</button>
            <button class="ec-btn ec-delete danger" title="Delete">&times;</button>
          </div>
        </div>
        <div class="element-card-tag copyable" title="Click to copy">&lt;${this._esc(d.tag || '?')}&gt;</div>
        <div class="element-card-props copyable" title="Click to copy">${props.join(' · ')}</div>
      `;

      // Copy element tag on click
      card.querySelector('.element-card-tag').addEventListener('click', (e) => {
        e.stopPropagation();
        this._copyToClipboard(`<${d.tag || '?'}>`, e.target);
      });
      // Copy props on click
      card.querySelector('.element-card-props').addEventListener('click', (e) => {
        e.stopPropagation();
        this._copyToClipboard(props.join(' · '), e.target);
      });
      // Copy all locators for this element
      card.querySelector('.ec-copy-all').addEventListener('click', (e) => {
        e.stopPropagation();
        const allText = (entry.locators || []).map(l => `${l.strategy}: ${l.value}`).join('\n');
        this._copyToClipboard(allText, e.target);
      });

      const renameBtn = card.querySelector('.ec-rename');
      const labelEl = card.querySelector('.element-label');
      const startRename = () => this._inlineRename(labelEl, entry.label, (v) => { entry.label = v; });
      renameBtn.addEventListener('click', (e) => { e.stopPropagation(); startRename(); });
      labelEl.addEventListener('dblclick', (e) => { e.stopPropagation(); startRename(); });

      card.querySelector('.ec-delete').addEventListener('click', (e) => {
        e.stopPropagation();
        // Remove associated test-data rows by fingerprint
        const fp = this._elementFingerprint(entry.data);
        this.testDataRows = this.testDataRows.filter(r => r._fingerprint !== fp);
        this.elements = this.elements.filter(x => x.id !== entry.id);
        this._renderElements();
        this._renderTestData();
      });

      list.appendChild(card);
    });

    this.elementDisplay.appendChild(list);

    // ─── Locators section (below elements, same tab) ───────
    this._renderLocators();
  }

  _renderLocators() {
    this.locatorList.innerHTML = '';

    // Collect all locators grouped by element
    const totalLocs = this.elements.reduce((n, e) => n + (e.locators || []).length, 0);
    if (totalLocs === 0 && this.elements.length === 0) return;

    const header = document.createElement('div');
    header.className = 'locator-section-header collapsible-header';
    header.innerHTML = `<span class="collapse-arrow">${this._locatorsCollapsed ? '▶' : '▼'}</span><span class="locator-section-title">Locators</span><span class="badge">${totalLocs}</span>`;
    header.addEventListener('click', () => {
      this._locatorsCollapsed = !this._locatorsCollapsed;
      this._renderLocators();
    });
    this.locatorList.appendChild(header);

    if (this._locatorsCollapsed) return;

    const list = document.createElement('div');
    list.className = 'locator-entries';

    this.elements.forEach((entry, idx) => {
      // ─── Element group header (collapsible per-element) ─────
      const isCollapsed = !!this._elemCollapsed[entry.id];
      const groupHeader = document.createElement('div');
      groupHeader.className = 'locator-group-header locator-group-collapsible';
      groupHeader.innerHTML = `
        <span class="collapse-arrow">${isCollapsed ? '▶' : '▼'}</span>
        <span class="locator-group-index">${idx + 1}</span>
        <span class="locator-group-label">${this._esc(entry.label)}</span>
        <span class="locator-group-tag">&lt;${this._esc(entry.data?.tag || '?')}&gt;</span>
        <span class="locator-group-count">${(entry.locators || []).length} locators</span>
      `;
      groupHeader.style.cursor = 'pointer';
      groupHeader.addEventListener('click', () => {
        this._elemCollapsed[entry.id] = !this._elemCollapsed[entry.id];
        this._renderLocators();
      });
      list.appendChild(groupHeader);

      if (isCollapsed) return; // skip locators + HTML for collapsed element

      // ─── Element HTML section (innerHTML + outerHTML) ─────
      if (entry.data?.outerHTML) {
        const htmlSection = document.createElement('div');
        htmlSection.className = 'locator-html-section';

        // Element tag display
        const tagLine = document.createElement('div');
        tagLine.className = 'locator-html-tag';
        const d = entry.data;
        const tagParts = [`<${this._esc(d.tag || '?')}`];
        if (d.id) tagParts.push(` id="${this._esc(d.id)}"`);
        if (d.name) tagParts.push(` name="${this._esc(d.name)}"`);
        if (d.classes && d.classes.length) {
          const cls = Array.isArray(d.classes) ? d.classes.join(' ') : d.classes;
          tagParts.push(` class="${this._esc(cls)}"`);
        }
        tagParts.push('>');
        tagLine.innerHTML = `<span class="html-label">Element</span><code class="html-code copyable" title="Click to copy">${tagParts.join('')}</code>`;
        tagLine.querySelector('.html-code').addEventListener('click', (e) => {
          e.stopPropagation();
          this._copyToClipboard(tagParts.join(''), e.target);
        });
        htmlSection.appendChild(tagLine);

        // outerHTML display
        const outerLine = document.createElement('div');
        outerLine.className = 'locator-html-outer';
        const truncatedOuter = d.outerHTML.length > 500
          ? d.outerHTML.substring(0, 500) + '…'
          : d.outerHTML;
        outerLine.innerHTML = `
          <div class="html-outer-header">
            <span class="html-label">outerHTML</span>
            <button class="ec-btn loc-copy-html" title="Copy full outerHTML">📋</button>
          </div>
          <pre class="html-outer-code">${this._esc(truncatedOuter)}</pre>
        `;
        outerLine.querySelector('.loc-copy-html').addEventListener('click', (e) => {
          e.stopPropagation();
          this._copyToClipboard(d.outerHTML, e.target);
        });
        outerLine.querySelector('.html-outer-code').addEventListener('click', (e) => {
          e.stopPropagation();
          this._copyToClipboard(d.outerHTML, e.target);
        });
        htmlSection.appendChild(outerLine);

        list.appendChild(htmlSection);
      }

      // ─── Locator cards ─────────────────────────────────
      if (!entry.locators || entry.locators.length === 0) return;

      entry.locators.forEach((loc) => {
        const card = document.createElement('div');
        card.className = 'locator-card';
        const pct = Math.round((loc.confidence || 0) * 100);
        const barColor = pct >= 80 ? 'var(--accent-green)' : pct >= 50 ? 'var(--accent-yellow)' : 'var(--accent-red)';

        card.innerHTML = `
          <div class="locator-card-header">
            <span class="locator-strategy-badge">${this._esc(loc.strategy)}</span>
            <span class="locator-elem-label">${this._esc(entry.label)}</span>
            <span class="locator-confidence">${pct}%</span>
            <button class="ec-btn loc-copy" title="Copy locator value">📋</button>
          </div>
          <div class="locator-value copyable" title="Click to copy — ${this._esc(loc.value)}">${this._esc(loc.value)}</div>
          <div class="locator-confidence-bar"><div class="locator-confidence-fill" style="width:${pct}%;background:${barColor}"></div></div>
        `;

        // Copy button
        card.querySelector('.loc-copy').addEventListener('click', (e) => {
          e.stopPropagation();
          this._copyToClipboard(loc.value, e.target);
        });

        // Click on value to copy
        card.querySelector('.locator-value').addEventListener('click', (e) => {
          e.stopPropagation();
          this._copyToClipboard(loc.value, e.target);
        });

        list.appendChild(card);
      });
    });

    this.locatorList.appendChild(list);
  }

  // ════════════════════════════════════════════════════════════
  //  VALUES SECTION (test data, below locators in Inspector tab)
  // ════════════════════════════════════════════════════════════
  _extractTestData(data, elementLabel, fingerprint) {
    const src = elementLabel || 'element';
    const fp = fingerprint || '';
    if (data.value) this.testDataRows.push({ id: this._uid(), key: data.name || data.id || 'value', value: data.value, source: src, _fingerprint: fp });
    if (data.placeholder) this.testDataRows.push({ id: this._uid(), key: 'placeholder', value: data.placeholder, source: src, _fingerprint: fp });
    if (data.href) this.testDataRows.push({ id: this._uid(), key: 'href', value: data.href, source: src, _fingerprint: fp });
    if (data.text && data.text.length < 200) this.testDataRows.push({ id: this._uid(), key: 'text', value: data.text, source: src, _fingerprint: fp });
    this._renderTestData();
  }

  _renderTestData() {
    this.testDataContainer.innerHTML = '';
    // Section header with collapse toggle
    const header = document.createElement('div');
    header.className = 'locator-section-header collapsible-header';
    header.innerHTML = `<span class="collapse-arrow">${this._valuesCollapsed ? '▶' : '▼'}</span><span class="locator-section-title">Values</span><span class="badge">${this.testDataRows.length}</span>`;
    header.addEventListener('click', () => {
      this._valuesCollapsed = !this._valuesCollapsed;
      this._renderTestData();
    });
    this.testDataContainer.appendChild(header);

    if (this._valuesCollapsed) return;
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
        <td><input type="text" class="td-input td-key" value="${this._esc(row.key)}" title="Click to select, right-click to copy" /></td>
        <td><input type="text" class="td-input td-value" value="${this._esc(row.value)}" title="Click to select, right-click to copy" /></td>
        <td><span class="td-source copyable" title="Click to copy">${this._esc(row.source || 'manual')}</span></td>
        <td>
          <button class="ec-btn ec-copy-row" title="Copy key=value">📋</button>
          <button class="ec-btn ec-delete danger" title="Delete row">&times;</button>
        </td>
      `;

      tr.querySelector('.td-key').addEventListener('change', (e) => { row.key = e.target.value; });
      tr.querySelector('.td-value').addEventListener('change', (e) => { row.value = e.target.value; });
      tr.querySelector('.td-source').addEventListener('click', (e) => {
        e.stopPropagation();
        this._copyToClipboard(row.source || 'manual', e.target);
      });
      tr.querySelector('.ec-copy-row').addEventListener('click', (e) => {
        e.stopPropagation();
        this._copyToClipboard(`${row.key}=${row.value}`, e.target);
      });
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

  // ─── Section resize handles ──────────────────────────────
  _setupSectionResizeHandles() {
    const tab = document.getElementById('tab-inspector');
    if (!tab) return;

    // Insert resize handles between the three sections
    const inspectorContent = this.elementDisplay;
    const locatorList = this.locatorList;
    const testdataContent = this.testDataContainer;

    // Handle between inspector-content and locator-list
    const handle1 = document.createElement('div');
    handle1.className = 'section-resize-handle';
    tab.insertBefore(handle1, locatorList);

    // Handle between locator-list and testdata-content
    const handle2 = document.createElement('div');
    handle2.className = 'section-resize-handle';
    tab.insertBefore(handle2, testdataContent);

    this._makeSectionResizable(handle1, inspectorContent, locatorList);
    this._makeSectionResizable(handle2, locatorList, testdataContent);
  }

  _makeSectionResizable(handle, aboveEl, belowEl) {
    const MIN_H = 32; // minimum section height (header only)

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      handle.classList.add('active');
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';

      const startY = e.clientY;
      const aboveRect = aboveEl.getBoundingClientRect();
      const belowRect = belowEl.getBoundingClientRect();
      const startAboveH = aboveRect.height;
      const startBelowH = belowRect.height;

      const onMove = (ev) => {
        const dy = ev.clientY - startY;
        const newAboveH = Math.max(MIN_H, startAboveH + dy);
        const newBelowH = Math.max(MIN_H, startBelowH - dy);

        aboveEl.style.flex = 'none';
        aboveEl.style.height = newAboveH + 'px';
        belowEl.style.flex = 'none';
        belowEl.style.height = newBelowH + 'px';
      };

      const onUp = () => {
        handle.classList.remove('active');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
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

  _copyToClipboard(text, triggerEl) {
    navigator.clipboard.writeText(text).then(() => {
      // Visual feedback
      if (triggerEl) {
        const orig = triggerEl.textContent;
        triggerEl.classList.add('copied');
        if (triggerEl.classList.contains('ec-btn') || triggerEl.classList.contains('loc-copy')) {
          triggerEl.textContent = '✅';
          setTimeout(() => { triggerEl.textContent = orig; triggerEl.classList.remove('copied'); }, 1200);
        } else {
          // For value/text elements, show a brief tooltip
          const tooltip = document.createElement('span');
          tooltip.className = 'copy-toast';
          tooltip.textContent = 'Copied!';
          triggerEl.style.position = 'relative';
          triggerEl.appendChild(tooltip);
          setTimeout(() => { tooltip.remove(); triggerEl.classList.remove('copied'); }, 1200);
        }
      }
    }).catch(() => {
      // Fallback: select text in a temp textarea
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    });
  }

  _esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  // ─── State persistence API ──────────────────────────────
  getState() {
    return {
      elements: this.elements.map(e => ({ ...e })),
      testDataRows: this.testDataRows.map(r => ({ ...r })),
    };
  }

  loadState(data) {
    if (!data) return;
    if (Array.isArray(data.elements)) {
      this.elements = data.elements.map(e => ({ ...e }));
      // Reset counter to avoid ID collisions
      this._counter = Math.max(this._counter, this.elements.length + (data.testDataRows?.length || 0) + 100);
    }
    if (Array.isArray(data.testDataRows)) {
      this.testDataRows = data.testDataRows.map(r => ({ ...r }));
    }
    this._renderElements();
    this._renderTestData();
  }
}

window.InspectorUI = new InspectorUI();
