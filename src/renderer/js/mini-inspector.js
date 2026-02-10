/**
 * TestFlow — Mini Inspector Toggle
 * 
 * Handles the floating mini inspector window state.
 * The actual mini inspector UI lives in mini-inspector.html 
 * and is rendered in a separate BrowserWindow.
 */

class MiniInspectorHandler {
  constructor() {
    this.visible = false;

    window.testflow.on('inspector:hover', (data) => {
      window.EventBus.emit('mini-inspector:update', data);
    });

    window.testflow.on('inspector:select', (data) => {
      window.EventBus.emit('mini-inspector:select', data);
    });
  }

  async toggle() {
    const visible = await window.testflow.miniInspector.toggle();
    this.visible = visible;
    return visible;
  }
}

window.MiniInspectorHandler = new MiniInspectorHandler();
