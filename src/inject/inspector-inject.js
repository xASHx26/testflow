/**
 * TestFlow — Inspector Inject Script
 * 
 * Injected into the embedded browser for element inspection.
 * Highlights hovered elements and extracts detailed element data.
 */

(function () {
  'use strict';

  if (window.__testflow_inspector) return;

  const inspector = {
    active: false,
    highlightEl: null,
    lockedElement: null,
    tooltipEl: null,

    enable() {
      this.active = true;
      this._createOverlay();
      this._attachListeners();
      this._startDOMObserver();
      document.body.style.cursor = 'crosshair';
      console.log('[TestFlow] Inspector enabled');
    },

    disable() {
      this.active = false;
      this._removeOverlay();
      this._detachListeners();
      this._stopDOMObserver();
      document.body.style.cursor = '';
      this.lockedElement = null;
      console.log('[TestFlow] Inspector disabled');
    },

    getElementAt(x, y) {
      const el = document.elementFromPoint(x, y);
      if (!el) return null;
      return this._extractFullInfo(el);
    },

    // ─── Overlay ─────────────────────────────────────────────
    _createOverlay() {
      // Highlight box
      this.highlightEl = document.createElement('div');
      this.highlightEl.id = '__testflow_inspector_highlight';
      this.highlightEl.style.cssText = `
        position: fixed;
        pointer-events: none;
        z-index: 999998;
        border: 2px solid #00d4ff;
        background: rgba(0, 212, 255, 0.1);
        transition: all 0.1s ease;
        display: none;
      `;
      document.body.appendChild(this.highlightEl);

      // Tooltip
      this.tooltipEl = document.createElement('div');
      this.tooltipEl.id = '__testflow_inspector_tooltip';
      this.tooltipEl.style.cssText = `
        position: fixed;
        pointer-events: none;
        z-index: 999999;
        background: #1e1e2e;
        color: #cdd6f4;
        font-family: 'Consolas', 'Monaco', monospace;
        font-size: 11px;
        padding: 6px 10px;
        border-radius: 4px;
        border: 1px solid #45475a;
        box-shadow: 0 4px 12px rgba(0,0,0,0.4);
        max-width: 400px;
        display: none;
        line-height: 1.5;
      `;
      document.body.appendChild(this.tooltipEl);
    },

    _removeOverlay() {
      this.highlightEl?.remove();
      this.tooltipEl?.remove();
      this.highlightEl = null;
      this.tooltipEl = null;
    },

    // ─── Event Listeners ─────────────────────────────────────
    _handlers: {},

    _attachListeners() {
      this._handlers.mousemove = (e) => this._handleMouseMove(e);
      this._handlers.click = (e) => this._handleClick(e);
      this._handlers.keydown = (e) => this._handleKeydown(e);

      document.addEventListener('mousemove', this._handlers.mousemove, true);
      document.addEventListener('click', this._handlers.click, true);
      document.addEventListener('keydown', this._handlers.keydown, true);
    },

    _detachListeners() {
      document.removeEventListener('mousemove', this._handlers.mousemove, true);
      document.removeEventListener('click', this._handlers.click, true);
      document.removeEventListener('keydown', this._handlers.keydown, true);
      this._handlers = {};
    },

    _handleMouseMove(e) {
      if (!this.active || this.lockedElement) return;

      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || el.id?.startsWith('__testflow')) return;

      this._highlightElement(el);
      this._showTooltip(el, e.clientX, e.clientY);

      // Send hover event to main process
      if (window.__testflow_bridge?.sendInspectorHover) {
        window.__testflow_bridge.sendInspectorHover(this._extractFullInfo(el));
      }
    },

    _handleClick(e) {
      if (!this.active) return;

      e.preventDefault();
      e.stopPropagation();

      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || el.id?.startsWith('__testflow')) return;

      // Toggle lock
      if (this.lockedElement === el) {
        this.lockedElement = null;
        this.highlightEl.style.borderColor = '#00d4ff';
        return;
      }

      this.lockedElement = el;
      this.highlightEl.style.borderColor = '#f38ba8';
      this._highlightElement(el);

      // Send selection to main process
      if (window.__testflow_bridge?.sendInspectorSelect) {
        window.__testflow_bridge.sendInspectorSelect(this._extractFullInfo(el));
      }
    },

    _handleKeydown(e) {
      if (!this.active) return;

      // Escape to unlock or disable
      if (e.key === 'Escape') {
        if (this.lockedElement) {
          this.lockedElement = null;
          this.highlightEl.style.borderColor = '#00d4ff';
        } else {
          this.disable();
        }
      }
    },

    // ─── Highlight ───────────────────────────────────────────
    _highlightElement(el) {
      if (!this.highlightEl) return;

      const rect = el.getBoundingClientRect();
      this.highlightEl.style.left = rect.left + 'px';
      this.highlightEl.style.top = rect.top + 'px';
      this.highlightEl.style.width = rect.width + 'px';
      this.highlightEl.style.height = rect.height + 'px';
      this.highlightEl.style.display = 'block';
    },

    _showTooltip(el, mouseX, mouseY) {
      if (!this.tooltipEl) return;

      const tag = el.tagName.toLowerCase();
      const id = el.id ? `#${el.id}` : '';
      const classes = Array.from(el.classList).slice(0, 3).map(c => `.${c}`).join('');
      const role = el.getAttribute('role') ? ` [role="${el.getAttribute('role')}"]` : '';
      const dims = `${Math.round(el.offsetWidth)}×${Math.round(el.offsetHeight)}`;

      this.tooltipEl.innerHTML = `
        <span style="color:#89b4fa;font-weight:bold;">&lt;${tag}&gt;</span>${id}<span style="color:#a6e3a1;">${classes}</span>${role}
        <br><span style="color:#6c7086;">${dims}</span>
      `;

      // Position tooltip near mouse but avoid overflow
      let x = mouseX + 12;
      let y = mouseY + 12;
      const ttRect = this.tooltipEl.getBoundingClientRect();
      if (x + 400 > window.innerWidth) x = mouseX - 400;
      if (y + 80 > window.innerHeight) y = mouseY - 80;

      this.tooltipEl.style.left = x + 'px';
      this.tooltipEl.style.top = y + 'px';
      this.tooltipEl.style.display = 'block';
    },

    // ─── DOM Observer ─────────────────────────────────────────
    _mutationObserver: null,

    _startDOMObserver() {
      if (this._mutationObserver) return;

      this._mutationObserver = new MutationObserver((mutations) => {
        if (!this.active) return;

        for (const mutation of mutations) {
          // New nodes added to DOM
          if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
            for (const node of mutation.addedNodes) {
              if (node.nodeType !== Node.ELEMENT_NODE) continue;
              if (node.id?.startsWith('__testflow')) continue;

              // Send info about significant newly added elements
              const tag = node.tagName?.toLowerCase();
              const isInteractive = ['input', 'button', 'select', 'textarea', 'a', 'form', 'dialog', 'details'].includes(tag);
              const hasRole = node.getAttribute?.('role');
              const isVisible = node.offsetParent !== null || tag === 'dialog';

              if ((isInteractive || hasRole) && isVisible) {
                if (window.__testflow_bridge?.sendInspectorHover) {
                  window.__testflow_bridge.sendInspectorHover(this._extractFullInfo(node));
                }
              }
            }
          }

          // Attribute changes (e.g. hidden→visible, display changes)
          if (mutation.type === 'attributes') {
            const node = mutation.target;
            if (!node || node.nodeType !== Node.ELEMENT_NODE) continue;
            if (node.id?.startsWith('__testflow')) continue;

            const attr = mutation.attributeName;
            if (['style', 'class', 'hidden', 'aria-hidden', 'aria-expanded', 'open'].includes(attr)) {
              const isNowVisible = node.offsetParent !== null ||
                node.tagName?.toLowerCase() === 'dialog' ||
                node.getAttribute('aria-expanded') === 'true' ||
                node.hasAttribute('open');

              if (isNowVisible && this.lockedElement === node) {
                // Re-send info for the locked element if it changed
                if (window.__testflow_bridge?.sendInspectorSelect) {
                  window.__testflow_bridge.sendInspectorSelect(this._extractFullInfo(node));
                }
              }
            }
          }
        }
      });

      this._mutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class', 'hidden', 'aria-hidden', 'aria-expanded', 'open', 'disabled'],
      });
    },

    _stopDOMObserver() {
      if (this._mutationObserver) {
        this._mutationObserver.disconnect();
        this._mutationObserver = null;
      }
    },

    // ─── Full Element Info Extraction ────────────────────────
    _extractFullInfo(el) {
      if (!el) return null;

      // Associated label
      let label = '';
      if (el.id) {
        const labelEl = document.querySelector(`label[for="${el.id}"]`);
        if (labelEl) label = labelEl.textContent.trim();
      }
      if (!label) {
        const parentLabel = el.closest?.('label');
        if (parentLabel) label = parentLabel.textContent.trim();
      }

      // Computed styles
      const styles = window.getComputedStyle(el);

      // All attributes
      const attributes = {};
      for (const attr of el.attributes) {
        attributes[attr.name] = attr.value;
      }

      return {
        tag: el.tagName.toLowerCase(),
        type: el.type || '',
        id: el.id || '',
        name: el.name || '',
        classes: Array.from(el.classList || []),
        text: (el.textContent || '').trim().substring(0, 300),
        innerText: (el.innerText || '').trim().substring(0, 300),
        placeholder: el.placeholder || '',
        ariaLabel: el.getAttribute('aria-label') || '',
        ariaRole: el.getAttribute('role') || '',
        label: label,
        href: el.href || '',
        value: el.value || '',
        title: el.title || '',
        tabIndex: el.tabIndex,
        disabled: el.disabled || false,
        readOnly: el.readOnly || false,
        required: el.required || false,

        // Data attributes
        'data-testid': el.getAttribute('data-testid') || '',
        'data-cy': el.getAttribute('data-cy') || '',
        'data-test': el.getAttribute('data-test') || '',
        'data-automation-id': el.getAttribute('data-automation-id') || '',

        // All attributes
        attributes,

        // Dimensions
        rect: {
          x: Math.round(el.getBoundingClientRect().x),
          y: Math.round(el.getBoundingClientRect().y),
          width: Math.round(el.offsetWidth),
          height: Math.round(el.offsetHeight),
        },

        // Visibility
        visible: styles.display !== 'none' && styles.visibility !== 'hidden' && el.offsetParent !== null,

        // DOM hierarchy (up to 4 levels)
        hierarchy: this._getHierarchy(el, 4),

        // XPaths
        xpath: this._getRelativeXPath(el),
        absoluteXpath: this._getAbsoluteXPath(el),

        // CSS selector
        cssSelector: this._getCSSSelector(el),

        // HTML content (truncated for large elements)
        innerHTML: (el.innerHTML || '').substring(0, 2000),
        outerHTML: (el.outerHTML || '').substring(0, 3000),
      };
    },

    _getHierarchy(el, depth) {
      const hierarchy = [];
      let current = el;
      for (let i = 0; i < depth && current && current !== document.body; i++) {
        hierarchy.push({
          tag: current.tagName.toLowerCase(),
          id: current.id || '',
          classes: Array.from(current.classList || []).slice(0, 3),
        });
        current = current.parentElement;
      }
      return hierarchy;
    },

    _getRelativeXPath(el) {
      if (el.id) return `//*[@id="${el.id}"]`;
      if (el.name) return `//${el.tagName.toLowerCase()}[@name="${el.name}"]`;

      const parts = [];
      let current = el;
      while (current && current !== document.body) {
        let part = current.tagName.toLowerCase();
        if (current.id) {
          parts.unshift(`*[@id="${current.id}"]`);
          return '//' + parts.join('/');
        }
        const siblings = Array.from(current.parentNode?.children || [])
          .filter(c => c.tagName === current.tagName);
        if (siblings.length > 1) {
          part += `[${siblings.indexOf(current) + 1}]`;
        }
        parts.unshift(part);
        current = current.parentNode;
      }
      return '//' + parts.join('/');
    },

    _getAbsoluteXPath(el) {
      const parts = [];
      let current = el;
      while (current && current.nodeType === Node.ELEMENT_NODE) {
        let idx = 0;
        let sib = current.previousSibling;
        while (sib) {
          if (sib.nodeType === Node.ELEMENT_NODE && sib.tagName === current.tagName) idx++;
          sib = sib.previousSibling;
        }
        parts.unshift(`${current.tagName.toLowerCase()}[${idx + 1}]`);
        current = current.parentNode;
      }
      return '/' + parts.join('/');
    },

    _getCSSSelector(el) {
      if (el.id) return `#${el.id}`;

      let selector = el.tagName.toLowerCase();
      const stableClasses = Array.from(el.classList || [])
        .filter(c => !/[0-9]{4,}/.test(c) && c.length > 1)
        .slice(0, 3);
      if (stableClasses.length) {
        selector += stableClasses.map(c => `.${c}`).join('');
      }
      if (el.type) {
        selector += `[type="${el.type}"]`;
      }
      return selector;
    },
  };

  window.__testflow_inspector = inspector;
})();
