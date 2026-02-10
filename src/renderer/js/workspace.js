/**
 * TestFlow — Workspace Presets
 * 
 * Manages panel layout presets:
 *   - recorder: left + bottom open, right collapsed
 *   - inspector: left + right open, bottom collapsed
 *   - debug: all panels open
 *   - review: right + bottom open, left collapsed
 */

class Workspace {
  constructor() {
    this.presets = {
      recorder: { left: true, right: false, bottom: true },
      inspector: { left: true, right: true, bottom: false },
      debug: { left: true, right: true, bottom: true },
      review: { left: false, right: true, bottom: true }
    };

    this.currentPreset = 'debug';
    this._listen();
  }

  _listen() {
    window.EventBus.on('workspace:preset-change', (preset) => this.apply(preset));

    // Menu-driven workspace changes
    window.testflow.on('menu:workspace-recorder', () => this.apply('recorder'));
    window.testflow.on('menu:workspace-inspector', () => this.apply('inspector'));
    window.testflow.on('menu:workspace-debug', () => this.apply('debug'));
    window.testflow.on('menu:workspace-review', () => this.apply('review'));
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
