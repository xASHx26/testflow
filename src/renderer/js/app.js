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
    const name = prompt('Project name:', 'My Test Project');
    if (!name) return;

    try {
      const project = await window.testflow.project.new(name);
      this.projectLoaded = true;
      window.EventBus.emit('project:opened', project);
      window.EventBus.emit('console:log', {
        level: 'info',
        message: `Project created: ${project.name}`,
        timestamp: Date.now()
      });
    } catch (err) {
      alert(`Failed to create project: ${err.message}`);
    }
  }

  async _openProject() {
    try {
      const project = await window.testflow.project.open();
      if (project) {
        this.projectLoaded = true;
        window.EventBus.emit('project:opened', project);
        window.EventBus.emit('console:log', {
          level: 'info',
          message: `Project opened: ${project.name}`,
          timestamp: Date.now()
        });
      }
    } catch (err) {
      alert(`Failed to open project: ${err.message}`);
    }
  }

  async _saveProject() {
    try {
      await window.testflow.project.save();
      window.EventBus.emit('console:log', {
        level: 'info',
        message: 'Project saved.',
        timestamp: Date.now()
      });
    } catch (err) {
      alert(`Failed to save: ${err.message}`);
    }
  }

  // ─── Replay Events ──────────────────────────────────────
  _bindReplayEvents() {
    window.testflow.on('replay:step-start', (data) => {
      window.EventBus.emit('replay:step-start', data);
      window.EventBus.emit('console:log', {
        level: 'replay',
        message: `Step ${data.order}: ${data.action} — ${data.description || ''}`,
        timestamp: Date.now()
      });
    });

    window.testflow.on('replay:step-complete', (data) => {
      window.EventBus.emit('replay:step-complete', data);
      const status = data.status === 'pass' ? '✅' : '❌';
      const fallback = data.diagnostics?.fallbackUsed ? ' (fallback)' : '';
      window.EventBus.emit('console:log', {
        level: data.status === 'pass' ? 'info' : 'error',
        message: `${status} Step ${data.order}: ${data.action}${fallback} — ${data.diagnostics?.duration || 0}ms`,
        timestamp: Date.now()
      });
    });

    window.testflow.on('replay:complete', (data) => {
      window.EventBus.emit('replay:stopped');
      window.EventBus.emit('console:log', {
        level: 'replay',
        message: `Replay complete — ${data.passed}/${data.total} passed`,
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
