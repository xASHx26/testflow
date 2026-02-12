/**
 * TestFlow — Report UI
 *
 * Handles:
 *   • "Generate Report" button with progress bar & blocking overlay
 *   • Help → Report Settings (separate window)
 *   • Invoking the main-process report engine and showing results
 */

(function () {
  'use strict';

  const btnGenReport = document.getElementById('btn-generate-report');
  let generating = false;

  // ═══════════════════════════════════════════════════════════
  //  Dark overlay — blocks all interaction while generating
  // ═══════════════════════════════════════════════════════════
  const overlay = document.createElement('div');
  overlay.id = 'report-gen-overlay';
  overlay.innerHTML = `
    <div class="rgo-card">
      <div class="rgo-spinner"></div>
      <div class="rgo-label">Generating report…</div>
      <div class="rgo-bar-track">
        <div class="rgo-bar-fill" id="rgo-bar-fill"></div>
      </div>
      <div class="rgo-pct" id="rgo-pct">0 %</div>
    </div>
  `;
  document.body.appendChild(overlay);

  const barFill = document.getElementById('rgo-bar-fill');
  const pctLabel = document.getElementById('rgo-pct');
  const rgoLabel = overlay.querySelector('.rgo-label');

  function showOverlay() {
    setProgress(0, 'Preparing…');
    overlay.classList.add('visible');
  }
  function hideOverlay() {
    overlay.classList.remove('visible');
  }
  function setProgress(pct, label) {
    const clamped = Math.max(0, Math.min(100, pct));
    barFill.style.width = clamped + '%';
    pctLabel.textContent = clamped + ' %';
    if (label) rgoLabel.textContent = label;
  }

  // Listen for progress events from main process
  window.testflow?.on?.('report:progress', (data) => {
    if (data && typeof data.pct === 'number') {
      setProgress(data.pct, data.label);
    }
  });

  // ═══════════════════════════════════════════════════════════
  //  Generate Report
  // ═══════════════════════════════════════════════════════════

  btnGenReport?.addEventListener('click', async () => {
    if (generating) return;

    const testCases = window.TestCaseManager?.getState?.() || [];
    if (testCases.length === 0) {
      window.Modal?.info?.('No Test Cases', 'Record and run at least one test case before generating a report.');
      return;
    }

    const executed = testCases.filter(tc => tc.status === 'passed' || tc.status === 'failed');
    if (executed.length === 0) {
      window.Modal?.info?.('No Results', 'Run your test cases first so there are results to report.');
      return;
    }

    generating = true;
    btnGenReport.disabled = true;
    btnGenReport.textContent = '⏳ Generating…';
    showOverlay();

    try {
      const execStore = window.TestCaseManager?.getExecutionStore?.() || {};

      const results = testCases.map((_, idx) => {
        const exec = execStore[idx];
        return exec?.results || [];
      });

      const allScreenshots = {};
      for (const exec of Object.values(execStore)) {
        if (exec?.screenshots) {
          Object.assign(allScreenshots, exec.screenshots);
        }
      }

      const runs = Object.values(execStore).filter(e => e);
      const startedAt  = runs.length > 0 ? Math.min(...runs.map(e => e.startedAt))  : Date.now();
      const finishedAt = runs.length > 0 ? Math.max(...runs.map(e => e.finishedAt)) : Date.now();

      const payload = {
        testCases,
        results,
        screenshots: allScreenshots,
        startedAt,
        finishedAt,
        projectName: 'TestFlow Report',
      };

      const result = await window.testflow.report.generate(payload);
      hideOverlay();

      // Open result in a separate modal window
      window.testflow.report.showResult(result);
    } catch (err) {
      hideOverlay();
      console.error('[ReportUI] Report generation error:', err);
      window.testflow.report.showResult({ success: false, error: err.message || 'Unexpected error generating report.' });
    } finally {
      generating = false;
      btnGenReport.disabled = false;
      btnGenReport.textContent = '📊 Report';
    }
  });

  // ═══════════════════════════════════════════════════════════
  //  Report Settings  (Help → Report Settings)
  // ═══════════════════════════════════════════════════════════

  window.testflow?.on?.('menu:report-settings', () => {
    window.testflow.report.openSettingsWindow();
  });

})();
