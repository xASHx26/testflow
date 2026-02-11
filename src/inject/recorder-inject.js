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
      this._startModalObserver();
      console.log('[TestFlow] Recorder started (v2)');
    },

    stop() {
      this.active = false;
      this.paused = false;
      this._detachListeners();
      this._stopModalObserver();
      console.log('[TestFlow] Recorder stopped');
    },

    pause() {
      this.paused = true;
    },

    resume() {
      this.paused = false;
    },

    // ─── State & Event Handlers ──────────────────────────────
    _handlers: {},
    _valueBefore: new WeakMap(),
    _hoverTimers: new WeakMap(),
    _dragSource: null,
    _modalObserver: null,

    _attachListeners() {
      // Focusin — capture value_before for any form element
      this._handlers.focusin = (e) => this._handleFocusIn(e);
      document.addEventListener('focusin', this._handlers.focusin, true);

      // Click
      this._handlers.click = (e) => this._handleClick(e);
      document.addEventListener('click', this._handlers.click, true);

      // Input — typed values (debounced)
      this._handlers.input = this._debounce((e) => this._handleInput(e), 500);
      document.addEventListener('input', this._handlers.input, true);

      // Change — select, checkbox, radio, range, file, date/time
      this._handlers.change = (e) => this._handleChange(e);
      document.addEventListener('change', this._handlers.change, true);

      // Submit
      this._handlers.submit = (e) => this._handleSubmit(e);
      document.addEventListener('submit', this._handlers.submit, true);

      // Keydown — Enter as submit
      this._handlers.keydown = (e) => this._handleKeydown(e);
      document.addEventListener('keydown', this._handlers.keydown, true);

      // Hover (intentional, with dwell threshold)
      this._handlers.mouseover = (e) => this._handleMouseOver(e);
      this._handlers.mouseout = (e) => this._handleMouseOut(e);
      document.addEventListener('mouseover', this._handlers.mouseover, true);
      document.addEventListener('mouseout', this._handlers.mouseout, true);

      // Scroll (debounced)
      this._handlers.scroll = this._debounce((e) => this._handleScroll(e), 800);
      window.addEventListener('scroll', this._handlers.scroll, true);

      // Drag & Drop
      this._handlers.dragstart = (e) => this._handleDragStart(e);
      this._handlers.drop = (e) => this._handleDrop(e);
      document.addEventListener('dragstart', this._handlers.dragstart, true);
      document.addEventListener('drop', this._handlers.drop, true);
    },

    _detachListeners() {
      document.removeEventListener('focusin', this._handlers.focusin, true);
      document.removeEventListener('click', this._handlers.click, true);
      document.removeEventListener('input', this._handlers.input, true);
      document.removeEventListener('change', this._handlers.change, true);
      document.removeEventListener('submit', this._handlers.submit, true);
      document.removeEventListener('keydown', this._handlers.keydown, true);
      document.removeEventListener('mouseover', this._handlers.mouseover, true);
      document.removeEventListener('mouseout', this._handlers.mouseout, true);
      window.removeEventListener('scroll', this._handlers.scroll, true);
      document.removeEventListener('dragstart', this._handlers.dragstart, true);
      document.removeEventListener('drop', this._handlers.drop, true);
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

      if (this._isTestFlowElement(target)) return;

      const tag = target.tagName.toLowerCase();
      const type = (target.type || '').toLowerCase();
      // DON'T filter text input clicks — the click may open a datepicker, 
      // autocomplete dropdown, or have other side effects.  The recorder-engine's
      // pending-click buffer will suppress clicks that are immediately followed
      // by typing (input events) on the same element.
      if (tag === 'textarea') return;
      // Skip <option> AND <select> clicks — the change handler captures the
      // actual selection intent.  Clicking a native <select> opens a blocking
      // OS dropdown that freezes Electron JS execution during replay.
      if (tag === 'option') return;
      if (tag === 'select') return;
      if (target.isContentEditable) return;

      // Skip clicks on <label> elements whose associated input is a
      // checkbox or radio — the change event on the input captures the
      // real state change.  Recording the label click too creates duplicates.
      if (tag === 'label') {
        const forId = target.getAttribute('for');
        const assocInput = forId
          ? document.getElementById(forId)
          : target.querySelector('input[type="checkbox"],input[type="radio"]');
        if (assocInput) {
          const assocType = (assocInput.type || '').toLowerCase();
          if (assocType === 'checkbox' || assocType === 'radio') return;
        }
      }

      // Skip direct clicks on radio / checkbox inputs — the change handler
      // records the proper toggle / select action with correct state.
      if (tag === 'input' && (type === 'checkbox' || type === 'radio')) return;

      // Classify by interaction type, not HTML tag
      const interactionType = this._classifyClickInteraction(target);
      const action = (interactionType === 'toggle' || interactionType === 'checkbox') ? 'toggle' : 'click';

      this._sendAction({
        action,
        interactionType,
        element: this._extractElement(target),
        url: window.location.href,
        value: target.value || null,
        checked: target.checked,
        valueBefore: this._valueBefore.get(target) ?? null,
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

      // Skip input events on non-text controls — the change handler
      // records the proper action for these (toggle, radio, select, file).
      if (type === 'checkbox' || type === 'radio' || type === 'file') return;
      if (tag === 'select') return;

      const before = this._valueBefore.get(target) ?? '';

      // Range / slider
      if (tag === 'input' && type === 'range') {
        this._sendAction({
          action: 'change',
          interactionType: 'slider',
          element: this._extractElement(target),
          url: window.location.href,
          value: target.value,
          valueBefore: before,
          valueAfter: target.value,
          timestamp: Date.now(),
        });
        return;
      }

      // Color picker
      if (tag === 'input' && type === 'color') {
        this._sendAction({
          action: 'change',
          interactionType: 'color',
          element: this._extractElement(target),
          url: window.location.href,
          value: target.value,
          valueBefore: before,
          valueAfter: target.value,
          timestamp: Date.now(),
        });
        return;
      }

      // Regular text inputs and textarea
      if (tag === 'input' || tag === 'textarea') {
        this._sendAction({
          action: 'input',
          interactionType: 'text_input',
          element: this._extractElement(target),
          url: window.location.href,
          value: target.value,
          valueBefore: before,
          valueAfter: target.value,
          timestamp: Date.now(),
        });
        return;
      }

      // contenteditable elements
      if (target.isContentEditable) {
        this._sendAction({
          action: 'input',
          interactionType: 'text_input',
          element: this._extractElement(target),
          url: window.location.href,
          value: target.innerText || target.textContent || '',
          valueBefore: before,
          valueAfter: target.innerText || target.textContent || '',
          timestamp: Date.now(),
        });
      }
    },

    // ─── Change Handler (select, checkbox, radio, file, etc.) ─
    // Basic text types where the debounced input handler captures values —
    // suppress change events for these to avoid duplicate steps.
    _BASIC_TEXT_TYPES: new Set([
      'text', 'password', 'email', 'search', 'tel', 'url', 'number',
    ]),

    _handleChange(e) {
      if (!this.active || this.paused) return;
      const target = e.target;
      if (this._isTestFlowElement(target)) return;

      const tag = target.tagName.toLowerCase();
      const type = (target.type || '').toLowerCase();
      const before = this._valueBefore.get(target) ?? '';

      // Suppress change events for basic text inputs and textareas — the
      // debounced input handler already captures the typed value.  change fires
      // on blur and creates duplicate steps.
      if (tag === 'input' && this._BASIC_TEXT_TYPES.has(type)) return;
      if (tag === 'textarea') return;

      if (tag === 'select') {
        const selectedOption = target.options[target.selectedIndex];
        const options = Array.from(target.options).map(o => ({
          value: o.value, text: o.text.trim(), selected: o.selected,
        }));
        this._sendAction({
          action: 'select',
          interactionType: 'select',
          element: this._extractElement(target),
          url: window.location.href,
          value: selectedOption ? selectedOption.text : target.value,
          selectedValue: target.value,
          selectedText: selectedOption ? selectedOption.text : '',
          valueBefore: before,
          valueAfter: target.value,
          options,
          timestamp: Date.now(),
        });
      } else if (type === 'checkbox') {
        this._sendAction({
          action: 'toggle',
          interactionType: 'checkbox',
          element: this._extractElement(target),
          url: window.location.href,
          value: target.checked,
          checked: target.checked,
          valueBefore: !target.checked,
          valueAfter: target.checked,
          timestamp: Date.now(),
        });
      } else if (type === 'radio') {
        this._sendAction({
          action: 'select',
          interactionType: 'radio',
          element: this._extractElement(target),
          url: window.location.href,
          value: target.value,
          checked: target.checked,
          groupName: target.name || '',
          valueBefore: before,
          valueAfter: target.value,
          timestamp: Date.now(),
        });
      } else if (type === 'file') {
        const files = Array.from(target.files || []).map(f => f.name);
        this._sendAction({
          action: 'change',
          interactionType: 'file',
          element: this._extractElement(target),
          url: window.location.href,
          value: files.join(', '),
          files,
          timestamp: Date.now(),
        });
      } else if (type === 'color') {
        this._sendAction({
          action: 'change',
          interactionType: 'color',
          element: this._extractElement(target),
          url: window.location.href,
          value: target.value,
          valueBefore: before,
          valueAfter: target.value,
          timestamp: Date.now(),
        });
      } else if (type === 'range') {
        this._sendAction({
          action: 'change',
          interactionType: 'slider',
          element: this._extractElement(target),
          url: window.location.href,
          value: target.value,
          valueBefore: before,
          valueAfter: target.value,
          timestamp: Date.now(),
        });
      } else if (['date', 'time', 'datetime-local', 'month', 'week'].includes(type)) {
        this._sendAction({
          action: 'change',
          interactionType: 'datetime',
          element: this._extractElement(target),
          url: window.location.href,
          value: target.value,
          valueBefore: before,
          valueAfter: target.value,
          timestamp: Date.now(),
        });
      } else {
        // Catch-all: number, any other input type, or unknown controls
        this._sendAction({
          action: 'change',
          interactionType: type || 'unknown',
          element: this._extractElement(target),
          url: window.location.href,
          value: target.value,
          valueBefore: before,
          valueAfter: target.value,
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

    // ─── Focus Handler (captures value_before) ───────────────
    _handleFocusIn(e) {
      if (!this.active || this.paused) return;
      const target = e.target;
      if (this._isTestFlowElement(target)) return;
      const val = this._getElementValue(target);
      if (val !== null) this._valueBefore.set(target, val);
    },

    // ─── Hover Handler (intentional hover with 1.2 s dwell) ──
    _handleMouseOver(e) {
      if (!this.active || this.paused) return;
      const target = this._findHoverTarget(e.target);
      if (!target || this._isTestFlowElement(target)) return;
      const timer = setTimeout(() => {
        this._sendAction({
          action: 'hover',
          interactionType: 'hover',
          element: this._extractElement(target),
          url: window.location.href,
          timestamp: Date.now(),
        });
      }, 1200);
      this._hoverTimers.set(target, timer);
    },

    _handleMouseOut(e) {
      const target = this._findHoverTarget(e.target);
      if (!target) return;
      const timer = this._hoverTimers.get(target);
      if (timer) { clearTimeout(timer); this._hoverTimers.delete(target); }
    },

    _findHoverTarget(el) {
      let cur = el;
      for (let i = 0; i < 5 && cur; i++) {
        if (cur.title || cur.getAttribute?.('data-tooltip') ||
            cur.getAttribute?.('aria-describedby') ||
            cur.getAttribute?.('data-tippy-content')) return cur;
        cur = cur.parentElement;
      }
      return null;
    },

    // ─── Scroll Handler (debounced) ──────────────────────────
    _handleScroll(e) {
      if (!this.active || this.paused) return;
      const isWindow = !e.target || e.target === document || e.target === document.documentElement;
      this._sendAction({
        action: 'scroll',
        interactionType: 'scroll',
        element: isWindow ? { tag: 'window' } : this._extractElement(e.target),
        url: window.location.href,
        scrollX: isWindow ? window.scrollX : (e.target.scrollLeft || 0),
        scrollY: isWindow ? window.scrollY : (e.target.scrollTop || 0),
        timestamp: Date.now(),
      });
    },

    // ─── Drag & Drop Handlers ────────────────────────────────
    _handleDragStart(e) {
      if (!this.active || this.paused) return;
      if (this._isTestFlowElement(e.target)) return;
      this._dragSource = {
        element: this._extractElement(e.target),
        timestamp: Date.now(),
      };
    },

    _handleDrop(e) {
      if (!this.active || this.paused || !this._dragSource) return;
      if (this._isTestFlowElement(e.target)) return;
      this._sendAction({
        action: 'drag',
        interactionType: 'drag_drop',
        element: this._dragSource.element,
        dropTarget: this._extractElement(e.target),
        url: window.location.href,
        timestamp: Date.now(),
      });
      this._dragSource = null;
    },

    // ─── Modal / Dialog Observer ─────────────────────────────
    _startModalObserver() {
      if (!document.body) return;
      this._modalObserver = new MutationObserver((mutations) => {
        if (!this.active || this.paused) return;
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node.nodeType === 1 && this._isModal(node)) {
              this._sendAction({
                action: 'modal',
                interactionType: 'modal',
                modalAction: 'appear',
                element: this._extractElement(node),
                url: window.location.href,
                timestamp: Date.now(),
              });
            }
          }
        }
      });
      this._modalObserver.observe(document.body, { childList: true, subtree: true });
    },

    _stopModalObserver() {
      if (this._modalObserver) { this._modalObserver.disconnect(); this._modalObserver = null; }
    },

    _isModal(el) {
      const role = (el.getAttribute?.('role') || '').toLowerCase();
      const cls = (el.className || '').toLowerCase();
      return role === 'dialog' || role === 'alertdialog' ||
        el.tagName?.toLowerCase() === 'dialog' ||
        el.getAttribute?.('aria-modal') === 'true' ||
        cls.includes('modal') || cls.includes('dialog') ||
        cls.includes('toast') || cls.includes('snackbar');
    },

    // ─── Click Interaction Classifier ────────────────────────
    _classifyClickInteraction(el) {
      const tag = (el.tagName || '').toLowerCase();
      const type = (el.type || '').toLowerCase();
      const role = (el.getAttribute('role') || '').toLowerCase();
      const cls = Array.from(el.classList || []).join(' ').toLowerCase();
      if (role === 'switch' || cls.includes('toggle') || cls.includes('switch')) return 'toggle';
      if (role === 'checkbox' || type === 'checkbox') return 'checkbox';
      if (role === 'radio' || type === 'radio') return 'radio';
      if (role === 'tab') return 'tab';
      if (tag === 'a' || role === 'link') return 'link';
      if (tag === 'button' || role === 'button' || type === 'submit') return 'button';
      return 'click';
    },

    // ─── Get current value of any element ────────────────────
    _getElementValue(el) {
      if (!el) return null;
      const tag = (el.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return el.value || '';
      if (el.isContentEditable) return el.innerText || '';
      return null;
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
