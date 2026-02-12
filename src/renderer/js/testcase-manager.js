/**
 * TestFlow — Test Case Manager
 *
 * Manages test case CRUD in the Replay Log tab.
 * The editor now opens in a separate modal BrowserWindow (editor-window.html)
 * to avoid z-index / BrowserView overlap issues.
 */

(function () {
  'use strict';

  const testCases = []; // in-memory store
  let editingIndex = -1;

  /**
   * Stores per-test-case execution results for report generation.
   * Populated during runTestCase(), consumed by report-ui.js.
   * Shape: { [testCaseIndex]: { results: [...], screenshots: {...}, startedAt, finishedAt } }
   */
  const executionStore = {};

  // ─── DOM refs ────────────────────────────────────────────────
  const listEl          = document.getElementById('testcase-list');
  const logOutputEl     = document.getElementById('replay-log-output');
  const btnReplayAll    = document.getElementById('btn-replay-all');
  const btnClear        = document.getElementById('btn-clear-testcases');
  const btnClearLog     = document.getElementById('btn-clear-replay-log');
  const btnReport       = document.getElementById('btn-generate-report');

  // ─── Listen for saved results from the modal editor window ──
  if (window.testflow?.editor?.onSaved) {
    window.testflow.editor.onSaved((data) => {
      const { tc, andReplay } = data;
      if (editingIndex >= 0 && editingIndex < testCases.length) {
        testCases[editingIndex] = { ...tc, status: 'recorded', lastRun: null };
        render();
        if (andReplay) runTestCase(editingIndex);
      }
      editingIndex = -1;
    });
  }

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
    const startedAt = Date.now();
    render();
    try {
      const result = await window.testflow.replay.runTestCase(tc);
      tc.status = result?.results?.every(r => r.status === 'passed') ? 'passed' : 'failed';
      // Store execution data for report generation
      executionStore[idx] = {
        results: result?.results || [],
        screenshots: result?.screenshots || {},
        startedAt,
        finishedAt: Date.now(),
      };
    } catch (err) {
      tc.status = 'failed';
      executionStore[idx] = {
        results: [],
        screenshots: {},
        startedAt,
        finishedAt: Date.now(),
      };
      appendLog(`⚠ Error running test case: ${err.message || err}`, 'error');
    }
    tc.networkLog = window.NetworkPanel?.getRequests?.() || [];
    // Enable the report button now that at least one test has been executed
    if (btnReport) btnReport.disabled = false;
    render();
  }

  // ──────────────────────────────────────────────────────────────
  //  Test Data Editor — opens a separate modal BrowserWindow
  // ──────────────────────────────────────────────────────────────
  function openEditor(idx) {
    editingIndex = idx;
    const tc = testCases[idx];
    if (!tc) return;
    window.testflow?.editor?.open?.({ tc, mode: 'edit' });
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
    editingIndex = idx;
    window.testflow?.editor?.open?.({ tc, mode: 'pagedata' });
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
    // Also remove execution data for this index and re-index
    delete executionStore[idx];
    const newStore = {};
    for (const [k, v] of Object.entries(executionStore)) {
      const ki = parseInt(k, 10);
      if (ki > idx) newStore[ki - 1] = v;
      else newStore[ki] = v;
    }
    Object.keys(executionStore).forEach(k => delete executionStore[k]);
    Object.assign(executionStore, newStore);
    // Disable report button if no executed tests remain
    if (btnReport && Object.keys(executionStore).length === 0) btnReport.disabled = true;
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
      // Enable the report button now that at least one test has been executed
      if (btnReport) btnReport.disabled = false;
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
  btnReplayAll?.addEventListener('click', async () => {
    for (let i = 0; i < testCases.length; i++) {
      await runTestCase(i);
    }
  });

  btnClear?.addEventListener('click', () => {
    testCases.length = 0;
    // Clear execution data and disable report button
    Object.keys(executionStore).forEach(k => delete executionStore[k]);
    if (btnReport) btnReport.disabled = true;
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
  window.TestCaseManager = { addTestCase, render, getState, loadState, getExecutionStore: () => ({ ...executionStore }) };
})();
