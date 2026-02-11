/**
 * TestFlow — App Initializer
 * 
 * Main entry point for the renderer process.
 * Wires up all modules, handles project open/new,
 * menu events, and startup sequence.
 */

class App {
  constructor() {
    this.projectLoaded = false;
  }

  async init() {
    console.log('[TestFlow] Initializing…');

    // Apply default workspace preset
    window.Workspace.apply('debug');

    // Wire menu events
    this._bindMenuEvents();

    // Wire replay events
    this._bindReplayEvents();

    // Wire share events
    this._bindShareEvents();

    // Wire export events
    this._bindExportEvents();

    // Initial browser bounds
    window.PanelManager.updateBrowserBounds();

    // Observe window resize
    window.addEventListener('resize', () => {
      window.PanelManager.updateBrowserBounds();
    });

    // Log ready
    window.EventBus.emit('console:log', {
      level: 'info',
      message: 'TestFlow IDE ready. Open or create a project to begin.',
      timestamp: Date.now()
    });

    console.log('[TestFlow] Ready ✓');
  }

  // ─── Menu Events ─────────────────────────────────────────
  _bindMenuEvents() {
    // Project
    window.testflow.on('menu:new-project', () => this._newProject());
    window.testflow.on('menu:open-project', () => this._openProject());
    window.testflow.on('menu:save-project', () => this._saveProject());
  }

  async _newProject() {
    try {
      const result = await window.testflow.project.new();
      if (!result) return; // user cancelled save dialog
      this.projectLoaded = true;
      window.EventBus.emit('project:opened', result);
      window.EventBus.emit('console:log', {
        level: 'info',
        message: `✅ Project created: ${result.project.name}`,
        timestamp: Date.now()
      });
      // Auto-save session state right after creation
      await this._persistSessionState();
    } catch (err) {
      alert(`Failed to create project: ${err.message}`);
    }
  }

  async _openProject() {
    try {
      const result = await window.testflow.project.open();
      if (!result) return; // user cancelled open dialog
      this.projectLoaded = true;
      window.EventBus.emit('project:opened', result);
      window.EventBus.emit('console:log', {
        level: 'info',
        message: `✅ Project opened: ${result.project.name}`,
        timestamp: Date.now()
      });
      // Restore session state (test cases, inspector, URL, etc.)
      await this._restoreSessionState(result.project);
    } catch (err) {
      alert(`Failed to open project: ${err.message}`);
    }
  }

  async _saveProject() {
    if (!this.projectLoaded) {
      // No project yet — auto-trigger New Project to save everything
      return this._newProject();
    }
    try {
      await window.testflow.project.save();
      await this._persistSessionState();
      window.EventBus.emit('console:log', {
        level: 'info',
        message: 'Project saved.',
        timestamp: Date.now()
      });
    } catch (err) {
      alert(`Failed to save: ${err.message}`);
    }
  }

  /**
   * Gather all renderer state and persist to session.json via main process.
   */
  async _persistSessionState() {
    try {
      const state = {
        currentUrl: document.getElementById('url-input')?.value || '',
        activeFlowId: window.FlowEditor?.activeFlowId || null,
        testCases: window.TestCaseManager?.getState?.() || [],
        inspector: window.InspectorUI?.getState?.() || { elements: [], testDataRows: [] },
        savedAt: new Date().toISOString(),
      };
      await window.testflow.project.saveState(state);
    } catch (err) {
      console.error('[TestFlow] Failed to save session state', err);
    }
  }

  /**
   * Restore renderer state from session.json after opening a project.
   */
  async _restoreSessionState(projectManifest) {
    try {
      const state = await window.testflow.project.loadState();
      if (!state) return;

      // Small delay to let flow list refresh first (triggered by project:opened event)
      await new Promise(r => setTimeout(r, 300));

      // Restore URL bar and navigate if we have a URL
      if (state.currentUrl) {
        const urlInput = document.getElementById('url-input');
        if (urlInput) urlInput.value = state.currentUrl;
        // Navigate browser to the saved URL
        try {
          const bounds = window.PanelManager.getBrowserBounds();
          await window.testflow.browser.attachView(bounds);
          const placeholder = document.getElementById('browser-placeholder');
          if (placeholder) placeholder.classList.add('hidden');
          await window.testflow.browser.navigate(state.currentUrl);
        } catch (navErr) {
          console.warn('[TestFlow] Could not restore URL navigation', navErr);
        }
      }

      // Restore active flow
      if (state.activeFlowId || projectManifest?.activeFlowId) {
        const flowId = state.activeFlowId || projectManifest.activeFlowId;
        if (window.FlowEditor) {
          window.FlowEditor.activeFlowId = flowId;
          try { await window.testflow.flow.setActive(flowId); } catch (_) {}
          // Re-render flow list to highlight the correct flow and show its steps
          await window.FlowEditor._refreshFlows();
        }
      }

      // Restore test cases
      if (state.testCases && window.TestCaseManager?.loadState) {
        window.TestCaseManager.loadState(state.testCases);
      }

      // Restore inspector elements and test data
      if (state.inspector && window.InspectorUI?.loadState) {
        window.InspectorUI.loadState(state.inspector);
      }

      window.EventBus.emit('console:log', {
        level: 'info',
        message: `Session state restored (${state.testCases?.length || 0} test cases, ${state.inspector?.elements?.length || 0} inspector elements)`,
        timestamp: Date.now()
      });
    } catch (err) {
      console.error('[TestFlow] Failed to restore session state', err);
    }
  }

  // ─── Replay Events ──────────────────────────────────────
  _bindReplayEvents() {
    window.testflow.replay.onStepStarted?.((data) => {
      window.EventBus.emit('replay:step-start', data);
      window.EventBus.emit('console:log', {
        level: 'replay',
        message: `Step ${data.index + 1}: ${data.label || data.stepId}`,
        timestamp: Date.now()
      });
    });

    window.testflow.replay.onStepCompleted?.((data) => {
      window.EventBus.emit('replay:step-complete', data);
      const status = data.status === 'passed' ? '✅' : '❌';
      const fallback = data.diagnostics?.fallbackUsed ? ' (fallback)' : '';
      window.EventBus.emit('console:log', {
        level: data.status === 'passed' ? 'info' : 'error',
        message: `${status} Step ${data.index + 1}: ${data.action || data.type || ''}${fallback} — ${data.diagnostics?.duration || 0}ms`,
        timestamp: Date.now()
      });
    });

    window.testflow.replay.onFinished?.((data) => {
      window.EventBus.emit('replay:stopped');
      const total = data.results?.length || 0;
      const passed = data.results?.filter(r => r.status === 'passed').length || 0;
      window.EventBus.emit('console:log', {
        level: 'replay',
        message: `Replay complete — ${passed}/${total} passed`,
        timestamp: Date.now()
      });
    });

    window.testflow.replay.onError?.((data) => {
      window.EventBus.emit('replay:stopped');
      window.EventBus.emit('console:log', {
        level: 'error',
        message: `Replay error: ${data.error}`,
        timestamp: Date.now()
      });
    });
  }

  // ─── Share ───────────────────────────────────────────────
  _bindShareEvents() {
    window.testflow.on('menu:share-package-view', async () => {
      try {
        const result = await window.testflow.share.package('view');
        window.EventBus.emit('console:log', {
          level: 'info',
          message: `Package created (view-only): ${result.path}`,
          timestamp: Date.now()
        });
      } catch (err) {
        alert(`Share failed: ${err.message}`);
      }
    });

    window.testflow.on('menu:share-package-edit', async () => {
      try {
        const result = await window.testflow.share.package('edit');
        window.EventBus.emit('console:log', {
          level: 'info',
          message: `Package created (editable): ${result.path}`,
          timestamp: Date.now()
        });
      } catch (err) {
        alert(`Share failed: ${err.message}`);
      }
    });

    window.testflow.on('menu:share-import', async () => {
      try {
        const result = await window.testflow.share.import();
        window.EventBus.emit('console:log', {
          level: 'info',
          message: `Package imported: ${result.name} (${result.permissions.mode})`,
          timestamp: Date.now()
        });
        window.EventBus.emit('project:opened', result);
      } catch (err) {
        alert(`Import failed: ${err.message}`);
      }
    });
  }

  // ─── Export ──────────────────────────────────────────────
  // Export events are handled by Toolbar._export() — no duplicate listeners here.
  _bindExportEvents() {
    // Intentionally empty — toolbar.js handles menu:export-* events
    // with proper flowId resolution, validation, and console logging.
  }
}

// Boot
document.addEventListener('DOMContentLoaded', () => {
  window.App = new App();
  window.App.init();
});
