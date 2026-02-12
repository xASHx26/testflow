/**
 * TestFlow — Report UI
 *
 * Handles:
 *   • "Generate Report" button — opens a modal progress window
 *   • Help → Report Settings (separate window)
 *   • Progress + result shown in the same modal window
 */

(function () {
  'use strict';

  const btnGenReport = document.getElementById('btn-generate-report');
  let generating = false;

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

    // Open the modal progress window (blocks main window)
    await window.testflow.report.openProgressWindow();

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

      // Generate — progress + result are sent to the progress window by main process
      await window.testflow.report.generate(payload);
    } catch (err) {
      console.error('[ReportUI] Report generation error:', err);
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
