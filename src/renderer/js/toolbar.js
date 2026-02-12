/**
 * TestFlow — Toolbar Controller
 * 
 * Handles toolbar button interactions, URL navigation,
 * recording/replay controls, and tool toggles.
 */

class Toolbar {
  constructor() {
    this.isRecording = false;
    this.isPaused = false;
    this.isReplaying = false;
    this.isFrozen = false;
    this.isInspecting = false;

    this._bindElements();
    this._bindEvents();
    this._bindMenuEvents();
    this._initBookmarks();
  }

  _bindElements() {
    this.urlInput = document.getElementById('url-input');
    this.btnNavigate = document.getElementById('btn-navigate');
    this.btnBookmarkStar = document.getElementById('btn-bookmark-star');
    this.btnBack = document.getElementById('btn-back');
    this.btnForward = document.getElementById('btn-forward');
    this.btnReload = document.getElementById('btn-reload');

    this.btnRecord = document.getElementById('btn-record');
    this.btnStop = document.getElementById('btn-stop');
    this.btnPause = document.getElementById('btn-pause');

    this.btnReplay = document.getElementById('btn-replay');
    this.btnReplayStep = document.getElementById('btn-replay-step');
    this.btnReplayStop = document.getElementById('btn-replay-stop');

    this.btnFreeze = document.getElementById('btn-freeze');
    this.btnScreenshot = document.getElementById('btn-screenshot');
    this.btnInspector = document.getElementById('btn-inspector');
    this.btnMiniInspector = document.getElementById('btn-mini-inspector');

    this.workspacePreset = document.getElementById('workspace-preset');
    this.statusDot = document.querySelector('.status-dot');
    this.statusText = document.querySelector('.status-text');
  }

  _bindEvents() {
    // Navigation
    this.btnNavigate.addEventListener('click', () => this._navigate());
    this.urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._navigate();
    });
    this.btnBack.addEventListener('click', () => window.testflow.browser.back());
    this.btnForward.addEventListener('click', () => window.testflow.browser.forward());
    this.btnReload.addEventListener('click', () => window.testflow.browser.reload());

    // Track URL changes from BrowserView navigation
    window.testflow.browser.onNavigated((url) => {
      if (url && this.urlInput) {
        this.urlInput.value = url;
        this._updateBookmarkStar();
      }
    });

    // Bookmark star toggle
    this.btnBookmarkStar.addEventListener('click', () => this._toggleBookmarkStar());

    // Quick actions
    document.querySelectorAll('.quick-action-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.urlInput.value = btn.dataset.url;
        this._navigate();
      });
    });

    // Recording
    this.btnRecord.addEventListener('click', () => this._toggleRecording());
    this.btnStop.addEventListener('click', () => this._stopRecording());
    this.btnPause.addEventListener('click', () => this._togglePause());

    // Replay
    this.btnReplay.addEventListener('click', () => this._startReplay());
    this.btnReplayStep.addEventListener('click', () => this._replayStep());
    this.btnReplayStop.addEventListener('click', () => this._stopReplay());

    // Tools
    this.btnFreeze.addEventListener('click', () => this._toggleFreeze());
    this.btnScreenshot.addEventListener('click', () => this._captureScreenshot());
    this.btnInspector.addEventListener('click', () => this._toggleInspector());
    this.btnMiniInspector.addEventListener('click', () => this._toggleMiniInspector());

    // Workspace preset
    this.workspacePreset.addEventListener('change', () => {
      window.EventBus.emit('workspace:preset-change', this.workspacePreset.value);
    });

    // Listen for natural replay completion (from app.js → EventBus)
    window.EventBus.on('replay:stopped', () => {
      if (this.isReplaying) {
        this._resetReplayUI();
      }
    });
  }

  _bindMenuEvents() {
    // Listen for menu actions from main process
    window.testflow.on('menu:recorder-start', () => this._toggleRecording());
    window.testflow.on('menu:recorder-stop', () => this._stopRecording());
    window.testflow.on('menu:recorder-toggle-pause', () => this._togglePause());
    window.testflow.on('menu:replay-start', () => this._startReplay());
    window.testflow.on('menu:replay-stop', () => this._stopReplay());
    window.testflow.on('menu:replay-step', () => this._replayStep());
    window.testflow.on('menu:freeze-toggle', () => this._toggleFreeze());
    window.testflow.on('menu:screenshot', () => this._captureScreenshot());
    window.testflow.on('menu:inspector-toggle', () => this._toggleInspector());
    window.testflow.on('menu:mini-inspector-toggle', () => this._toggleMiniInspector());

    // Export menu items
    window.testflow.on('menu:export-selenium-python', () => this._export('seleniumPython', 'Selenium Python'));
    window.testflow.on('menu:export-markdown', () => this._export('markdown', 'Markdown Report'));
    window.testflow.on('menu:export-json', () => this._export('json', 'JSON Flow Data'));
  }

  // ─── Navigation ──────────────────────────────────────────

  /**
   * Detect whether raw input looks like a URL or a search query.
   * Returns a navigable URL (either the original or a Google search).
   */
  _resolveUrl(raw) {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    // Already has a protocol
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    // Looks like a domain (has dots, no spaces, valid TLD-like pattern)
    if (/^[^\s]+\.[a-z]{2,}(\/.*)?$/i.test(trimmed)) return 'https://' + trimmed;
    // localhost or IP address
    if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?/i.test(trimmed)) return 'http://' + trimmed;
    // Otherwise treat as a Google search
    return 'https://www.google.com/search?q=' + encodeURIComponent(trimmed);
  }

  async _navigate() {
    const raw = this.urlInput.value.trim();
    if (!raw) return;

    const url = this._resolveUrl(raw);

    try {
      // Ensure browser view is attached
      const bounds = window.PanelManager.getBrowserBounds();
      await window.testflow.browser.attachView(bounds);

      // Hide placeholder
      const placeholder = document.getElementById('browser-placeholder');
      if (placeholder) placeholder.classList.add('hidden');

      // Navigate
      const navigatedUrl = await window.testflow.browser.navigate(url);
      this.urlInput.value = navigatedUrl;
      this._updateBookmarkStar();
      this._log('info', `Navigated to ${navigatedUrl}`);
    } catch (err) {
      this._log('error', `Navigation failed: ${err.message}`);
    }
  }

  // ─── Recording ───────────────────────────────────────────
  async _toggleRecording() {
    if (this.isRecording) {
      return this._stopRecording();
    }

    try {
      const activeFlow = window.FlowEditor?.activeFlowId;
      const result = await window.testflow.recorder.start(activeFlow);
      if (result.success) {
        this.isRecording = true;
        this.btnRecord.classList.add('active');
        this.btnStop.disabled = false;
        this.btnPause.disabled = false;
        this._setStatus('recording', 'Recording');
        this._log('recorder', 'Recording started');
        window.EventBus.emit('recorder:started', result);
      }
    } catch (err) {
      this._log('error', `Failed to start recording: ${err.message}`);
    }
  }

  async _stopRecording() {
    try {
      const result = await window.testflow.recorder.stop();
      this.isRecording = false;
      this.isPaused = false;
      this.btnRecord.classList.remove('active');
      this.btnStop.disabled = true;
      this.btnPause.disabled = true;
      this.btnPause.querySelector('.btn-label').textContent = 'Pause';
      this._setStatus('idle', 'Ready');
      this._log('recorder', 'Recording stopped');
      window.EventBus.emit('recorder:stopped', result);
    } catch (err) {
      this._log('error', `Failed to stop recording: ${err.message}`);
    }
  }

  async _togglePause() {
    if (this.isPaused) {
      await window.testflow.recorder.resume();
      this.isPaused = false;
      this.btnPause.querySelector('.btn-label').textContent = 'Pause';
      this._setStatus('recording', 'Recording');
      this._log('recorder', 'Recording resumed');
    } else {
      await window.testflow.recorder.pause();
      this.isPaused = true;
      this.btnPause.querySelector('.btn-label').textContent = 'Resume';
      this._setStatus('idle', 'Paused');
      this._log('recorder', 'Recording paused');
    }
  }

  // ─── Replay ──────────────────────────────────────────────
  async _startReplay() {
    try {
      const activeFlow = window.FlowEditor?.activeFlowId;
      const result = await window.testflow.replay.start(activeFlow);
      if (result) {
        this.isReplaying = true;
        this.btnReplay.classList.add('active');
        this.btnReplayStop.disabled = false;
        this._setStatus('replaying', 'Replaying');
        this._log('replay', 'Replay started');
        window.EventBus.emit('replay:started');
      }
    } catch (err) {
      this._log('error', `Replay failed: ${err.message}`);
    }
  }

  async _stopReplay() {
    try {
      await window.testflow.replay.stop();
    } catch (err) {
      console.error('[Toolbar] Failed to stop replay:', err);
    }
    this._resetReplayUI();
    this._log('replay', 'Replay stopped');
    window.EventBus.emit('replay:stopped');
  }

  /**
   * Reset toolbar replay UI to idle (no event emit)
   */
  _resetReplayUI() {
    this.isReplaying = false;
    this.btnReplay.classList.remove('active');
    this.btnReplayStop.disabled = true;
    this._setStatus('idle', 'Ready');
  }

  async _replayStep() {
    try {
      await window.testflow.replay.stepOver();
    } catch (err) {
      this._log('error', `Step failed: ${err.message}`);
    }
  }

  // ─── Tools ───────────────────────────────────────────────
  async _toggleFreeze() {
    try {
      const result = await window.testflow.freeze.toggle();
      this.isFrozen = result.frozen;

      const overlay = document.getElementById('freeze-overlay');
      if (this.isFrozen) {
        this.btnFreeze.classList.add('freeze-active');
        overlay?.classList.remove('hidden');
        this._setStatus('frozen', 'Frozen');
        this._log('info', 'Website frozen — inspect safely');
      } else {
        this.btnFreeze.classList.remove('freeze-active');
        overlay?.classList.add('hidden');
        this._setStatus('idle', 'Ready');
        this._log('info', 'Website unfrozen');
      }

      window.EventBus.emit('freeze:toggled', this.isFrozen);
    } catch (err) {
      this._log('error', `Freeze toggle failed: ${err.message}`);
    }
  }

  async _captureScreenshot() {
    try {
      const result = await window.testflow.screenshot.capture();
      this._log('info', `Screenshot saved: ${result.path}`);
      window.EventBus.emit('screenshot:captured', result);
    } catch (err) {
      this._log('error', `Screenshot failed: ${err.message}`);
    }
  }

  async _toggleInspector() {
    try {
      this.isInspecting = !this.isInspecting;

      if (this.isInspecting) {
        await window.testflow.inspector.enable();
        this.btnInspector.classList.add('active');
        // Show the right panel if hidden, uncollapse if collapsed
        window.PanelManager.showPanel('right');
        this._setStatus('inspecting', 'Inspector');
        this._log('info', 'Element Inspector enabled — hover to inspect');
      } else {
        await window.testflow.inspector.disable();
        this.btnInspector.classList.remove('active');
        // Don't hide — just stop inspecting. Panel stays visible.
        this._setStatus('idle', 'Ready');
        this._log('info', 'Element Inspector disabled');
      }
      window.EventBus.emit('inspector:toggled', this.isInspecting);
    } catch (err) {
      this._log('error', `Inspector failed: ${err.message}`);
    }
  }

  async _toggleMiniInspector() {
    try {
      const visible = await window.testflow.miniInspector.toggle();
      this.btnMiniInspector.classList.toggle('active', visible);
    } catch (err) {
      this._log('error', `Mini Inspector failed: ${err.message}`);
    }
  }

  // ─── Export ───────────────────────────────────────────────
  async _export(format, label) {
    // Guard: project must be open — offer to create one
    if (!window.App?.projectLoaded) {
      const create = confirm(`Export ${label}: No project open.\n\nWould you like to create a project now?\n(Your recorded flows will be saved to the new project)`);
      if (create) {
        await window.App._newProject();
      }
      if (!window.App?.projectLoaded) return; // still no project
    }

    // Guard: a flow must be selected
    const flowId = window.FlowEditor?.activeFlowId;
    if (!flowId) {
      alert(`Export ${label}: No flow selected.\n\nCreate or select a flow first.`);
      this._log('warning', `Export ${label}: No flow selected.`);
      return;
    }

    // Pre-validate
    try {
      const validation = await window.testflow.export.validate(flowId);
      if (!validation.valid) {
        const msg = validation.errors.join('\n• ');
        alert(`Export ${label} — validation failed:\n\n• ${msg}`);
        this._log('error', `Export ${label} validation failed: ${validation.errors.join(', ')}`);
        return;
      }
      if (validation.warnings.length) {
        for (const w of validation.warnings) {
          this._log('warning', `Export ${label}: ${w}`);
        }
      }
    } catch (err) {
      alert(`Export ${label} — validation error:\n\n${err.message}`);
      this._log('error', `Export validation error: ${err.message}`);
      return;
    }

    // Run export
    try {
      this._log('info', `Exporting ${label}…`);
      let result;
      switch (format) {
        case 'seleniumPython':
          result = await window.testflow.export.seleniumPython(flowId);
          break;
        case 'markdown':
          result = await window.testflow.export.markdown(flowId);
          break;
        case 'json':
          result = await window.testflow.export.json(flowId);
          break;
      }

      if (!result) {
        this._log('info', `Export ${label} cancelled.`);
        return;
      }

      // Log success details
      if (result.files) {
        this._log('info', `✅ Export ${label} complete — ${result.files.length} file(s) written:`);
        for (const f of result.files) {
          this._log('info', `  📄 ${f.description}: ${f.path}`);
        }
      } else if (result.path) {
        this._log('info', `✅ Export ${label} complete: ${result.path}`);
      }

      if (result.warnings?.length) {
        for (const w of result.warnings) {
          this._log('warning', `  ⚠ ${w}`);
        }
      }

      this._log('info', `  Steps exported: ${result.stepCount}`);
      window.EventBus.emit('export:complete', { format, result });

    } catch (err) {
      alert(`Export ${label} failed:\n\n${err.message}`);
      this._log('error', `Export ${label} failed: ${err.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Bookmark System (localStorage-based, no git)
  // ═══════════════════════════════════════════════════════════

  /** Toggle bookmark for the current URL via the star button */
  _toggleBookmarkStar() {
    const url = this.urlInput.value.trim();
    if (!url) return;
    const existing = this._bookmarks.find(b => b.url === url);
    if (existing) {
      this._removeBookmark(existing.id);
    } else {
      // Directly add with auto-derived name
      this._addBookmark(this._deriveBookmarkName(url), url);
    }
  }

  /** Update star appearance: filled if current URL is bookmarked */
  _updateBookmarkStar() {
    const url = this.urlInput.value.trim();
    const isBookmarked = url && this._bookmarks.some(b => b.url === url);
    if (this.btnBookmarkStar) {
      this.btnBookmarkStar.textContent = isBookmarked ? '\u2605' : '\u2606';
      this.btnBookmarkStar.classList.toggle('bookmarked', isBookmarked);
      this.btnBookmarkStar.title = isBookmarked ? 'Remove bookmark' : 'Bookmark this page';
    }
  }

  _initBookmarks() {
    this._bookmarks = this._loadBookmarks();
    this._renderBookmarkBar();

    // Right-click on URL bar → "Save as Bookmark"
    this.urlInput.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this._showUrlContextMenu(e.clientX, e.clientY);
    });

    // Close menus on outside click
    document.addEventListener('click', (e) => {
      const ctx = document.getElementById('bookmark-ctx-menu');
      if (ctx && !ctx.contains(e.target)) ctx.classList.add('hidden');
      const dd = document.getElementById('bookmark-more-dropdown');
      const btn = document.getElementById('btn-bookmark-more');
      if (dd && !dd.contains(e.target) && e.target !== btn) dd.classList.add('hidden');
    });

    // "Show more" button
    const moreBtn = document.getElementById('btn-bookmark-more');
    if (moreBtn) {
      moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('bookmark-more-dropdown')?.classList.toggle('hidden');
      });
    }
  }

  _loadBookmarks() {
    try {
      return JSON.parse(localStorage.getItem('testflow_bookmarks') || '[]');
    } catch { return []; }
  }

  _saveBookmarks() {
    localStorage.setItem('testflow_bookmarks', JSON.stringify(this._bookmarks));
  }

  _addBookmark(name, url) {
    // Avoid exact URL duplicates
    if (this._bookmarks.some(b => b.url === url)) return;
    this._bookmarks.push({ id: Date.now().toString(36), name, url });
    this._saveBookmarks();
    this._renderBookmarkBar();
    this._updateBookmarkStar();
  }

  _removeBookmark(id) {
    this._bookmarks = this._bookmarks.filter(b => b.id !== id);
    this._saveBookmarks();
    this._renderBookmarkBar();
    this._updateBookmarkStar();
  }

  _renameBookmark(id, newName) {
    const bm = this._bookmarks.find(b => b.id === id);
    if (bm) { bm.name = newName; this._saveBookmarks(); this._renderBookmarkBar(); }
  }

  _renderBookmarkBar() {
    const chips = document.getElementById('bookmark-chips');
    const moreWrap = document.getElementById('bookmark-more-wrap');
    const moreDd = document.getElementById('bookmark-more-dropdown');
    const bar = document.getElementById('bookmark-bar');
    if (!chips || !moreWrap || !moreDd || !bar) return;

    chips.innerHTML = '';
    moreDd.innerHTML = '';

    if (this._bookmarks.length === 0) {
      // Show empty hint
      const hint = document.createElement('span');
      hint.className = 'bookmark-empty-hint';
      hint.textContent = '☆ Right-click the URL bar or click the star to add bookmarks';
      chips.appendChild(hint);
      moreWrap.classList.add('hidden');
      return;
    }

    const visible = this._bookmarks.slice(0, 5);
    const overflow = this._bookmarks.slice(5);

    visible.forEach(bm => chips.appendChild(this._createChip(bm)));

    if (overflow.length > 0) {
      moreWrap.classList.remove('hidden');
      overflow.forEach(bm => moreDd.appendChild(this._createDropdownItem(bm)));
    } else {
      moreWrap.classList.add('hidden');
    }
  }

  _createChip(bm) {
    const chip = document.createElement('div');
    chip.className = 'bookmark-chip';
    chip.title = bm.url;
    chip.dataset.id = bm.id;

    const label = document.createElement('span');
    label.className = 'bookmark-chip-label';
    label.textContent = bm.name;
    chip.appendChild(label);

    // Click → navigate
    chip.addEventListener('click', (e) => {
      if (e.target.closest('.bookmark-chip-del')) return;
      this.urlInput.value = bm.url;
      this._navigate();
    });

    // Right-click → edit / delete menu
    chip.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._showBookmarkContextMenu(e.clientX, e.clientY, bm);
    });

    return chip;
  }

  _createDropdownItem(bm) {
    const item = document.createElement('div');
    item.className = 'bookmark-dd-item';
    item.title = bm.url;

    const label = document.createElement('span');
    label.className = 'bookmark-dd-label';
    label.textContent = bm.name;
    item.appendChild(label);

    const del = document.createElement('button');
    del.className = 'bookmark-dd-del';
    del.textContent = '✕';
    del.title = 'Delete';
    del.addEventListener('click', (e) => { e.stopPropagation(); this._removeBookmark(bm.id); });
    item.appendChild(del);

    item.addEventListener('click', () => {
      this.urlInput.value = bm.url;
      this._navigate();
      document.getElementById('bookmark-more-dropdown')?.classList.add('hidden');
    });

    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._showBookmarkContextMenu(e.clientX, e.clientY, bm);
    });

    return item;
  }

  // ─── Context Menus ────────────────────────────────────────

  /** Right-click on URL bar → Save / Remove bookmark */
  _showUrlContextMenu(x, y) {
    const currentUrl = this.urlInput.value.trim();
    if (!currentUrl) return;

    const ctx = document.getElementById('bookmark-ctx-menu');
    if (!ctx) return;
    ctx.innerHTML = '';

    const existing = this._bookmarks.find(b => b.url === currentUrl);
    if (existing) {
      // Already bookmarked — offer Rename / Delete
      const renameItem = document.createElement('div');
      renameItem.className = 'ctx-menu-item';
      renameItem.textContent = '\u270e  Rename Bookmark';
      renameItem.addEventListener('click', () => {
        ctx.classList.add('hidden');
        this._showBookmarkEditDialog(existing);
      });
      ctx.appendChild(renameItem);

      const delItem = document.createElement('div');
      delItem.className = 'ctx-menu-item ctx-menu-item--danger';
      delItem.textContent = '\u2715  Remove Bookmark';
      delItem.addEventListener('click', () => {
        ctx.classList.add('hidden');
        this._removeBookmark(existing.id);
      });
      ctx.appendChild(delItem);
    } else {
      // Not bookmarked — offer Save
      const saveItem = document.createElement('div');
      saveItem.className = 'ctx-menu-item';
      saveItem.textContent = '\u2605  Save as Bookmark';
      saveItem.addEventListener('click', () => {
        ctx.classList.add('hidden');
        this._addBookmark(this._deriveBookmarkName(currentUrl), currentUrl);
      });
      ctx.appendChild(saveItem);
    }

    this._positionCtx(ctx, x, y);
  }

  /** Right-click on a bookmark chip → Rename / Delete */
  _showBookmarkContextMenu(x, y, bm) {
    const ctx = document.getElementById('bookmark-ctx-menu');
    if (!ctx) return;
    ctx.innerHTML = '';

    // Rename
    const renameItem = document.createElement('div');
    renameItem.className = 'ctx-menu-item';
    renameItem.textContent = '✎  Rename';
    renameItem.addEventListener('click', () => {
      ctx.classList.add('hidden');
      this._showBookmarkEditDialog(bm);
    });
    ctx.appendChild(renameItem);

    // Delete
    const delItem = document.createElement('div');
    delItem.className = 'ctx-menu-item ctx-menu-item--danger';
    delItem.textContent = '✕  Delete';
    delItem.addEventListener('click', () => {
      ctx.classList.add('hidden');
      this._removeBookmark(bm.id);
    });
    ctx.appendChild(delItem);

    this._positionCtx(ctx, x, y);
  }

  _positionCtx(ctx, x, y) {
    ctx.style.left = x + 'px';
    ctx.style.top = y + 'px';
    ctx.classList.remove('hidden');
    // Keep in viewport
    requestAnimationFrame(() => {
      const rect = ctx.getBoundingClientRect();
      if (rect.right > window.innerWidth) ctx.style.left = (window.innerWidth - rect.width - 8) + 'px';
      if (rect.bottom > window.innerHeight) ctx.style.top = (window.innerHeight - rect.height - 8) + 'px';
    });
  }

  // ─── Bookmark Edit Dialog (self-contained overlay) ────────

  _showBookmarkEditDialog(existingBm, url) {
    const isNew = !existingBm;
    const bmUrl = existingBm ? existingBm.url : (url || '');
    const bmName = existingBm ? existingBm.name : this._deriveBookmarkName(bmUrl);

    // Remove any previous bookmark dialog
    document.getElementById('bm-dialog-overlay')?.remove();

    // Create a self-contained overlay (not shared with Modal component)
    const overlay = document.createElement('div');
    overlay.id = 'bm-dialog-overlay';
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:20000;
      background:rgba(0,0,0,0.5);
      display:flex;align-items:center;justify-content:center;
    `;

    const dialog = document.createElement('div');
    dialog.style.cssText = `
      background:var(--bg-elevated);border:1px solid var(--border-color);
      border-radius:var(--radius-lg);padding:20px;min-width:340px;
      box-shadow:0 8px 32px rgba(0,0,0,0.6);
    `;

    dialog.innerHTML = `
      <div style="font-size:14px;font-weight:600;color:var(--text-primary);margin-bottom:14px;">
        ${isNew ? 'Add Bookmark' : 'Rename Bookmark'}
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        <label style="font-size:11px;color:var(--text-muted);">Name</label>
        <input id="bm-dlg-name" type="text" spellcheck="false" style="
          padding:6px 10px;border:1px solid var(--border-color);border-radius:var(--radius-sm);
          background:var(--bg-surface);color:var(--text-primary);font-size:13px;outline:none;">
        <label style="font-size:11px;color:var(--text-muted);margin-top:4px;">URL</label>
        <div style="font-size:11px;color:var(--text-secondary);font-family:var(--font-mono);
          padding:6px 10px;background:var(--bg-surface);border:1px solid var(--border-color);
          border-radius:var(--radius-sm);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          ${this._escHtml(bmUrl)}
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">
        <button id="bm-dlg-cancel" style="
          padding:6px 14px;font-size:12px;border:1px solid var(--border-color);
          border-radius:var(--radius-sm);background:transparent;color:var(--text-secondary);cursor:pointer;">
          Cancel
        </button>
        <button id="bm-dlg-save" style="
          padding:6px 18px;font-size:12px;border:none;border-radius:var(--radius-sm);
          background:var(--accent-blue);color:#1e1e2e;font-weight:600;cursor:pointer;">
          ${isNew ? 'Add' : 'Save'}
        </button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const nameInput = document.getElementById('bm-dlg-name');
    nameInput.value = bmName;
    nameInput.focus();
    nameInput.select();

    const close = () => overlay.remove();

    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.getElementById('bm-dlg-cancel').addEventListener('click', close);
    document.getElementById('bm-dlg-save').addEventListener('click', () => {
      const name = nameInput.value.trim() || 'Untitled';
      if (isNew) {
        this._addBookmark(name, bmUrl);
      } else {
        this._renameBookmark(existingBm.id, name);
      }
      close();
    });
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('bm-dlg-save').click();
      if (e.key === 'Escape') close();
    });
  }

  _escHtml(str) {
    const d = document.createElement('span');
    d.textContent = str || '';
    return d.innerHTML;
  }

  _deriveBookmarkName(url) {
    try {
      const u = new URL(url);
      return u.hostname.replace(/^www\./, '');
    } catch {
      return url.slice(0, 30);
    }
  }

  // ─── Status ──────────────────────────────────────────────
  _setStatus(state, text) {
    this.statusDot.className = `status-dot ${state}`;
    this.statusText.textContent = text;
    // Colorize the entire indicator (dot + text)
    const indicator = document.getElementById('status-indicator');
    if (indicator) indicator.className = `status-indicator ${state}`;
  }

  // ─── Logging Helper ──────────────────────────────────────
  _log(level, message) {
    window.EventBus.emit('console:log', { level, message, timestamp: Date.now() });
  }
}

window.ToolbarController = new Toolbar();
