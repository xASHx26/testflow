/**
 * TestFlow — Report UI
 *
 * Handles:
 *   • "Generate Report" button in the Replay Log tab
 *   • Help → Report Settings modal
 *   • Invoking the main-process report engine and showing results
 */

(function () {
  'use strict';

  const btnGenReport = document.getElementById('btn-generate-report');

  // ═══════════════════════════════════════════════════════════
  //  Generate Report
  // ═══════════════════════════════════════════════════════════

  btnGenReport?.addEventListener('click', async () => {
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

    btnGenReport.disabled = true;
    btnGenReport.textContent = '⏳ Generating…';

    try {
      const execStore = window.TestCaseManager?.getExecutionStore?.() || {};

      // Build results arrays aligned with testCases
      const results = testCases.map((_, idx) => {
        const exec = execStore[idx];
        return exec?.results || [];
      });

      // Merge all screenshots from every test case run
      const allScreenshots = {};
      for (const exec of Object.values(execStore)) {
        if (exec?.screenshots) {
          Object.assign(allScreenshots, exec.screenshots);
        }
      }

      // Determine timestamps
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

      if (result.success) {
        const choice = await window.Modal?.custom?.(
          'Report Generated',
          `<div style="font-size:0.9rem;line-height:1.7;">
            <p>✅ Report saved successfully!</p>
            <p style="color:var(--overlay1);font-size:0.82rem;margin-top:8px;word-break:break-all;">
              📁 ${escHtml(result.reportDir)}
            </p>
          </div>`,
          [
            { label: 'Close', className: 'btn-secondary', value: 'close' },
            { label: 'Open Folder', className: 'btn-secondary', value: 'folder' },
            { label: 'Open Report', className: 'btn-primary', value: 'open' },
          ],
        );
        if (choice === 'open')   window.testflow.report.openHtml(result.indexPath);
        if (choice === 'folder') window.testflow.report.openFolder(result.reportDir);
      } else {
        window.Modal?.info?.('Report Failed', result.error || 'An unknown error occurred.');
      }
    } catch (err) {
      console.error('[ReportUI] Report generation error:', err);
      window.Modal?.info?.('Report Error', err.message || 'Unexpected error generating report.');
    } finally {
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

  // ─── Helpers ────────────────────────────────────────────────
  function escHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

})();
