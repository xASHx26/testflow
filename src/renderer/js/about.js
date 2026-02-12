/* ================================================================
 *  about.js  —  Renderer for About TestFlow window
 * ================================================================ */
'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  const btnClose = document.getElementById('btn-close');
  const btnOk    = document.getElementById('btn-ok');
  const linkRepo = document.getElementById('link-repo');

  // Populate system info
  try {
    const info = await window.aboutBridge.getSystemInfo();
    if (info) {
      document.getElementById('info-version').textContent   = info.appVersion || '—';
      document.getElementById('info-electron').textContent  = info.electronVersion || '—';
      document.getElementById('info-chromium').textContent   = info.chromeVersion || '—';
      document.getElementById('info-node').textContent       = info.nodeVersion || '—';
      document.getElementById('info-platform').textContent   = info.platform || '—';
      document.getElementById('info-arch').textContent       = info.arch || '—';
    }
  } catch (e) {
    console.error('[About] Failed to get system info:', e);
  }

  // Close handlers
  function doClose() { window.aboutBridge.close(); }
  btnClose.addEventListener('click', doClose);
  btnOk.addEventListener('click', doClose);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') doClose(); });

  // Open repo link
  linkRepo.addEventListener('click', (e) => {
    e.preventDefault();
    window.aboutBridge.openExternal('https://github.com/xASHx26/testflow');
  });
});
