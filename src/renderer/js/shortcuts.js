/* ================================================================
 *  shortcuts.js  —  Renderer for Keyboard Shortcuts window
 * ================================================================ */
'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const btnClose = document.getElementById('btn-close');
  const btnOk    = document.getElementById('btn-ok');

  function doClose() { window.shortcutsBridge.close(); }

  btnClose.addEventListener('click', doClose);
  btnOk.addEventListener('click', doClose);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') doClose();
  });
});
