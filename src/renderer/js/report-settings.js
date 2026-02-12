/* ================================================================
 *  report-settings.js  —  Renderer script for Report Settings window
 * ================================================================ */
'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  const btnSave   = document.getElementById('btn-save');
  const btnCancel = document.getElementById('btn-cancel');
  const btnClose  = document.getElementById('btn-close');
  const btnReset  = document.getElementById('btn-reset');
  const saveStatus = document.getElementById('save-status');

  /* ── helpers ────────────────────────────────────────────────── */
  function getByPath(obj, path) {
    return path.split('.').reduce((o, k) => o?.[k], obj);
  }

  function setByPath(obj, path, value) {
    const keys = path.split('.');
    let cur = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      if (cur[keys[i]] === undefined) cur[keys[i]] = {};
      cur = cur[keys[i]];
    }
    cur[keys[keys.length - 1]] = value;
  }

  function flashSaved() {
    saveStatus.classList.add('visible');
    setTimeout(() => saveStatus.classList.remove('visible'), 1800);
  }

  /* ── populate form from settings ───────────────────────────── */
  function populateForm(settings) {
    document.querySelectorAll('[data-path]').forEach(el => {
      const val = getByPath(settings, el.dataset.path);
      if (val === undefined) return;
      if (el.type === 'checkbox') {
        el.checked = !!val;
      } else if (el.type === 'number') {
        el.value = Number(val);
      } else {
        el.value = val ?? '';
      }
    });
  }

  /* ── collect form values into partial settings ─────────────── */
  function collectForm() {
    const partial = {};
    document.querySelectorAll('[data-path]').forEach(el => {
      let val;
      if (el.type === 'checkbox') val = el.checked;
      else if (el.type === 'number') val = Number(el.value) || 0;
      else val = el.value;
      setByPath(partial, el.dataset.path, val);
    });
    return partial;
  }

  /* ── init ───────────────────────────────────────────────────── */
  try {
    const settings = await window.reportSettingsBridge.getSettings();
    populateForm(settings);
  } catch (err) {
    console.error('[ReportSettings] Failed to load settings:', err);
  }

  /* ── save ───────────────────────────────────────────────────── */
  btnSave.addEventListener('click', async () => {
    try {
      const partial = collectForm();
      await window.reportSettingsBridge.save(partial);
      flashSaved();
      // auto-close after short delay to let user see "Saved"
      setTimeout(() => window.reportSettingsBridge.close(), 600);
    } catch (err) {
      console.error('[ReportSettings] Failed to save:', err);
    }
  });

  /* ── reset defaults ─────────────────────────────────────────── */
  btnReset.addEventListener('click', async () => {
    try {
      const defaults = await window.reportSettingsBridge.reset();
      populateForm(defaults);
      flashSaved();
    } catch (err) {
      console.error('[ReportSettings] Failed to reset:', err);
    }
  });

  /* ── cancel / close ─────────────────────────────────────────── */
  btnCancel.addEventListener('click', () => window.reportSettingsBridge.close());
  btnClose.addEventListener('click',  () => window.reportSettingsBridge.close());

  /* keyboard shortcut: Escape to close */
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') window.reportSettingsBridge.close();
  });
});
