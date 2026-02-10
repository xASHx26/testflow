/**
 * TestFlow — Recorder Inject Script
 * 
 * This script is injected into the embedded browser's target page.
 * It captures user intent-level actions (click, type, select, etc.)
 * and sends them to the main process via the preload bridge.
 */

(function () {
  'use strict';

  if (window.__testflow_recorder) return; // Prevent double injection

  const recorder = {
    active: false,
    paused: false,

    start() {
      this.active = true;
      this.paused = false;
      this._attachListeners();
      console.log('[TestFlow] Recorder started');
    },

    stop() {
      this.active = false;
      this.paused = false;
      this._detachListeners();
      console.log('[TestFlow] Recorder stopped');
    },

    pause() {
      this.paused = true;
      console.log('[TestFlow] Recorder paused');
    },

    resume() {
      this.paused = false;
      console.log('[TestFlow] Recorder resumed');
    },

    // ─── Event Handlers ──────────────────────────────────────
    _handlers: {},

    _attachListeners() {
      // Click — capture on mouseup for intent (after click completes)
      this._handlers.click = (e) => this._handleClick(e);
      document.addEventListener('click', this._handlers.click, true);

      // Input — capture typed values (debounced)
      this._handlers.input = this._debounce((e) => this._handleInput(e), 500);
      document.addEventListener('input', this._handlers.input, true);

      // Change — capture select, checkbox, radio, range
      this._handlers.change = (e) => this._handleChange(e);
      document.addEventListener('change', this._handlers.change, true);

      // Submit — capture form submissions
      this._handlers.submit = (e) => this._handleSubmit(e);
      document.addEventListener('submit', this._handlers.submit, true);

      // Keydown — capture Enter key as submit intent
      this._handlers.keydown = (e) => this._handleKeydown(e);
      document.addEventListener('keydown', this._handlers.keydown, true);
    },

    _detachListeners() {
      document.removeEventListener('click', this._handlers.click, true);
      document.removeEventListener('input', this._handlers.input, true);
      document.removeEventListener('change', this._handlers.change, true);
      document.removeEventListener('submit', this._handlers.submit, true);
      document.removeEventListener('keydown', this._handlers.keydown, true);
      this._handlers = {};
    },

    // ─── Click Handler ───────────────────────────────────────
    _handleClick(e) {
      if (!this.active || this.paused) return;
      const target = e.target;

      // Skip TestFlow overlay elements
      if (this._isTestFlowElement(target)) return;

      // Skip if it's an input change (will be handled by change/input)
      const tag = target.tagName.toLowerCase();
      const type = (target.type || '').toLowerCase();
      if (tag === 'input' && ['text', 'password', 'email', 'search', 'tel', 'url', 'number'].includes(type)) return;
      if (tag === 'textarea') return;

      this._sendAction({
        action: 'click',
        element: this._extractElement(target),
        url: window.location.href,
        value: target.value || null,
        checked: target.checked,
        timestamp: Date.now(),
      });
    },

    // ─── Input Handler (debounced) ───────────────────────────
    _handleInput(e) {
      if (!this.active || this.paused) return;
      const target = e.target;
      if (this._isTestFlowElement(target)) return;

      const tag = target.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea') {
        // For range inputs, treat as slider
        if (target.type === 'range') {
          this._sendAction({
            action: 'change',
            element: this._extractElement(target),
            url: window.location.href,
            value: target.value,
            timestamp: Date.now(),
          });
          return;
        }

        this._sendAction({
          action: 'type',
          element: this._extractElement(target),
          url: window.location.href,
          value: target.value,
          timestamp: Date.now(),
        });
      }
    },

    // ─── Change Handler ──────────────────────────────────────
    _handleChange(e) {
      if (!this.active || this.paused) return;
      const target = e.target;
      if (this._isTestFlowElement(target)) return;

      const tag = target.tagName.toLowerCase();

      if (tag === 'select') {
        const selectedOption = target.options[target.selectedIndex];
        this._sendAction({
          action: 'change',
          element: this._extractElement(target),
          url: window.location.href,
          value: selectedOption ? selectedOption.text : target.value,
          timestamp: Date.now(),
        });
      } else if (target.type === 'checkbox' || target.type === 'radio') {
        this._sendAction({
          action: 'change',
          element: this._extractElement(target),
          url: window.location.href,
          value: target.value,
          checked: target.checked,
          timestamp: Date.now(),
        });
      }
    },

    // ─── Submit Handler ──────────────────────────────────────
    _handleSubmit(e) {
      if (!this.active || this.paused) return;
      const target = e.target;
      if (this._isTestFlowElement(target)) return;

      this._sendAction({
        action: 'submit',
        element: this._extractElement(target),
        url: window.location.href,
        timestamp: Date.now(),
      });
    },

    // ─── Keydown Handler ─────────────────────────────────────
    _handleKeydown(e) {
      if (!this.active || this.paused) return;
      if (e.key === 'Enter') {
        const target = e.target;
        if (this._isTestFlowElement(target)) return;

        const tag = target.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea') {
          // Treat Enter as submit intent if inside a form
          const form = target.closest('form');
          if (form) {
            this._sendAction({
              action: 'submit',
              element: this._extractElement(form),
              url: window.location.href,
              timestamp: Date.now(),
            });
          }
        }
      }
    },

    // ─── Element Extraction ──────────────────────────────────
    _extractElement(el) {
      if (!el) return {};

      // Find associated label
      let label = '';
      if (el.id) {
        const labelEl = document.querySelector(`label[for="${el.id}"]`);
        if (labelEl) label = labelEl.textContent.trim();
      }
      if (!label && el.closest) {
        const parentLabel = el.closest('label');
        if (parentLabel) label = parentLabel.textContent.trim();
      }

      // Get computed accessible name
      const ariaLabel = el.getAttribute('aria-label') || '';
      const ariaLabelledBy = el.getAttribute('aria-labelledby');
      let accessibleName = ariaLabel;
      if (ariaLabelledBy) {
        const labelledEl = document.getElementById(ariaLabelledBy);
        if (labelledEl) accessibleName = labelledEl.textContent.trim();
      }

      return {
        tag: el.tagName.toLowerCase(),
        type: el.type || '',
        id: el.id || '',
        name: el.name || '',
        classes: Array.from(el.classList || []),
        text: (el.textContent || '').trim().substring(0, 200),
        innerText: (el.innerText || '').trim().substring(0, 200),
        placeholder: el.placeholder || '',
        ariaLabel: accessibleName || ariaLabel,
        role: el.getAttribute('role') || '',
        label: label,
        href: el.href || '',
        value: el.value || '',
        title: el.title || '',

        // Data attributes for testing
        'data-testid': el.getAttribute('data-testid') || '',
        'data-cy': el.getAttribute('data-cy') || '',
        'data-test': el.getAttribute('data-test') || '',
        'data-automation-id': el.getAttribute('data-automation-id') || '',

        // XPath
        xpath: this._getRelativeXPath(el),
        absoluteXpath: this._getAbsoluteXPath(el),

        // DOM position
        tagIndex: this._getTagIndex(el),
      };
    },

    // ─── XPath Generation ────────────────────────────────────
    _getRelativeXPath(el) {
      if (el.id) return `//*[@id="${el.id}"]`;
      if (el.name) return `//${el.tagName.toLowerCase()}[@name="${el.name}"]`;

      const parts = [];
      let current = el;

      while (current && current !== document.body) {
        let part = current.tagName.toLowerCase();

        if (current.id) {
          parts.unshift(`//*[@id="${current.id}"]`);
          break;
        }

        // Get sibling index
        const siblings = Array.from(current.parentNode?.children || []).filter(
          c => c.tagName === current.tagName
        );
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          part += `[${index}]`;
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
        let index = 0;
        let sibling = current.previousSibling;
        while (sibling) {
          if (sibling.nodeType === Node.ELEMENT_NODE && sibling.tagName === current.tagName) {
            index++;
          }
          sibling = sibling.previousSibling;
        }

        const tag = current.tagName.toLowerCase();
        parts.unshift(`${tag}[${index + 1}]`);
        current = current.parentNode;
      }

      return '/' + parts.join('/');
    },

    _getTagIndex(el) {
      const siblings = Array.from(el.parentNode?.children || []).filter(
        c => c.tagName === el.tagName
      );
      return siblings.indexOf(el);
    },

    // ─── Utility ─────────────────────────────────────────────
    _isTestFlowElement(el) {
      if (!el) return false;
      return !!(
        el.id?.startsWith('__testflow') ||
        el.closest?.('[id^="__testflow"]')
      );
    },

    _debounce(fn, delay) {
      let timer;
      return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
      };
    },

    _sendAction(action) {
      // Send via the preload bridge
      if (window.__testflow_bridge?.sendAction) {
        window.__testflow_bridge.sendAction(action);
      }
    },
  };

  window.__testflow_recorder = recorder;
})();
