/* ================================================================
 *  report-progress.js  —  Renderer for Report Progress window
 *
 *  Starts in "progress" mode (spinner + bar + phase label).
 *  When the result arrives, transitions to "result" mode
 *  (success/failure banner + action buttons) in the same window.
 *  Visual style matches the Report Settings window.
 * ================================================================ */
'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const titleEl           = document.getElementById('rp-title');
  const titleIcon         = document.getElementById('rp-title-icon');
  const closeBtn          = document.getElementById('rp-close-btn');
  const progressSection   = document.getElementById('rp-progress-section');
  const resultSection     = document.getElementById('rp-result-section');
  const footerEl          = document.getElementById('rp-footer');
  const barFill           = document.getElementById('rp-bar-fill');
  const pctLabel          = document.getElementById('rp-pct');
  const labelEl           = document.getElementById('rp-label');
  const phaseHint         = document.getElementById('rp-phase-hint');
  const resultBanner      = document.getElementById('rp-result-banner');
  const resultHeadingIcon = document.getElementById('rp-result-heading-icon');
  const resultHeadingText = document.getElementById('rp-result-heading-text');
  const iconEl            = document.getElementById('rp-result-icon');
  const msgEl             = document.getElementById('rp-result-message');
  const subEl             = document.getElementById('rp-result-sub');
  const pathEl            = document.getElementById('rp-result-path');
  const errorEl           = document.getElementById('rp-result-error');
  const btnClose          = document.getElementById('rp-btn-close');
  const btnFolder         = document.getElementById('rp-btn-folder');
  const btnOpen           = document.getElementById('rp-btn-open');

  let resultData = null;

  /* ── Progress updates ─────────────────────────── */
  window.reportProgressBridge.onProgress((data) => {
    if (data && typeof data.pct === 'number') {
      const clamped = Math.max(0, Math.min(100, data.pct));
      barFill.style.width = clamped + '%';
      pctLabel.textContent = clamped + ' %';
      if (data.label) {
        labelEl.textContent = data.label;
        phaseHint.textContent = data.label;
      }
    }
  });

  /* ── Final result ─────────────────────────────── */
  window.reportProgressBridge.onResult((data) => {
    resultData = data || {};

    // Transition: hide progress section, show result section + footer
    progressSection.style.display = 'none';
    resultSection.style.display = 'block';
    footerEl.style.display = 'flex';
    closeBtn.classList.add('visible');

    if (resultData.success) {
      titleIcon.textContent = '✅';
      titleEl.textContent = 'Report Generated';
      resultHeadingIcon.textContent = '✅';
      resultHeadingText.textContent = 'Report Complete';
      resultBanner.className = 'rp-result-banner success';
      iconEl.textContent = '✅';
      msgEl.textContent = 'Report saved successfully!';
      subEl.textContent = 'Your report is ready to view';
      pathEl.textContent = '📁 ' + (resultData.reportDir || '');
      pathEl.style.display = 'block';
      btnFolder.style.display = '';
      btnOpen.style.display = '';
    } else {
      titleIcon.textContent = '❌';
      titleEl.textContent = 'Report Failed';
      resultHeadingIcon.textContent = '❌';
      resultHeadingText.textContent = 'Generation Failed';
      resultBanner.className = 'rp-result-banner failure';
      iconEl.textContent = '❌';
      msgEl.textContent = 'Report generation failed';
      subEl.textContent = 'An error occurred during generation';
      errorEl.textContent = resultData.error || 'An unknown error occurred.';
      errorEl.style.display = 'block';
      btnFolder.style.display = 'none';
      btnOpen.style.display = 'none';
    }
  });

  /* ── Button handlers ──────────────────────────── */
  function doClose() { window.reportProgressBridge.close(); }

  btnClose.addEventListener('click', doClose);
  closeBtn.addEventListener('click', doClose);

  btnOpen.addEventListener('click', () => {
    if (resultData?.indexPath) window.reportProgressBridge.openReport(resultData.indexPath);
    doClose();
  });

  btnFolder.addEventListener('click', () => {
    if (resultData?.reportDir) window.reportProgressBridge.openFolder(resultData.reportDir);
    doClose();
  });

  /* Escape to close (only when result is showing) */
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && resultData) doClose();
  });
});
