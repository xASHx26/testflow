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
  }

  _bindElements() {
    this.urlInput = document.getElementById('url-input');
    this.btnNavigate = document.getElementById('btn-navigate');
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
      }
    });

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
  async _navigate() {
    const url = this.urlInput.value.trim();
    if (!url) return;

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
    await window.testflow.replay.stop();
    this.isReplaying = false;
    this.btnReplay.classList.remove('active');
    this.btnReplayStop.disabled = true;
    this._setStatus('idle', 'Ready');
    this._log('replay', 'Replay stopped');
    window.EventBus.emit('replay:stopped');
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
        // Show the right panel with inspector tabs
        window.PanelManager.showPanel('right');
        this._setStatus('inspecting', 'Inspector');
        this._log('info', 'Element Inspector enabled — hover to inspect');
      } else {
        await window.testflow.inspector.disable();
        this.btnInspector.classList.remove('active');
        // Hide the right panel
        window.PanelManager.hidePanel('right');
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
    if (!window.App?.projectLoaded) {
      this._log('warning', `Export ${label}: No project open — create or open a project first.`);
      return;
    }
    const flowId = window.FlowEditor?.activeFlowId;
    if (!flowId) {
      this._log('warning', `Export ${label}: No flow selected — create or select a flow first.`);
      return;
    }

    // Pre-validate
    try {
      const validation = await window.testflow.export.validate(flowId);
      if (!validation.valid) {
        this._log('error', `Export ${label} failed — validation errors:`);
        for (const err of validation.errors) {
          this._log('error', `  • ${err}`);
        }
        return;
      }
      if (validation.warnings.length) {
        for (const w of validation.warnings) {
          this._log('warning', `Export ${label}: ${w}`);
        }
      }
    } catch (err) {
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
      this._log('error', `Export ${label} failed: ${err.message}`);
      if (err.errors) {
        for (const e of err.errors) this._log('error', `  • ${e}`);
      }
    }
  }

  // ─── Status ──────────────────────────────────────────────
  _setStatus(state, text) {
    this.statusDot.className = `status-dot ${state}`;
    this.statusText.textContent = text;
  }

  // ─── Logging Helper ──────────────────────────────────────
  _log(level, message) {
    window.EventBus.emit('console:log', { level, message, timestamp: Date.now() });
  }
}

window.ToolbarController = new Toolbar();
