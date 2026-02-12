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
  //  Report Settings Modal  (Help → Report Settings)
  // ═══════════════════════════════════════════════════════════

  window.testflow?.on?.('menu:report-settings', () => openReportSettings());

  async function openReportSettings() {
    let settings;
    try {
      settings = await window.testflow.report.getSettings();
    } catch {
      settings = {};
    }

    const ss = settings.screenshot || {};
    const st = settings.storage    || {};
    const adv = settings.advanced  || {};

    const bodyHtml = `
    <div class="report-settings-form" style="max-height:60vh;overflow-y:auto;font-size:0.85rem;line-height:1.8;">

      <h4 style="margin:0 0 8px;color:var(--blue);">📸 Screenshot Strategy</h4>
      <label class="rs-toggle"><input type="checkbox" data-path="screenshot.afterEachStep" ${ss.afterEachStep ? 'checked' : ''}/> After each step</label>
      <label class="rs-toggle"><input type="checkbox" data-path="screenshot.afterFailure" ${ss.afterFailure ? 'checked' : ''}/> After failure</label>
      <label class="rs-toggle"><input type="checkbox" data-path="screenshot.afterEachTestCase" ${ss.afterEachTestCase ? 'checked' : ''}/> After each test case</label>
      <label class="rs-toggle"><input type="checkbox" data-path="screenshot.beforeEachStep" ${ss.beforeEachStep ? 'checked' : ''}/> Before each step</label>
      <label class="rs-toggle"><input type="checkbox" data-path="screenshot.captureFullPage" ${ss.captureFullPage ? 'checked' : ''}/> Capture full page</label>
      <label class="rs-toggle"><input type="checkbox" data-path="screenshot.compressImages" ${ss.compressImages ? 'checked' : ''}/> Compress images</label>

      <h4 style="margin:16px 0 8px;color:var(--blue);">📁 Report Storage</h4>
      <label class="rs-field">Save location <input type="text" data-path="storage.reportFolder" value="${escHtml(st.reportFolder || '')}" placeholder="(default: Documents/TestFlow Reports)" style="width:100%;"/></label>
      <label class="rs-toggle"><input type="checkbox" data-path="storage.autoTimestampFolder" ${st.autoTimestampFolder ? 'checked' : ''}/> Auto-create timestamped folder</label>
      <label class="rs-toggle"><input type="checkbox" data-path="storage.overwritePrevious" ${st.overwritePrevious ? 'checked' : ''}/> Overwrite previous report</label>
      <label class="rs-field">Retain last N reports <input type="number" data-path="storage.retainLastN" value="${st.retainLastN ?? 10}" min="1" max="999" style="width:70px;"/></label>
      <label class="rs-toggle"><input type="checkbox" data-path="storage.includeRawJson" ${st.includeRawJson ? 'checked' : ''}/> Include raw JSON snapshot</label>

      <h4 style="margin:16px 0 8px;color:var(--blue);">⚙ Advanced</h4>
      <label class="rs-toggle"><input type="checkbox" data-path="advanced.includeNetworkLogs" ${adv.includeNetworkLogs ? 'checked' : ''}/> Include network logs</label>
      <label class="rs-toggle"><input type="checkbox" data-path="advanced.includeConsoleLogs" ${adv.includeConsoleLogs ? 'checked' : ''}/> Include console logs</label>
      <label class="rs-toggle"><input type="checkbox" data-path="advanced.includeTimingBreakdown" ${adv.includeTimingBreakdown ? 'checked' : ''}/> Include timing breakdown</label>
      <label class="rs-toggle"><input type="checkbox" data-path="advanced.anonymizeSensitiveData" ${adv.anonymizeSensitiveData ? 'checked' : ''}/> Anonymize sensitive data</label>
    </div>

    <style>
      .rs-toggle{display:block;padding:3px 0;cursor:pointer;user-select:none;}
      .rs-toggle input{margin-right:8px;accent-color:var(--blue);}
      .rs-field{display:block;padding:3px 0;}
      .rs-field input[type="text"],.rs-field input[type="number"]{
        background:var(--surface0);border:1px solid var(--surface1);color:var(--text);
        padding:4px 8px;border-radius:4px;margin-top:2px;font-family:inherit;font-size:0.82rem;
      }
    </style>
    `;

    const choice = await window.Modal?.custom?.(
      'Report Settings',
      bodyHtml,
      [
        { label: 'Reset Defaults', className: 'btn-secondary', value: 'reset' },
        { label: 'Cancel',         className: 'btn-secondary', value: 'cancel' },
        { label: 'Save',           className: 'btn-primary',   value: 'save' },
      ],
    );

    if (choice === 'reset') {
      await window.testflow.report.resetSettings();
      window.Modal?.info?.('Settings Reset', 'Report settings have been reset to defaults.');
      return;
    }

    if (choice === 'save') {
      // Collect values from the form
      const partial = {};
      const overlay = document.getElementById('modal-overlay');
      overlay?.querySelectorAll('[data-path]').forEach(el => {
        const path = el.dataset.path.split('.');
        const value = el.type === 'checkbox' ? el.checked
                    : el.type === 'number'   ? parseInt(el.value, 10)
                    : el.value;
        let obj = partial;
        for (let i = 0; i < path.length - 1; i++) {
          if (!obj[path[i]]) obj[path[i]] = {};
          obj = obj[path[i]];
        }
        obj[path[path.length - 1]] = value;
      });

      await window.testflow.report.updateSettings(partial);
    }
  }

  // ─── Helpers ────────────────────────────────────────────────
  function escHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

})();
