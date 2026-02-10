/**
 * TestFlow — Test Case Manager
 *
 * Manages test case CRUD in the Replay Log tab.
 * Receives generated test cases from the recorder, displays them as cards,
 * and supports edit (JSON editor), duplicate, delete, and re-run.
 */

(function () {
  'use strict';

  const testCases = []; // in-memory store
  let editingIndex = -1;

  // ─── DOM refs ────────────────────────────────────────────────
  const listEl = document.getElementById('testcase-list');
  const logOutputEl = document.getElementById('replay-log-output');
  const editorOverlay = document.getElementById('testcase-editor-overlay');
  const jsonEditor = document.getElementById('testcase-json-editor');
  const btnSave = document.getElementById('btn-save-testcase');
  const btnCancel = document.getElementById('btn-cancel-testcase');
  const btnClose = document.getElementById('btn-close-editor');
  const btnReplayAll = document.getElementById('btn-replay-all');
  const btnClear = document.getElementById('btn-clear-testcases');
  const btnClearLog = document.getElementById('btn-clear-replay-log');

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
      // Update the latest replayed test case status
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
    // Auto-switch to Replay Log tab
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
    const inputSteps = tc.steps?.filter(s => s.testData)?.length || 0;

    card.innerHTML = `
      <div class="testcase-card-header">
        <span class="testcase-status-icon">${statusIcon}</span>
        <span class="testcase-name">${escHtml(tc.name || 'Test Case')}</span>
        <span class="testcase-meta">${stepsCount} steps${inputSteps ? `, ${inputSteps} inputs` : ''}</span>
      </div>
      <div class="testcase-card-body">
        <div class="testcase-url">${escHtml(tc.startUrl || '—')}</div>
        ${tc.lastRun ? `<div class="testcase-lastrun">Last run: ${new Date(tc.lastRun).toLocaleTimeString()}</div>` : ''}
      </div>
      <div class="testcase-card-actions">
        <button class="tc-btn tc-btn-play" data-action="play" title="Replay this test case">
          <span class="icon icon-play"></span> Run
        </button>
        <button class="tc-btn tc-btn-edit" data-action="edit" title="Edit test case JSON">
          <span class="icon icon-edit"></span> Edit
        </button>
        <button class="tc-btn tc-btn-dup" data-action="duplicate" title="Duplicate">
          <span class="icon icon-clipboard"></span> Dup
        </button>
        <button class="tc-btn tc-btn-download" data-action="download" title="Download JSON">
          ↓ JSON
        </button>
        <button class="tc-btn tc-btn-download" data-action="view-network" title="View Network Log"${tc.networkLog && tc.networkLog.length ? '' : ' disabled'}>
          👁 Network
        </button>
        <button class="tc-btn tc-btn-download" data-action="download-network" title="Download Network Log"${tc.networkLog && tc.networkLog.length ? '' : ' disabled'}>
          ↓ Network
        </button>
        <button class="tc-btn tc-btn-del" data-action="delete" title="Delete">✕</button>
      </div>
    `;

    // Delegated action handler
    card.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'play') runTestCase(idx);
      else if (action === 'edit') openEditor(idx);
      else if (action === 'duplicate') duplicateTestCase(idx);
      else if (action === 'download') downloadTestCase(idx);
      else if (action === 'view-network') viewNetworkLog(idx);
      else if (action === 'download-network') downloadNetworkLog(idx);
      else if (action === 'delete') deleteTestCase(idx);
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
    // Snapshot network log from this test run
    tc.networkLog = window.NetworkPanel?.getRequests?.() || [];
    render();
  }

  function openEditor(idx) {
    editingIndex = idx;
    const tc = testCases[idx];
    if (!tc) return;
    jsonEditor.value = JSON.stringify(tc, null, 2);
    editorOverlay.classList.remove('hidden');
  }

  function closeEditor() {
    editorOverlay.classList.add('hidden');
    editingIndex = -1;
  }

  function saveAndReplay() {
    if (editingIndex < 0) return;
    try {
      const edited = JSON.parse(jsonEditor.value);
      testCases[editingIndex] = { ...edited, status: 'recorded', lastRun: null };
      closeEditor();
      render();
      // Re-run the edited test case
      runTestCase(editingIndex);
    } catch (err) {
      alert('Invalid JSON: ' + err.message);
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
    // Load saved network requests into the Network panel
    window.NetworkPanel?.loadRequests?.(tc.networkLog);
    // Switch to the Network tab
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

    // Replace the span with the input
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
    // Find the test case that was just replayed (latest running)
    const idx = testCases.findIndex(tc => tc.status === 'running');
    if (idx >= 0) {
      testCases[idx].status = data.passed ? 'passed' : 'failed';
      testCases[idx].lastRun = Date.now();
      render();
    }
  }

  // ─── Log helper (writes to the right-side replay log pane) ──
  function appendLog(message, level = 'info') {
    if (!logOutputEl) return;
    const line = document.createElement('div');
    line.className = `log-line log-${level}`;
    line.textContent = message;
    logOutputEl.appendChild(line);
    logOutputEl.scrollTop = logOutputEl.scrollHeight;
  }

  // ─── Button bindings ────────────────────────────────────────
  btnSave?.addEventListener('click', saveAndReplay);
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
