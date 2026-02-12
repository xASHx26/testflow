/**
 * TestFlow — Workspace Presets
 * 
 * Manages panel layout presets:
 *   - recorder: left + bottom open, right collapsed
 *   - inspector: left + right open, bottom collapsed
 *   - debug: all panels open
 *   - review: right + bottom open, left collapsed
 *   - browser-only: all panels hidden, full browser
 *   - browser-inspector: browser + right panel only
 *   - browser-flows: browser + left panel only
 *   - compact: left + bottom, no right
 *   - full: all panels open (alias for debug)
 */

class Workspace {
  constructor() {
    this.presets = {
      recorder:           { left: true,  right: false, bottom: true  },
      inspector:          { left: true,  right: true,  bottom: false },
      debug:              { left: true,  right: true,  bottom: true  },
      review:             { left: false, right: true,  bottom: true  },
      'browser-only':     { left: false, right: false, bottom: false },
      'browser-inspector':{ left: false, right: true,  bottom: false },
      'browser-flows':    { left: true,  right: false, bottom: false },
      compact:            { left: true,  right: false, bottom: true  },
      full:               { left: true,  right: true,  bottom: true  },
    };

    this.currentPreset = 'debug';
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
   * Called when a panel has been popped out — hide it from the main layout
   */
  _onPanelPoppedOut(panelType) {
    const panelMap = {
      browser:   'browser',
      inspector: 'right',
      console:   'bottom',
    };
    const panelName = panelMap[panelType];
    if (panelName && panelName !== 'browser') {
      window.PanelManager.hidePanel(panelName);
    }
    if (panelName === 'browser') {
      // Hide the browser panel placeholder since BrowserView moved
      const bp = document.getElementById('panel-browser');
      if (bp) bp.classList.add('popped-out');
    }
    this._poppedOutPanels = this._poppedOutPanels || new Set();
    this._poppedOutPanels.add(panelType);

    window.EventBus.emit('console:log', {
      level: 'info',
      message: `📌 ${panelType} panel popped out to separate window`,
      timestamp: Date.now(),
    });
  }

  /**
   * Called when a panel has been docked back — restore it in the main layout
   */
  _onPanelDocked(panelType) {
    const panelMap = {
      browser:   'browser',
      inspector: 'right',
      console:   'bottom',
    };
    const panelName = panelMap[panelType];
    if (panelName && panelName !== 'browser') {
      window.PanelManager.showPanel(panelName);
    }
    if (panelName === 'browser') {
      const bp = document.getElementById('panel-browser');
      if (bp) bp.classList.remove('popped-out');
      // Recalculate browser bounds
      setTimeout(() => window.PanelManager._updateBrowserBounds(), 300);
    }
    if (this._poppedOutPanels) this._poppedOutPanels.delete(panelType);

    window.EventBus.emit('console:log', {
      level: 'info',
      message: `⬅ ${panelType} panel docked back`,
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
