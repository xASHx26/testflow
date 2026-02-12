/* ================================================================
 *  report-result.js  —  Renderer script for Report Result window
 * ================================================================ */
'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  const titleEl   = document.getElementById('rr-title');
  const iconEl    = document.getElementById('rr-icon');
  const msgEl     = document.getElementById('rr-message');
  const pathEl    = document.getElementById('rr-path');
  const errorEl   = document.getElementById('rr-error');
  const footerEl  = document.getElementById('rr-footer');
  const btnClose  = document.getElementById('rr-btn-close');
  const btnFolder = document.getElementById('rr-btn-folder');
  const btnOpen   = document.getElementById('rr-btn-open');
  const closeBtn  = document.getElementById('rr-close-btn');

  let data = {};

  try {
    data = await window.reportResultBridge.getData() || {};
  } catch (err) {
    console.error('[ReportResult] Failed to get data:', err);
    data = { success: false, error: 'Failed to load result data.' };
  }

  if (data.success) {
    titleEl.textContent = 'Report Generated';
    iconEl.textContent = '✅';
    msgEl.textContent = 'Report saved successfully!';
    pathEl.textContent = '📁 ' + (data.reportDir || '');
    pathEl.style.display = 'block';
    btnFolder.style.display = '';
    btnOpen.style.display = '';
  } else {
    titleEl.textContent = 'Report Failed';
    iconEl.textContent = '❌';
    msgEl.textContent = 'Report generation failed';
    errorEl.textContent = data.error || 'An unknown error occurred.';
    errorEl.style.display = 'block';
    // Hide action buttons on failure
    btnFolder.style.display = 'none';
    btnOpen.style.display = 'none';
  }

  /* ── Button handlers ─────────────────────────────────────── */
  btnClose.addEventListener('click', () => window.reportResultBridge.close());
  closeBtn.addEventListener('click', () => window.reportResultBridge.close());

  btnOpen.addEventListener('click', () => {
    if (data.indexPath) window.reportResultBridge.openReport(data.indexPath);
    window.reportResultBridge.close();
  });

  btnFolder.addEventListener('click', () => {
    if (data.reportDir) window.reportResultBridge.openFolder(data.reportDir);
    window.reportResultBridge.close();
  });

  /* Escape to close */
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') window.reportResultBridge.close();
  });
});
