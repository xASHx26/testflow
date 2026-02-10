/**
 * TestFlow — Test Case Manager
 *
 * Manages test case CRUD in the Replay Log tab.
 * Features:
 *  - Test Data Editor: editable key-value table for form inputs
 *  - PageData viewer: raw per-step page data (elements, locators, values)
 *  - BrowserView is hidden while the editor overlay is open so the overlay
 *    isn't obscured by the native BrowserView window.
 */

(function () {
  'use strict';

  const testCases = []; // in-memory store
  let editingIndex = -1;
  let activeEditorTab = 'testdata'; // 'testdata' | 'json'

  // ─── DOM refs ────────────────────────────────────────────────
  const listEl          = document.getElementById('testcase-list');
  const logOutputEl     = document.getElementById('replay-log-output');
  const editorOverlay   = document.getElementById('testcase-editor-overlay');
  const jsonEditor      = document.getElementById('testcase-json-editor');
  const tdTableBody     = document.getElementById('td-table-body');
  const tdEmpty         = document.getElementById('td-empty');
  const editorNameEl    = document.getElementById('editor-tc-name');
  const btnSave         = document.getElementById('btn-save-testcase');
  const btnSaveOnly     = document.getElementById('btn-save-only');
  const btnCancel       = document.getElementById('btn-cancel-testcase');
  const btnClose        = document.getElementById('btn-close-editor');
  const btnReplayAll    = document.getElementById('btn-replay-all');
  const btnClear        = document.getElementById('btn-clear-testcases');
  const btnClearLog     = document.getElementById('btn-clear-replay-log');

  // ─── Editor tab switching ───────────────────────────────────
  document.querySelectorAll('.td-editor-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.td-editor-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.td-tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.tab;
      const pane = document.getElementById(`td-tab-${target}`);
      if (pane) pane.classList.add('active');
      activeEditorTab = target;

      // Sync: when switching TO json tab, serialize current testData edits
      if (target === 'json' && editingIndex >= 0) {
        const tc = collectTestDataEdits();
        jsonEditor.value = JSON.stringify(tc, null, 2);
      }
      // Sync: when switching TO testdata tab, parse JSON edits
      if (target === 'testdata' && editingIndex >= 0) {
        try {
          const parsed = JSON.parse(jsonEditor.value);
          testCases[editingIndex] = { ...parsed, status: testCases[editingIndex]?.status || 'recorded', lastRun: testCases[editingIndex]?.lastRun || null };
          populateTestDataTable(testCases[editingIndex]);
        } catch (_) { /* leave table as-is if JSON is invalid */ }
      }
    });
  });

  // ─── Listen for generated test cases from main process ──────
  if (window.testflow?.testcase?.onGenerated) {
    window.testflow.testcase.onGenerated((tc) => {
      addTestCase(tc);
    });
  }

  // ─── Listen for replay events ───────────────────────────────
  if (window.testflow?.replay) {
    window.testflow.replay.onStarted?.((data) => {
      appendLog(`▶ Replay started — ${data.totalSteps} steps`, 'info');
    });

    window.testflow.replay.onStepStarted?.((data) => {
      const label = data.label || `Step ${data.index + 1}`;
      appendLog(`  ⏳ ${label}`, 'info');
    });

    window.testflow.replay.onStepCompleted?.((data) => {
      const label = data.label || `Step ${data.index + 1}`;
      const icon = data.status === 'passed' ? '✅' : '❌';
      appendLog(`  ${icon} ${label} — ${data.status}`, data.status === 'passed' ? 'info' : 'error');
    });

    window.testflow.replay.onStepComplete?.((result) => {
      const icon = result.status === 'passed' ? '✅' : '❌';
      const desc = result.description || result.stepType || 'step';
      appendLog(`  ${icon} ${desc} — ${result.status}`, result.status === 'passed' ? 'info' : 'error');
    });

    window.testflow.replay.onFinished?.((data) => {
      const status = data.passed ? '✅ PASSED' : '❌ FAILED';
      appendLog(`■ Replay finished — ${status}`, data.passed ? 'success' : 'error');
      updateLatestStatus(data);
    });

    window.testflow.replay.onError?.((data) => {
      appendLog(`⚠ Replay error: ${data.error}`, 'error');
    });
  }

  // ─── Public API ──────────────────────────────────────────────
  function addTestCase(tc) {
    testCases.push({ ...tc, status: tc.status || 'recorded', lastRun: null });
    render();
    const tab = document.querySelector('.panel-tab[data-tab="replay-log"]');
    if (tab) tab.click();
  }

  function render() {
    if (!listEl) return;
    listEl.innerHTML = '';

    if (testCases.length === 0) {
      listEl.innerHTML = '<div class="testcase-empty">No test cases yet. Record a flow to generate one.</div>';
      return;
    }

    testCases.forEach((tc, idx) => {
      const card = createCard(tc, idx);
      listEl.appendChild(card);
    });
  }

  function createCard(tc, idx) {
    const card = document.createElement('div');
    card.className = `testcase-card testcase-status-${tc.status}`;
    card.dataset.index = idx;

    const statusIcon = tc.status === 'passed' ? '✅' :
                       tc.status === 'failed' ? '❌' :
                       tc.status === 'running' ? '⏳' : '📄';

    const stepsCount = tc.steps?.length || 0;

    // Build a concise test-data summary from the top-level map
    const tdKeys = Object.keys(tc.testData || {});
    let dataSummary = '';
    if (tdKeys.length > 0) {
      const preview = tdKeys.slice(0, 3).map(k => {
        const v = tc.testData[k];
        const display = typeof v === 'boolean' ? (v ? '✓' : '✗')
                      : typeof v === 'number' ? String(v)
                      : String(v).length > 18 ? String(v).substring(0, 15) + '…' : String(v);
        return `${k}: ${display}`;
      }).join(', ');
      dataSummary = `<div class="testcase-data-preview">${escHtml(preview)}${tdKeys.length > 3 ? ` +${tdKeys.length - 3} more` : ''}</div>`;
    }

    const hasPageData = tc.pageData && tc.pageData.length > 0;
    const hasNetwork  = tc.networkLog && tc.networkLog.length > 0;

    card.innerHTML = `
      <div class="testcase-card-header">
        <span class="testcase-status-icon">${statusIcon}</span>
        <span class="testcase-name">${escHtml(tc.name || 'Test Case')}</span>
        <span class="testcase-meta">${stepsCount} steps · ${tdKeys.length} field${tdKeys.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="testcase-card-body">
        <div class="testcase-url">${escHtml(tc.startUrl || '—')}</div>
        ${dataSummary}
        ${tc.lastRun ? `<div class="testcase-lastrun">Last run: ${new Date(tc.lastRun).toLocaleTimeString()}</div>` : ''}
      </div>
      <div class="testcase-card-actions">
        <button class="tc-btn tc-btn-play" data-action="play" title="Replay this test case">▶ Run</button>
        <button class="tc-btn tc-btn-edit" data-action="edit" title="Edit test data">✏ Edit</button>
        <button class="tc-btn tc-btn-dup" data-action="duplicate" title="Duplicate">⧉ Dup</button>
        <button class="tc-btn tc-btn-download" data-action="download" title="Download test case JSON">↓ TestCase</button>
        <button class="tc-btn tc-btn-pagedata" data-action="view-pagedata" title="View page data"${hasPageData ? '' : ' disabled'}>👁 PageData</button>
        <button class="tc-btn tc-btn-pagedata" data-action="download-pagedata" title="Download page data"${hasPageData ? '' : ' disabled'}>↓ PageData</button>
        <button class="tc-btn tc-btn-network" data-action="view-network" title="View network log"${hasNetwork ? '' : ' disabled'}>👁 Network</button>
        <button class="tc-btn tc-btn-network" data-action="download-network" title="Download network log"${hasNetwork ? '' : ' disabled'}>↓ Network</button>
        <button class="tc-btn tc-btn-del" data-action="delete" title="Delete">✕</button>
      </div>
    `;

    // Delegated action handler
    card.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'play')              runTestCase(idx);
      else if (action === 'edit')         openEditor(idx);
      else if (action === 'duplicate')    duplicateTestCase(idx);
      else if (action === 'download')     downloadTestCase(idx);
      else if (action === 'view-pagedata')     viewPageData(idx);
      else if (action === 'download-pagedata') downloadPageData(idx);
      else if (action === 'view-network')      viewNetworkLog(idx);
      else if (action === 'download-network')  downloadNetworkLog(idx);
      else if (action === 'delete')       deleteTestCase(idx);
    });

    // Double-click name to rename inline
    const nameEl = card.querySelector('.testcase-name');
    if (nameEl) {
      nameEl.title = 'Double-click to rename';
      nameEl.style.cursor = 'text';
      nameEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        startInlineRename(idx, nameEl);
      });
    }

    return card;
  }

  // ─── CRUD Operations ────────────────────────────────────────
  async function runTestCase(idx) {
    const tc = testCases[idx];
    if (!tc) return;
    tc.status = 'running';
    tc.lastRun = Date.now();
    render();
    try {
      const result = await window.testflow.replay.runTestCase(tc);
      tc.status = result?.results?.every(r => r.status === 'passed') ? 'passed' : 'failed';
    } catch (err) {
      tc.status = 'failed';
      appendLog(`⚠ Error running test case: ${err.message || err}`, 'error');
    }
    tc.networkLog = window.NetworkPanel?.getRequests?.() || [];
    render();
  }

  // ──────────────────────────────────────────────────────────────
  //  Browser hide/show helpers for overlay visibility
  // ──────────────────────────────────────────────────────────────
  function hideBrowserView() {
    // Suppress panel-manager resize updates so they don't restore the view
    window.PanelManager?.suppressBrowserBounds?.();
    window.testflow?.browser?.hide?.();
  }
  function showBrowserView() {
    window.testflow?.browser?.show?.();
    // Re-enable and recalculate bounds
    window.PanelManager?.restoreBrowserBounds?.();
  }

  // ──────────────────────────────────────────────────────────────
  //  Test Data Editor
  // ──────────────────────────────────────────────────────────────
  function openEditor(idx) {
    editingIndex = idx;
    const tc = testCases[idx];
    if (!tc) return;

    // Hide the BrowserView so the overlay isn't behind it
    hideBrowserView();

    // Update header
    if (editorNameEl) editorNameEl.textContent = tc.name || 'Edit Test Case';

    // Populate the Test Data table
    populateTestDataTable(tc);

    // Populate the raw JSON pane
    jsonEditor.value = JSON.stringify(tc, null, 2);

    // Reset to Test Data tab
    document.querySelectorAll('.td-editor-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.td-tab-content').forEach(c => c.classList.remove('active'));
    const firstTab  = document.querySelector('.td-editor-tab[data-tab="testdata"]');
    const firstPane = document.getElementById('td-tab-testdata');
    if (firstTab) firstTab.classList.add('active');
    if (firstPane) firstPane.classList.add('active');
    activeEditorTab = 'testdata';

    editorOverlay.classList.remove('hidden');
  }

  /**
   * Populate the Test Data table with rows from tc.testData + tc.testDataMeta
   */
  function populateTestDataTable(tc) {
    if (!tdTableBody) return;
    tdTableBody.innerHTML = '';

    const td   = tc.testData     || {};
    const meta = tc.testDataMeta || {};
    const keys = Object.keys(td);

    if (keys.length === 0) {
      tdEmpty?.classList.remove('hidden');
      return;
    }
    tdEmpty?.classList.add('hidden');

    keys.forEach(key => {
      const value = td[key];
      const m     = meta[key] || {};
      const ftype = m.type || 'text';
      const label = m.label || key;

      const tr = document.createElement('tr');
      tr.className = 'td-row';
      tr.dataset.key = key;

      // Field name cell
      const tdKey = document.createElement('td');
      tdKey.className = 'td-cell td-cell-key';
      tdKey.innerHTML = `<span class="td-field-label" title="${escHtml(key)}">${escHtml(label)}</span>`;

      // Value cell — different input depending on type
      const tdVal = document.createElement('td');
      tdVal.className = 'td-cell td-cell-val';
      tdVal.appendChild(buildValueInput(key, value, ftype));

      // Type badge cell
      const tdType = document.createElement('td');
      tdType.className = 'td-cell td-cell-type';
      tdType.innerHTML = `<span class="td-type-badge td-type-${ftype}">${ftype}</span>`;

      tr.appendChild(tdKey);
      tr.appendChild(tdVal);
      tr.appendChild(tdType);
      tdTableBody.appendChild(tr);
    });
  }

  /**
   * Build the correct input control for a field type
   */
  function buildValueInput(key, value, ftype) {
    const wrap = document.createElement('div');
    wrap.className = 'td-input-wrap';

    if (ftype === 'checkbox') {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'td-input td-input-checkbox';
      cb.checked = !!value;
      cb.dataset.tdKey = key;
      wrap.appendChild(cb);
      const label = document.createElement('span');
      label.className = 'td-checkbox-label';
      label.textContent = value ? 'Checked' : 'Unchecked';
      cb.addEventListener('change', () => { label.textContent = cb.checked ? 'Checked' : 'Unchecked'; });
      wrap.appendChild(label);
    } else if (ftype === 'slider') {
      const num = document.createElement('input');
      num.type = 'number';
      num.className = 'td-input td-input-number';
      num.value = value ?? 0;
      num.step = 'any';
      num.dataset.tdKey = key;
      wrap.appendChild(num);
    } else if (ftype === 'password') {
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'td-input td-input-text';
      inp.value = value ?? '';
      inp.dataset.tdKey = key;
      wrap.appendChild(inp);
    } else {
      // text, email, select, radio, number, etc.
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'td-input td-input-text';
      inp.value = value ?? '';
      inp.dataset.tdKey = key;
      wrap.appendChild(inp);
    }

    return wrap;
  }

  /**
   * Collect edited values from the Test Data table back into the test case
   */
  function collectTestDataEdits() {
    const tc = JSON.parse(JSON.stringify(testCases[editingIndex]));
    if (!tc) return tc;

    tdTableBody?.querySelectorAll('.td-row').forEach(row => {
      const key = row.dataset.key;
      const inp = row.querySelector('[data-td-key]');
      if (!inp || !key) return;

      if (inp.type === 'checkbox') {
        tc.testData[key] = inp.checked;
      } else if (inp.type === 'number') {
        tc.testData[key] = parseFloat(inp.value) || 0;
      } else {
        tc.testData[key] = inp.value;
      }
    });

    return tc;
  }

  function closeEditor() {
    editorOverlay.classList.add('hidden');
    editingIndex = -1;
    // Restore the BrowserView
    showBrowserView();
  }

  function saveEdits(andReplay) {
    if (editingIndex < 0) return;

    try {
      let edited;
      if (activeEditorTab === 'json') {
        edited = JSON.parse(jsonEditor.value);
      } else {
        edited = collectTestDataEdits();
      }
      testCases[editingIndex] = { ...edited, status: 'recorded', lastRun: null };
      closeEditor();
      render();
      if (andReplay) runTestCase(editingIndex);
    } catch (err) {
      appendLog(`⚠ Save error: ${err.message}`, 'error');
    }
  }

  function duplicateTestCase(idx) {
    const tc = testCases[idx];
    if (!tc) return;
    const dup = JSON.parse(JSON.stringify(tc));
    dup.name = (dup.name || 'Test Case') + ' (copy)';
    dup.id = dup.id + '-copy-' + Date.now();
    dup.status = 'recorded';
    dup.lastRun = null;
    testCases.splice(idx + 1, 0, dup);
    render();
  }

  function downloadTestCase(idx) {
    const tc = testCases[idx];
    if (!tc) return;
    const json = JSON.stringify(tc, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (tc.name || 'testcase').replace(/[^a-zA-Z0-9_-]/g, '_') + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ──────────────────────────────────────────────────────────────
  //  PageData — raw per-step element/locator/value data
  // ──────────────────────────────────────────────────────────────
  function viewPageData(idx) {
    const tc = testCases[idx];
    if (!tc || !tc.pageData || tc.pageData.length === 0) return;

    // Hide browser so the overlay is visible
    hideBrowserView();

    editingIndex = idx;
    if (editorNameEl) editorNameEl.textContent = (tc.name || 'Test Case') + ' — Page Data';

    // Show only the JSON tab with pageData content
    document.querySelectorAll('.td-editor-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.td-tab-content').forEach(c => c.classList.remove('active'));
    const jsonTab  = document.querySelector('.td-editor-tab[data-tab="json"]');
    const jsonPane = document.getElementById('td-tab-json');
    if (jsonTab) jsonTab.classList.add('active');
    if (jsonPane) jsonPane.classList.add('active');
    activeEditorTab = 'json';

    jsonEditor.value = JSON.stringify(tc.pageData, null, 2);
    editorOverlay.classList.remove('hidden');
  }

  function downloadPageData(idx) {
    const tc = testCases[idx];
    if (!tc || !tc.pageData || tc.pageData.length === 0) return;
    const json = JSON.stringify(tc.pageData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (tc.name || 'testcase').replace(/[^a-zA-Z0-9_-]/g, '_') + '_pagedata.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function downloadNetworkLog(idx) {
    const tc = testCases[idx];
    if (!tc || !tc.networkLog || tc.networkLog.length === 0) return;
    const report = {
      testName: tc.name || 'Test Case',
      startUrl: tc.startUrl || '',
      runAt: tc.lastRun ? new Date(tc.lastRun).toISOString() : null,
      status: tc.status,
      totalRequests: tc.networkLog.length,
      requests: tc.networkLog,
    };
    const json = JSON.stringify(report, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (tc.name || 'testcase').replace(/[^a-zA-Z0-9_-]/g, '_') + '_network.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function viewNetworkLog(idx) {
    const tc = testCases[idx];
    if (!tc || !tc.networkLog || tc.networkLog.length === 0) return;
    window.NetworkPanel?.loadRequests?.(tc.networkLog);
    const networkTab = document.querySelector('.panel-tab[data-tab="network"]');
    if (networkTab) networkTab.click();
  }

  function deleteTestCase(idx) {
    testCases.splice(idx, 1);
    render();
  }

  // ─── Inline Rename ──────────────────────────────────────────
  function startInlineRename(idx, nameEl) {
    const tc = testCases[idx];
    if (!tc) return;

    const currentName = tc.name || 'Test Case';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'testcase-rename-input';
    input.value = currentName;

    nameEl.replaceWith(input);
    input.focus();
    input.select();

    let committed = false;

    function commit() {
      if (committed) return;
      committed = true;
      const newName = input.value.trim();
      if (newName && newName !== currentName) {
        tc.name = newName;
      }
      render();
    }

    function cancel() {
      if (committed) return;
      committed = true;
      render();
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
    input.addEventListener('blur', () => commit());
  }

  function updateLatestStatus(data) {
    const idx = testCases.findIndex(tc => tc.status === 'running');
    if (idx >= 0) {
      testCases[idx].status = data.passed ? 'passed' : 'failed';
      testCases[idx].lastRun = Date.now();
      render();
    }
  }

  // ─── Log helper ─────────────────────────────────────────────
  function appendLog(message, level = 'info') {
    if (!logOutputEl) return;
    const line = document.createElement('div');
    line.className = `log-line log-${level}`;
    line.textContent = message;
    logOutputEl.appendChild(line);
    logOutputEl.scrollTop = logOutputEl.scrollHeight;
  }

  // ─── Button bindings ────────────────────────────────────────
  btnSave?.addEventListener('click', () => saveEdits(true));
  btnSaveOnly?.addEventListener('click', () => saveEdits(false));
  btnCancel?.addEventListener('click', closeEditor);
  btnClose?.addEventListener('click', closeEditor);

  btnReplayAll?.addEventListener('click', async () => {
    for (let i = 0; i < testCases.length; i++) {
      await runTestCase(i);
    }
  });

  btnClear?.addEventListener('click', () => {
    testCases.length = 0;
    render();
  });

  btnClearLog?.addEventListener('click', () => {
    if (logOutputEl) logOutputEl.innerHTML = '';
  });

  // ─── Utilities ──────────────────────────────────────────────
  function escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Initial render
  render();

  // ─── State persistence API ──────────────────────────────────
  function getState() {
    return testCases.map(tc => ({ ...tc }));
  }

  function loadState(data) {
    testCases.length = 0;
    if (Array.isArray(data)) {
      data.forEach(tc => testCases.push({ ...tc }));
    }
    render();
  }

  // Expose for external use
  window.TestCaseManager = { addTestCase, render, getState, loadState };
})();
