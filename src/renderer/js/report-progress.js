/* ================================================================
 *  report-progress.js  —  Renderer for Report Progress window
 *
 *  Starts in "progress" mode (spinner + bar).
 *  When the result arrives, transitions to "result" mode
 *  (success/failure + action buttons) in the same window.
 * ================================================================ */
'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const titleEl     = document.getElementById('rp-title');
  const closeBtn    = document.getElementById('rp-close-btn');
  const progressDiv = document.getElementById('rp-progress');
  const resultDiv   = document.getElementById('rp-result');
  const footerEl    = document.getElementById('rp-footer');
  const barFill     = document.getElementById('rp-bar-fill');
  const pctLabel    = document.getElementById('rp-pct');
  const labelEl     = document.getElementById('rp-label');
  const iconEl      = document.getElementById('rp-result-icon');
  const msgEl       = document.getElementById('rp-result-message');
  const pathEl      = document.getElementById('rp-result-path');
  const errorEl     = document.getElementById('rp-result-error');
  const btnClose    = document.getElementById('rp-btn-close');
  const btnFolder   = document.getElementById('rp-btn-folder');
  const btnOpen     = document.getElementById('rp-btn-open');

  let resultData = null;

  /* ── Progress updates ─────────────────────────── */
  window.reportProgressBridge.onProgress((data) => {
    if (data && typeof data.pct === 'number') {
      const clamped = Math.max(0, Math.min(100, data.pct));
      barFill.style.width = clamped + '%';
      pctLabel.textContent = clamped + ' %';
      if (data.label) labelEl.textContent = data.label;
    }
  });

  /* ── Final result ─────────────────────────────── */
  window.reportProgressBridge.onResult((data) => {
    resultData = data || {};

    // Transition: hide progress, show result
    progressDiv.style.display = 'none';
    resultDiv.style.display = 'flex';
    footerEl.style.display = 'flex';
    closeBtn.style.display = 'flex';

    if (resultData.success) {
      titleEl.textContent = 'Report Generated';
      iconEl.textContent = '✅';
      msgEl.textContent = 'Report saved successfully!';
      pathEl.textContent = '📁 ' + (resultData.reportDir || '');
      pathEl.style.display = 'block';
      btnFolder.style.display = '';
      btnOpen.style.display = '';
    } else {
      titleEl.textContent = 'Report Failed';
      iconEl.textContent = '❌';
      msgEl.textContent = 'Report generation failed';
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
