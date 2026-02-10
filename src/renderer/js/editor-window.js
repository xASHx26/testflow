/**
 * TestFlow — Editor Window Script
 *
 * Runs inside the modal editor BrowserWindow.
 * Receives test case data via the editorBridge preload,
 * populates the table / JSON editor, and sends edits back.
 */

(function () {
  'use strict';

  let testCase = null;
  let activeTab = 'testdata';

  const titleEl    = document.getElementById('editor-title');
  const tableBody  = document.getElementById('td-table-body');
  const emptyMsg   = document.getElementById('td-empty');
  const jsonEditor = document.getElementById('json-editor');

  // ─── Tab switching ──────────────────────────────────────────
  document.querySelectorAll('.td-editor-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.td-editor-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.td-tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.tab;
      document.getElementById(`td-tab-${target}`)?.classList.add('active');
      activeTab = target;

      // Sync: switching TO json → serialize table edits
      if (target === 'json' && testCase) {
        const edited = collectEdits();
        jsonEditor.value = JSON.stringify(edited, null, 2);
      }
      // Sync: switching TO testdata → parse JSON edits
      if (target === 'testdata' && testCase) {
        try {
          const parsed = JSON.parse(jsonEditor.value);
          testCase = parsed;
          populateTable(testCase);
        } catch (_) { /* leave table as-is if JSON is invalid */ }
      }
    });
  });

  // ─── Buttons ────────────────────────────────────────────────
  document.getElementById('btn-save-replay')?.addEventListener('click', () => save(true));
  document.getElementById('btn-save')?.addEventListener('click', () => save(false));
  document.getElementById('btn-cancel')?.addEventListener('click', () => window.editorBridge.close());
  document.getElementById('btn-close')?.addEventListener('click', () => window.editorBridge.close());

  // Esc to close
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') window.editorBridge.close();
  });

  // ─── Populate ───────────────────────────────────────────────
  function populate(tc) {
    testCase = tc;
    if (!tc) return;

    titleEl.textContent = tc.name || 'Edit Test Case';
    jsonEditor.value = JSON.stringify(tc, null, 2);
    populateTable(tc);
  }

  function populateTable(tc) {
    tableBody.innerHTML = '';
    const td   = tc.testData     || {};
    const meta = tc.testDataMeta || {};
    const keys = Object.keys(td);

    if (keys.length === 0) {
      emptyMsg?.classList.remove('hidden');
      return;
    }
    emptyMsg?.classList.add('hidden');

    keys.forEach(key => {
      const value       = td[key];
      const m           = meta[key] || {};
      const controlType = m.controlType || m.type || 'text';
      const label       = m.label || key;

      const tr = document.createElement('tr');
      tr.className = 'td-row';
      tr.dataset.key = key;

      const tdKey = document.createElement('td');
      tdKey.className = 'td-cell td-cell-key';
      tdKey.innerHTML = `<span class="td-field-label" title="${esc(key)}">${esc(label)}</span>`;

      const tdVal = document.createElement('td');
      tdVal.className = 'td-cell td-cell-val';
      tdVal.appendChild(buildInput(key, value, controlType));

      const tdType = document.createElement('td');
      tdType.className = 'td-cell td-cell-type';
      tdType.innerHTML = `<span class="td-type-badge td-type-${controlType}">${controlType}</span>`;

      tr.appendChild(tdKey);
      tr.appendChild(tdVal);
      tr.appendChild(tdType);
      tableBody.appendChild(tr);
    });
  }

  // ─── Build input per controlType ────────────────────────────
  function buildInput(key, value, ct) {
    const wrap = document.createElement('div');
    wrap.className = 'td-input-wrap';

    if (ct === 'checkbox' || ct === 'toggle') {
      const cb = Object.assign(document.createElement('input'), { type: 'checkbox', className: 'td-input td-input-checkbox', checked: !!value });
      cb.dataset.tdKey = key;
      wrap.appendChild(cb);
      const lbl = document.createElement('span');
      lbl.className = 'td-checkbox-label';
      lbl.textContent = value ? 'Checked' : 'Unchecked';
      cb.addEventListener('change', () => { lbl.textContent = cb.checked ? 'Checked' : 'Unchecked'; });
      wrap.appendChild(lbl);
      return wrap;
    }

    if (ct === 'slider' || ct === 'rating' || ct === 'meter' || ct === 'number') {
      const num = Object.assign(document.createElement('input'), { type: 'number', className: 'td-input td-input-number', value: value ?? 0, step: 'any' });
      num.dataset.tdKey = key;
      wrap.appendChild(num);
      return wrap;
    }

    if (ct === 'color') {
      const clr = Object.assign(document.createElement('input'), { type: 'color', className: 'td-input td-input-color', value: value || '#000000' });
      clr.dataset.tdKey = key;
      wrap.appendChild(clr);
      const hex = document.createElement('span');
      hex.className = 'td-color-hex';
      hex.textContent = clr.value;
      clr.addEventListener('input', () => { hex.textContent = clr.value; });
      wrap.appendChild(hex);
      return wrap;
    }

    if (ct === 'date')     return simpleInput(key, value, 'date',           'td-input-date');
    if (ct === 'time')     return simpleInput(key, value, 'time',           'td-input-time');
    if (ct === 'datetime') return simpleInput(key, value, 'datetime-local', 'td-input-datetime');
    if (ct === 'month')    return simpleInput(key, value, 'month',          'td-input-month');
    if (ct === 'week')     return simpleInput(key, value, 'week',           'td-input-week');

    if (ct === 'file') {
      const f = Object.assign(document.createElement('input'), { type: 'text', className: 'td-input td-input-text td-input-readonly', value: value || '', readOnly: true, placeholder: '(file path)' });
      f.dataset.tdKey = key;
      wrap.appendChild(f);
      return wrap;
    }

    if (ct === 'textarea' || ct === 'contenteditable') {
      const ta = Object.assign(document.createElement('textarea'), { className: 'td-input td-input-textarea', rows: 2, value: value ?? '' });
      ta.dataset.tdKey = key;
      wrap.appendChild(ta);
      return wrap;
    }

    // Boolean flags (button click = true)
    if (typeof value === 'boolean' && ct !== 'text') {
      const cb = Object.assign(document.createElement('input'), { type: 'checkbox', className: 'td-input td-input-checkbox', checked: !!value });
      cb.dataset.tdKey = key;
      wrap.appendChild(cb);
      const lbl = document.createElement('span');
      lbl.className = 'td-checkbox-label';
      lbl.textContent = value ? 'Yes' : 'No';
      cb.addEventListener('change', () => { lbl.textContent = cb.checked ? 'Yes' : 'No'; });
      wrap.appendChild(lbl);
      return wrap;
    }

    // Default: text
    const inp = Object.assign(document.createElement('input'), { type: ct === 'password' ? 'password' : 'text', className: 'td-input td-input-text', value: value ?? '' });
    inp.dataset.tdKey = key;
    wrap.appendChild(inp);
    return wrap;
  }

  function simpleInput(key, value, type, cls) {
    const wrap = document.createElement('div');
    wrap.className = 'td-input-wrap';
    const inp = Object.assign(document.createElement('input'), { type, className: `td-input ${cls}`, value: value || '' });
    inp.dataset.tdKey = key;
    wrap.appendChild(inp);
    return wrap;
  }

  // ─── Collect edits ──────────────────────────────────────────
  function collectEdits() {
    const tc = JSON.parse(JSON.stringify(testCase));
    if (!tc) return tc;

    tableBody.querySelectorAll('.td-row').forEach(row => {
      const key = row.dataset.key;
      const inp = row.querySelector('[data-td-key]');
      if (!inp || !key) return;

      if (inp.type === 'checkbox')            tc.testData[key] = inp.checked;
      else if (inp.type === 'number')         tc.testData[key] = parseFloat(inp.value) || 0;
      else if (inp.tagName === 'TEXTAREA')    tc.testData[key] = inp.value;
      else                                    tc.testData[key] = inp.value;
    });

    return tc;
  }

  // ─── Save ───────────────────────────────────────────────────
  async function save(andReplay) {
    try {
      let edited;
      if (activeTab === 'json') {
        edited = JSON.parse(jsonEditor.value);
      } else {
        edited = collectEdits();
      }
      await window.editorBridge.save(edited, andReplay);
    } catch (err) {
      alert('Save error: ' + err.message);
    }
  }

  // ─── Utility ────────────────────────────────────────────────
  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // ─── Init: fetch data from main process ─────────────────────
  window.editorBridge.getData().then(data => {
    if (data && data.mode === 'pagedata') {
      titleEl.textContent = (data.tc.name || 'Test Case') + ' — Page Data';
      // Show JSON tab only
      document.querySelectorAll('.td-editor-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.td-tab-content').forEach(c => c.classList.remove('active'));
      document.querySelector('.td-editor-tab[data-tab="json"]')?.classList.add('active');
      document.getElementById('td-tab-json')?.classList.add('active');
      activeTab = 'json';
      jsonEditor.value = JSON.stringify(data.tc.pageData, null, 2);
      jsonEditor.readOnly = true;
      // Hide Save buttons for read-only view
      document.getElementById('btn-save-replay').style.display = 'none';
      document.getElementById('btn-save').style.display = 'none';
    } else if (data && data.tc) {
      populate(data.tc);
    }
  });
})();
