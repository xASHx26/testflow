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

    // ─── Text-like input types that should be captured via input/type ─
    _TEXT_TYPES: new Set([
      'text', 'password', 'email', 'search', 'tel', 'url', 'number',
      'date', 'time', 'datetime-local', 'month', 'week',
    ]),

    // ─── Click Handler ───────────────────────────────────────
    _handleClick(e) {
      if (!this.active || this.paused) return;
      const target = e.target;

      // Skip TestFlow overlay elements
      if (this._isTestFlowElement(target)) return;

      // Skip if it's a text-like input (handled by input event)
      const tag = target.tagName.toLowerCase();
      const type = (target.type || '').toLowerCase();
      if (tag === 'input' && this._TEXT_TYPES.has(type)) return;
      if (tag === 'textarea') return;
      // Skip contenteditable (handled by input)
      if (target.isContentEditable) return;

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
      const type = (target.type || '').toLowerCase();

      // Range / slider → change action
      if (tag === 'input' && type === 'range') {
        this._sendAction({
          action: 'change',
          element: this._extractElement(target),
          url: window.location.href,
          value: target.value,
          timestamp: Date.now(),
        });
        return;
      }

      // Color picker → change action
      if (tag === 'input' && type === 'color') {
        this._sendAction({
          action: 'change',
          element: this._extractElement(target),
          url: window.location.href,
          value: target.value,
          timestamp: Date.now(),
        });
        return;
      }

      // Regular text inputs and textarea
      if (tag === 'input' || tag === 'textarea') {
        this._sendAction({
          action: 'type',
          element: this._extractElement(target),
          url: window.location.href,
          value: target.value,
          timestamp: Date.now(),
        });
        return;
      }

      // contenteditable elements
      if (target.isContentEditable) {
        this._sendAction({
          action: 'type',
          element: this._extractElement(target),
          url: window.location.href,
          value: target.innerText || target.textContent || '',
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
      const type = (target.type || '').toLowerCase();

      if (tag === 'select') {
        const selectedOption = target.options[target.selectedIndex];
        this._sendAction({
          action: 'change',
          element: this._extractElement(target),
          url: window.location.href,
          value: selectedOption ? selectedOption.text : target.value,
          selectedValue: target.value,
          selectedText:  selectedOption ? selectedOption.text : '',
          timestamp: Date.now(),
        });
      } else if (type === 'checkbox' || type === 'radio') {
        this._sendAction({
          action: 'change',
          element: this._extractElement(target),
          url: window.location.href,
          value: target.value,
          checked: target.checked,
          timestamp: Date.now(),
        });
      } else if (type === 'file') {
        const files = Array.from(target.files || []).map(f => f.name);
        this._sendAction({
          action: 'change',
          element: this._extractElement(target),
          url: window.location.href,
          value: files.join(', '),
          timestamp: Date.now(),
        });
      } else if (type === 'color' || type === 'range') {
        this._sendAction({
          action: 'change',
          element: this._extractElement(target),
          url: window.location.href,
          value: target.value,
          timestamp: Date.now(),
        });
      } else if (type === 'date' || type === 'time' || type === 'datetime-local'
               || type === 'month' || type === 'week') {
        this._sendAction({
          action: 'change',
          element: this._extractElement(target),
          url: window.location.href,
          value: target.value,
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

      // Detect the control type comprehensively
      const controlType = this._detectControlType(el);

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
        controlType: controlType,
        contentEditable: el.isContentEditable || false,

        // Data attributes for testing (standard + framework-specific)
        'data-testid': el.getAttribute('data-testid') || '',
        'data-cy': el.getAttribute('data-cy') || '',
        'data-test': el.getAttribute('data-test') || '',
        'data-test-id': el.getAttribute('data-test-id') || '',
        'data-automation-id': el.getAttribute('data-automation-id') || '',
        'data-qa': el.getAttribute('data-qa') || '',

        // Framework-specific identifiers
        'ng-model': el.getAttribute('ng-model') || el.getAttribute('data-ng-model') || '',
        'formcontrolname': el.getAttribute('formcontrolname') || '',
        'v-model': el.getAttribute('v-model') || '',

        // XPath
        xpath: this._getRelativeXPath(el),
        absoluteXpath: this._getAbsoluteXPath(el),

        // DOM position
        tagIndex: this._getTagIndex(el),
      };
    },

    /**
     * Detect the control type of an element — covers all HTML input types
     * plus framework/component-library patterns (React, Angular, Vue, MUI,
     * Ant Design, Headless UI, Radix, Chakra, etc.)
     */
    _detectControlType(el) {
      const tag  = (el.tagName || '').toLowerCase();
      const type = (el.type || '').toLowerCase();
      const role = (el.getAttribute('role') || '').toLowerCase();
      const cls  = Array.from(el.classList || []).join(' ').toLowerCase();

      // ── Native HTML input types ─────────────────────────────
      if (tag === 'input') {
        const INPUT_TYPE_MAP = {
          text: 'text', password: 'password', email: 'email', number: 'number',
          tel: 'tel', url: 'url', search: 'search',
          checkbox: 'checkbox', radio: 'radio', range: 'slider',
          color: 'color', file: 'file',
          date: 'date', time: 'time', 'datetime-local': 'datetime',
          month: 'month', week: 'week',
          hidden: 'hidden', submit: 'submit', reset: 'reset', button: 'button',
        };
        return INPUT_TYPE_MAP[type] || 'text';
      }
      if (tag === 'textarea') return 'textarea';
      if (tag === 'select')   return 'select';

      // ── Contenteditable ─────────────────────────────────────
      if (el.isContentEditable) return 'contenteditable';

      // ── WAI-ARIA roles → control types ──────────────────────
      const ROLE_MAP = {
        switch: 'toggle', slider: 'slider', spinbutton: 'number',
        combobox: 'combobox', listbox: 'listbox', option: 'option',
        radio: 'radio', radiogroup: 'radiogroup',
        checkbox: 'checkbox', menuitemcheckbox: 'checkbox',
        menuitemradio: 'radio', searchbox: 'search',
        textbox: 'text', tab: 'tab', tablist: 'tablist',
        tree: 'tree', treeitem: 'treeitem',
        grid: 'grid', gridcell: 'gridcell',
        progressbar: 'progress', meter: 'meter',
        scrollbar: 'scrollbar',
      };
      if (role && ROLE_MAP[role]) return ROLE_MAP[role];

      // ── Framework component patterns (class / attribute heuristics) ──

      // MUI (Material UI)
      if (cls.includes('mui-switch') || cls.includes('muiswitch'))       return 'toggle';
      if (cls.includes('mui-slider') || cls.includes('muislider'))       return 'slider';
      if (cls.includes('mui-select') || cls.includes('muiselect'))       return 'select';
      if (cls.includes('mui-checkbox') || cls.includes('muicheckbox'))   return 'checkbox';
      if (cls.includes('mui-radio') || cls.includes('muiradio'))         return 'radio';
      if (cls.includes('mui-rating') || cls.includes('muirating'))       return 'rating';
      if (cls.includes('mui-autocomplete'))                              return 'combobox';
      if (cls.includes('mui-datepicker') || cls.includes('muidatepicker')) return 'date';
      if (cls.includes('mui-timepicker'))                                return 'time';
      if (cls.includes('muiinputbase') || cls.includes('mui-inputbase'))  return 'text';

      // Ant Design
      if (cls.includes('ant-switch'))                                    return 'toggle';
      if (cls.includes('ant-slider'))                                    return 'slider';
      if (cls.includes('ant-select'))                                    return 'select';
      if (cls.includes('ant-checkbox'))                                  return 'checkbox';
      if (cls.includes('ant-radio'))                                     return 'radio';
      if (cls.includes('ant-rate'))                                      return 'rating';
      if (cls.includes('ant-picker'))                                    return 'date';
      if (cls.includes('ant-cascader'))                                  return 'cascader';
      if (cls.includes('ant-transfer'))                                  return 'transfer';
      if (cls.includes('ant-upload'))                                    return 'file';
      if (cls.includes('ant-input-number'))                              return 'number';
      if (cls.includes('ant-input'))                                     return 'text';

      // Chakra UI
      if (cls.includes('chakra-switch'))                                 return 'toggle';
      if (cls.includes('chakra-slider'))                                 return 'slider';
      if (cls.includes('chakra-checkbox'))                               return 'checkbox';
      if (cls.includes('chakra-radio'))                                  return 'radio';
      if (cls.includes('chakra-select'))                                 return 'select';
      if (cls.includes('chakra-numberinput'))                            return 'number';

      // Headless UI / Radix
      if (el.getAttribute('data-headlessui-state') != null)              return 'toggle';
      if (el.getAttribute('data-radix-collection-item') != null)         return 'option';
      if (el.getAttribute('data-state') === 'checked')                   return 'checkbox';
      if (el.getAttribute('data-state') === 'unchecked')                 return 'checkbox';

      // PrimeReact / PrimeNG / PrimeVue
      if (cls.includes('p-inputswitch'))                                 return 'toggle';
      if (cls.includes('p-slider'))                                      return 'slider';
      if (cls.includes('p-dropdown'))                                    return 'select';
      if (cls.includes('p-checkbox'))                                    return 'checkbox';
      if (cls.includes('p-radiobutton'))                                 return 'radio';
      if (cls.includes('p-calendar'))                                    return 'date';
      if (cls.includes('p-rating'))                                      return 'rating';
      if (cls.includes('p-multiselect'))                                 return 'multiselect';
      if (cls.includes('p-chips'))                                       return 'chips';
      if (cls.includes('p-colorpicker'))                                 return 'color';
      if (cls.includes('p-inputnumber'))                                 return 'number';

      // Vuetify
      if (cls.includes('v-switch'))                                      return 'toggle';
      if (cls.includes('v-slider'))                                      return 'slider';
      if (cls.includes('v-checkbox'))                                    return 'checkbox';
      if (cls.includes('v-radio'))                                       return 'radio';
      if (cls.includes('v-select') || cls.includes('v-autocomplete'))    return 'select';
      if (cls.includes('v-rating'))                                      return 'rating';
      if (cls.includes('v-file-input'))                                  return 'file';
      if (cls.includes('v-color-picker'))                                return 'color';
      if (cls.includes('v-text-field'))                                  return 'text';

      // Bootstrap
      if (cls.includes('form-check-input') && type === 'checkbox')       return 'checkbox';
      if (cls.includes('form-check-input') && type === 'radio')          return 'radio';
      if (cls.includes('form-switch'))                                   return 'toggle';
      if (cls.includes('form-range'))                                    return 'slider';
      if (cls.includes('form-select'))                                   return 'select';
      if (cls.includes('form-control'))                                  return 'text';

      // Generic toggle / switch patterns
      if (cls.includes('toggle') || cls.includes('switch'))              return 'toggle';

      // Buttons
      if (tag === 'button' || role === 'button')                         return 'button';
      if (tag === 'a')                                                   return 'link';

      return 'unknown';
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
