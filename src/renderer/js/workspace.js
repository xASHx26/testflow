/**
 * TestFlow — Workspace Presets
 * 
 * Manages panel layout presets and pop-out panel windows.
 * 
 * Modes:
 *   - recorder:          left + bottom (record flows & see console)
 *   - inspector:         left + right (record & inspect elements)
 *   - debug:             all panels (full debugging view)
 *   - review:            right + bottom (review results)
 * 
 * Layouts (Browser + …):
 *   - browser-only:      all panels hidden — full browser
 *   - browser-inspector: right panel only
 *   - browser-flows:     left panel only
 *   - browser-console:   bottom panel only
 * 
 * Two-panel combos:
 *   - flows-inspector:   left + right
 *   - flows-console:     left + bottom
 *   - inspector-console: right + bottom
 * 
 * Quick aliases:
 *   - focus:   same as browser-only
 *   - compact: left + bottom
 *   - full:    all panels
 */

class Workspace {
  constructor() {
    this.presets = {
      // Modes
      recorder:             { left: true,  right: false, bottom: true  },
      inspector:            { left: true,  right: true,  bottom: false },
      debug:                { left: true,  right: true,  bottom: true  },
      review:               { left: false, right: true,  bottom: true  },
      // Single panel + Browser
      'browser-only':       { left: false, right: false, bottom: false },
      'browser-inspector':  { left: false, right: true,  bottom: false },
      'browser-flows':      { left: true,  right: false, bottom: false },
      'browser-console':    { left: false, right: false, bottom: true  },
      // Two-panel combos
      'flows-inspector':    { left: true,  right: true,  bottom: false },
      'flows-console':      { left: true,  right: false, bottom: true  },
      'inspector-console':  { left: false, right: true,  bottom: true  },
      // Aliases
      focus:                { left: false, right: false, bottom: false },
      compact:              { left: true,  right: false, bottom: true  },
      full:                 { left: true,  right: true,  bottom: true  },
    };

    this.currentPreset = 'debug';
    this._poppedOutPanels = new Set();
    this._listen();
  }

  _listen() {
    window.EventBus.on('workspace:preset-change', (preset) => this.apply(preset));

    // Menu-driven workspace changes (single channel with argument)
    window.testflow.on('menu:workspace-preset', (preset) => this.apply(preset));

    // Pop-out panel events
    window.testflow.on('menu:popout-panel', (panel) => this._popoutPanel(panel));
    window.testflow.on('popout:opened', (panel) => this._onPanelPoppedOut(panel));
    window.testflow.on('popout:docked', (panel) => this._onPanelDocked(panel));
  }

  /**
   * Request the main process to pop out a panel
   */
  _popoutPanel(panelType) {
    // Map panel types to their panel names for hiding
    window.testflow.popout.open(panelType);
  }

  /**
   * Map of pop-out panel type to the main layout panel it belongs to.
   * Some types hide the entire panel, others just indicate a tab was detached.
   */
  _getPanelHideTarget(panelType) {
    const hideEntire = {
      browser:      'browser',
      flows:        'left',
      inspector:    'right',
      console:      'bottom',
      network:      'bottom',
      'replay-log': 'bottom',
      'bottom-all': 'bottom',
      'right-all':  'right',
    };
    return hideEntire[panelType] || null;
  }

  /**
   * Friendly display name for pop-out panels.
   */
  _panelLabel(panelType) {
    const labels = {
      browser:      'Browser',
      flows:        'Test Flows',
      inspector:    'Inspector',
      console:      'Console',
      network:      'Network',
      'replay-log': 'Replay Log',
      'bottom-all': 'Console + Network + Replay Log',
      'right-all':  'Inspector',
    };
    return labels[panelType] || panelType;
  }

  /**
   * Called when a panel has been popped out — hide it from the main layout
   */
  _onPanelPoppedOut(panelType) {
    const target = this._getPanelHideTarget(panelType);

    if (target === 'browser') {
      const bp = document.getElementById('panel-browser');
      if (bp) bp.classList.add('popped-out');
    } else if (target) {
      window.PanelManager.hidePanel(target);
    }

    this._poppedOutPanels.add(panelType);

    window.EventBus.emit('console:log', {
      level: 'info',
      message: `📌 ${this._panelLabel(panelType)} popped out to separate window`,
      timestamp: Date.now(),
    });
  }

  /**
   * Called when a panel has been docked back — restore it in the main layout
   */
  _onPanelDocked(panelType) {
    const target = this._getPanelHideTarget(panelType);

    if (target === 'browser') {
      const bp = document.getElementById('panel-browser');
      if (bp) bp.classList.remove('popped-out');
      setTimeout(() => window.PanelManager._updateBrowserBounds(), 300);
    } else if (target) {
      window.PanelManager.showPanel(target);
    }

    this._poppedOutPanels.delete(panelType);

    window.EventBus.emit('console:log', {
      level: 'info',
      message: `⬅ ${this._panelLabel(panelType)} docked back`,
      timestamp: Date.now(),
    });
  }

  apply(presetName) {
    const preset = this.presets[presetName];
    if (!preset) return;

    this.currentPreset = presetName;

    // Apply panel visibility
    if (preset.left) {
      window.PanelManager.showPanel('left');
    } else {
      window.PanelManager.hidePanel('left');
    }

    if (preset.right) {
      window.PanelManager.showPanel('right');
    } else {
      window.PanelManager.hidePanel('right');
    }

    if (preset.bottom) {
      window.PanelManager.showPanel('bottom');
    } else {
      window.PanelManager.hidePanel('bottom');
    }

    // Update dropdown
    const select = document.getElementById('workspace-preset');
    if (select) select.value = presetName;

    // Recalculate browser bounds after layout change
    setTimeout(() => {
      window.PanelManager._updateBrowserBounds();
    }, 200);

    window.EventBus.emit('workspace:changed', presetName);
  }

  getCurrentPreset() {
    return this.currentPreset;
  }
}

window.Workspace = new Workspace();
