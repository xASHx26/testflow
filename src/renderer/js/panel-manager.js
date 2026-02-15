/**
 * TestFlow — Panel Manager
 * 
 * Manages dockable panels, resizing, and visibility.
 */

class PanelManager {
  constructor() {
    this.panels = {
      left: document.getElementById('panel-left'),
      right: document.getElementById('panel-right'),
      bottom: document.getElementById('panel-bottom'),
      browser: document.getElementById('panel-browser'),
    };

    this.visibility = {
      left: true,
      right: false, // Right panel starts hidden (shown when inspector enabled)
      bottom: true,
    };

    this._browserViewSuppressed = false;

    this._setupBottomToggle();
    this._setupLeftToggle();
    this._setupRightToggle();
    this._setupTabs();
    this._setupResizeHandles();
    this._listenForResize();
  }

  /**
   * Toggle panel visibility
   */
  togglePanel(panelName) {
    const panel = this.panels[panelName];
    if (!panel) return;

    this.visibility[panelName] = !this.visibility[panelName];

    if (this.visibility[panelName]) {
      panel.classList.remove('hidden');
    } else {
      panel.classList.add('hidden');
    }

    this._updateBrowserBounds();
    window.EventBus.emit('panels:layout-changed');
  }

  /**
   * Show a specific panel
   */
  showPanel(panelName) {
    const panel = this.panels[panelName];
    if (!panel) return;
    this.visibility[panelName] = true;
    panel.classList.remove('hidden');
    panel.classList.remove('collapsed');
    // Reset toggle button text
    if (panelName === 'left') {
      const btn = document.getElementById('btn-toggle-left');
      if (btn) btn.textContent = '◀';
    } else if (panelName === 'right') {
      const btn = document.getElementById('btn-toggle-right');
      if (btn) btn.textContent = '▶';
    } else if (panelName === 'bottom') {
      const btn = document.getElementById('btn-toggle-bottom');
      if (btn) btn.textContent = '▼';
    }
    // Delay bounds update to let CSS layout settle, then update again
    setTimeout(() => this._updateBrowserBounds(), 100);
    setTimeout(() => this._updateBrowserBounds(), 300);
    window.EventBus.emit('panels:layout-changed');
  }

  /**
   * Hide a specific panel
   */
  hidePanel(panelName) {
    const panel = this.panels[panelName];
    if (!panel) return;
    this.visibility[panelName] = false;
    panel.classList.add('hidden');
    setTimeout(() => this._updateBrowserBounds(), 100);
    setTimeout(() => this._updateBrowserBounds(), 300);
    window.EventBus.emit('panels:layout-changed');
  }

  /**
   * Setup bottom panel toggle
   */
  _setupBottomToggle() {
    const toggleBtn = document.getElementById('btn-toggle-bottom');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        const bottom = this.panels.bottom;
        bottom.classList.toggle('collapsed');
        toggleBtn.textContent = bottom.classList.contains('collapsed') ? '▲' : '▼';
        this._updateBrowserBounds();
      });
    }
  }

  /**
   * Setup left panel collapse toggle
   */
  _setupLeftToggle() {
    const toggleBtn = document.getElementById('btn-toggle-left');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        const left = this.panels.left;
        left.classList.toggle('collapsed');
        toggleBtn.textContent = left.classList.contains('collapsed') ? '▶' : '◀';
        setTimeout(() => this._updateBrowserBounds(), 200);
      });
    }
  }

  /**
   * Setup right panel collapse toggle
   */
  _setupRightToggle() {
    const toggleBtn = document.getElementById('btn-toggle-right');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        const right = this.panels.right;
        right.classList.toggle('collapsed');
        toggleBtn.textContent = right.classList.contains('collapsed') ? '◀' : '▶';
        setTimeout(() => this._updateBrowserBounds(), 200);
      });
    }
  }

  /**
   * Setup tab switching for all panels
   */
  _setupTabs() {
    document.querySelectorAll('.panel-tabs').forEach(tabBar => {
      const tabs = tabBar.querySelectorAll('.panel-tab[data-tab]');
      const parent = tabBar.parentElement;

      tabs.forEach(tab => {
        tab.addEventListener('click', () => {
          const targetTab = tab.dataset.tab;

          // Deactivate all tabs in this group
          tabs.forEach(t => t.classList.remove('active'));
          tab.classList.add('active');

          // Show/hide content
          parent.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
          });

          const target = parent.querySelector(`#tab-${targetTab}`);
          if (target) target.classList.add('active');

          window.EventBus.emit('tab:switched', targetTab);
        });
      });
    });
  }

  /**
   * Setup drag-to-resize for all resize handles
   */
  _setupResizeHandles() {
    const handles = document.querySelectorAll('.resize-handle');
    const MIN_PANEL = 150;
    const MIN_BOTTOM = 80;

    handles.forEach(handle => {
      const target = handle.dataset.resize; // 'left', 'right', or 'bottom'

      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        handle.classList.add('active');
        document.body.style.cursor = target === 'bottom' ? 'row-resize' : 'col-resize';
        document.body.style.userSelect = 'none';

        const startX = e.clientX;
        const startY = e.clientY;
        let startSize;

        if (target === 'left') {
          startSize = this.panels.left.getBoundingClientRect().width;
        } else if (target === 'right') {
          startSize = this.panels.right.getBoundingClientRect().width;
        } else if (target === 'bottom') {
          startSize = this.panels.bottom.getBoundingClientRect().height;
        }

        const onMouseMove = (ev) => {
          let newSize;

          if (target === 'left') {
            const dx = ev.clientX - startX;
            newSize = Math.max(MIN_PANEL, startSize + dx);
            this.panels.left.style.width = newSize + 'px';
          } else if (target === 'right') {
            const dx = startX - ev.clientX; // dragging left = bigger
            newSize = Math.max(MIN_PANEL, startSize + dx);
            this.panels.right.style.width = newSize + 'px';
          } else if (target === 'bottom') {
            const dy = startY - ev.clientY; // dragging up = bigger
            newSize = Math.max(MIN_BOTTOM, startSize + dy);
            this.panels.bottom.style.height = newSize + 'px';
          }

          this._updateBrowserBounds();
        };

        const onMouseUp = () => {
          handle.classList.remove('active');
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
          this._updateBrowserBounds();
          window.EventBus.emit('panels:layout-changed');
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      });
    });
  }

  /**
   * Calculate and update the browser view bounds.
   * Uses the browser-container (below the tab bar) for accurate positioning.
   */
  _updateBrowserBounds() {
    // Skip if the BrowserView is intentionally hidden (e.g. overlay open)
    if (this._browserViewSuppressed) return;

    const container = document.getElementById('browser-container') || this.panels.browser;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const bounds = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };

    window.testflow?.browser.updateBounds(bounds);
    window.EventBus.emit('browser:bounds-updated', bounds);
  }

  /**
   * Public method to trigger browser bounds recalculation
   */
  updateBrowserBounds() {
    this._updateBrowserBounds();
  }

  /**
   * Suppress browser-view bounds updates (used when an overlay hides the view)
   */
  suppressBrowserBounds() {
    this._browserViewSuppressed = true;
  }

  /**
   * Restore browser-view bounds updates and immediately recalculate
   */
  restoreBrowserBounds() {
    this._browserViewSuppressed = false;
    this._updateBrowserBounds();
  }

  /**
   * Get current browser container bounds (below tab bar)
   */
  getBrowserBounds() {
    const container = document.getElementById('browser-container') || this.panels.browser;
    const rect = container?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0, width: 800, height: 600 };
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }

  /**
   * Listen for window resize to keep browser bounds updated
   */
  _listenForResize() {
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => this._updateBrowserBounds(), 100);
    });
  }
}

window.PanelManager = new PanelManager();
