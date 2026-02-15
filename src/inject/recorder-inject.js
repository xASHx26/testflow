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
      // Cleanup datepicker state
      if (this._datePickerPollTimer) {
        clearInterval(this._datePickerPollTimer);
        this._datePickerPollTimer = null;
      }
      this._datePickerActive = null;
      this._datePickerSuppressClicks = false;
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
    // Pointer-based drag tracking (for library-based drag like sortable)
    _pointerDragState: null,
    _lastPointerWasDrag: false,
    _DRAG_THRESHOLD: 30, // px movement before we consider it a drag

    // ─── Date/Time Picker State ──────────────────────────────
    _datePickerObserver: null,       // MutationObserver for calendar popups
    _datePickerActive: null,         // Currently active datepicker input element
    _datePickerValueBefore: null,    // Value before interaction
    _datePickerFramework: null,      // Detected framework name
    _datePickerSuppressClicks: false, // Suppress calendar cell clicks

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

      // Drag & Drop (HTML5 native)
      this._handlers.dragstart = (e) => this._handleDragStart(e);
      this._handlers.drop = (e) => this._handleDrop(e);
      document.addEventListener('dragstart', this._handlers.dragstart, true);
      document.addEventListener('drop', this._handlers.drop, true);

      // Pointer-based drag detection (for sortable / react-dnd / dnd-kit etc.)
      this._handlers.pointerdown = (e) => this._handlePointerDown(e);
      this._handlers.pointermove = (e) => this._handlePointerMove(e);
      this._handlers.pointerup   = (e) => this._handlePointerUp(e);
      document.addEventListener('pointerdown', this._handlers.pointerdown, true);
      document.addEventListener('pointermove', this._handlers.pointermove, true);
      document.addEventListener('pointerup',   this._handlers.pointerup,   true);
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
      document.removeEventListener('pointerdown', this._handlers.pointerdown, true);
      document.removeEventListener('pointermove', this._handlers.pointermove, true);
      document.removeEventListener('pointerup',   this._handlers.pointerup,   true);
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

      // If the pointer gesture was a drag (moved > threshold), suppress the
      // click — the pointerup handler already recorded a drag action.
      if (this._lastPointerWasDrag) return;

      const tag = target.tagName.toLowerCase();
      const type = (target.type || '').toLowerCase();

      // ── Date/Time Picker Click Interception ─────────────────
      // If a datepicker popup is active, suppress clicks on calendar cells,
      // navigation arrows, month/year selectors — the _finalizeDatePicker
      // will emit the proper set_date/set_time/set_datetime action.
      if (this._datePickerSuppressClicks) {
        const pickerCheck = this._detectDateTimePicker(target);
        if (pickerCheck.isPicker) return; // Suppress calendar cell clicks
      }

      // Check if this click OPENS a datepicker popup
      const datePickerDetect = this._detectDateTimePicker(target);
      if (datePickerDetect.isPicker && datePickerDetect.inputEl && !this._datePickerActive) {
        // A calendar popup was clicked (maybe opening it) — start watching
        this._startDatePickerWatch(datePickerDetect.inputEl, datePickerDetect.framework);
        return; // Don't record the opening click
      }

      // Check if clicking ON a date input (which opens native or framework picker)
      if (tag === 'input' && ['date', 'time', 'datetime-local', 'month', 'week'].includes(type)) {
        // Native date inputs — their change event handles value capture.
        // Don't suppress the click, but do track it for value-before.
        this._datePickerValueBefore = target.value || '';
      }

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

      // Skip clicks on wrapper elements (div, span, etc.) that contain a
      // checkbox or radio input — the click bubbles up from the label/wrapper
      // and the change handler already captures the actual toggle/select.
      if (tag !== 'a' && tag !== 'button' && tag !== 'input' && tag !== 'select') {
        const innerCheck = target.querySelector('input[type="checkbox"],input[type="radio"]');
        if (innerCheck) return;
      }

      // Classify by interaction type, not HTML tag
      const interactionType = this._classifyClickInteraction(target);
      const action = (interactionType === 'toggle' || interactionType === 'checkbox') ? 'toggle' : 'click';

      // Detect react-select option / container clicks and enrich with metadata
      let reactSelect = null;
      const elId = target.id || '';
      const optMatch = elId.match(/^react-select-(\d+)-option-/);
      if (optMatch) {
        // Clicked an option — capture the option index and dropdown name.
        // Options are rendered in a portal outside the container div, so
        // walk up from the react-select *input* (which IS inside the
        // container) to find the named ancestor (e.g. 'state', 'city').
        const selectNum = optMatch[1];
        const container = (() => {
          const rsInput = document.getElementById('react-select-' + selectNum + '-input');
          if (!rsInput) return null;
          let n = rsInput;
          while (n && n !== document.body) {
            if (n.id && !/^react-select-/.test(n.id)) return n;
            n = n.parentElement;
          }
          return null;
        })();
        // Extract 0-based option index from ID → store as 1-based
        const idxMatch = elId.match(/react-select-\d+-option-(\d+)/);
        const optionIndex = idxMatch ? parseInt(idxMatch[1], 10) + 1 : 1;
        reactSelect = {
          type: 'option',
          selectNum,
          optionText: (target.textContent || '').trim(),
          optionIndex,
          containerName: container ? (container.id || '') : '',
        };
      } else {
        // Check if we're inside a react-select container (clicking placeholder, etc.)
        let n = target;
        while (n && n !== document.body) {
          const rsInput = n.querySelector('input[id^="react-select-"]');
          if (rsInput) {
            const cMatch = rsInput.id.match(/^react-select-(\d+)-input$/);
            const container = (() => {
              let p = n;
              while (p && p !== document.body) {
                if (p.id && !/^react-select-/.test(p.id)) return p;
                p = p.parentElement;
              }
              return null;
            })();
            reactSelect = {
              type: 'container',
              selectNum: cMatch ? cMatch[1] : '',
              containerName: container ? (container.id || '') : '',
            };
            break;
          }
          n = n.parentElement;
        }
      }

      this._sendAction({
        action,
        interactionType,
        element: this._extractElement(target),
        url: window.location.href,
        value: target.value || null,
        checked: target.checked,
        valueBefore: this._valueBefore.get(target) ?? null,
        reactSelect,
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

      // Skip input events on date/time inputs when a datepicker is active —
      // the _finalizeDatePicker handles the value capture.
      if (this._datePickerActive === target) return;
      if (['date', 'time', 'datetime-local', 'month', 'week'].includes(type)) {
        // Native date/time inputs: check if a datepicker framework opened
        const pickerCheck = this._detectDateTimePicker(target);
        if (pickerCheck.isPicker) return;
      }

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
        // ── Native Date/Time Input Change ─────────────────────
        // If a datepicker framework is actively tracking this input,
        // let _finalizeDatePicker handle it to avoid duplicate events.
        if (this._datePickerActive === target) return;

        const actionType = this._classifyDateTimeAction(target, 'native');
        const isoValue = this._normalizeToISO(target.value, actionType);
        this._sendAction({
          action: actionType,
          interactionType: 'datetime',
          element: this._extractElement(target),
          url: window.location.href,
          value: isoValue || target.value,
          rawValue: target.value,
          valueBefore: before,
          valueAfter: target.value,
          isoValue: isoValue,
          displayFormat: this._detectDisplayFormat(target),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
          framework: 'native',
          controlSubType: 'native',
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

    // ─── Pointer-based Drag Detection ────────────────────────
    // Libraries like react-beautiful-dnd, @dnd-kit, sortablejs etc. use
    // pointer/mouse events, not the HTML5 drag API.
    _handlePointerDown(e) {
      if (!this.active || this.paused) return;
      if (this._isTestFlowElement(e.target)) return;
      if (e.button !== 0) return; // only primary button
      this._pointerDragState = {
        startX: e.clientX,
        startY: e.clientY,
        element: this._extractElement(e.target),
        target: e.target,
        isDrag: false,
        timestamp: Date.now(),
      };
    },

    _handlePointerMove(e) {
      if (!this._pointerDragState) return;
      const s = this._pointerDragState;
      if (s.isDrag) return; // already classified as drag
      const dx = Math.abs(e.clientX - s.startX);
      const dy = Math.abs(e.clientY - s.startY);
      if (dx > this._DRAG_THRESHOLD || dy > this._DRAG_THRESHOLD) {
        s.isDrag = true;
      }
    },

    _handlePointerUp(e) {
      const s = this._pointerDragState;
      this._pointerDragState = null;
      if (!s || !s.isDrag) {
        this._lastPointerWasDrag = false;
        return;
      }
      this._lastPointerWasDrag = true;
      // Clear the flag after a tick so the subsequent click event sees it
      setTimeout(() => { this._lastPointerWasDrag = false; }, 50);
      if (!this.active || this.paused) return;
      if (this._isTestFlowElement(e.target)) return;
      // It was a real drag — record it
      this._sendAction({
        action: 'drag',
        interactionType: 'pointer_drag',
        element: s.element,
        dropTarget: this._extractElement(e.target),
        dragStartX: s.startX,
        dragStartY: s.startY,
        dragEndX: e.clientX,
        dragEndY: e.clientY,
        url: window.location.href,
        timestamp: Date.now(),
      });
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

    // ─── Date/Time Picker Detection & Handling ─────────────
    /**
     * Detect if an element is part of a date/time picker popup (calendar cells,
     * month/year navigation, time list items, etc.).
     * Returns { isPicker: true, framework, inputEl, popupEl } or { isPicker: false }.
     */
    _detectDateTimePicker(el) {
      if (!el) return { isPicker: false };
      const cls = (el.className || '').toLowerCase();
      const parentCls = (n) => {
        let c = n;
        for (let i = 0; i < 10 && c; i++) {
          const cc = (c.className || '').toLowerCase();
          const id = (c.id || '').toLowerCase();
          // react-datepicker
          if (cc.includes('react-datepicker') || id.includes('react-datepicker'))
            return { framework: 'react-datepicker', popup: c.closest('.react-datepicker-popper, .react-datepicker') || c };
          // MUI DatePicker / TimePicker / DateTimePicker
          if (cc.includes('muipickersday') || cc.includes('muidatepicker') ||
              cc.includes('muidatetimepicker') || cc.includes('muitimepicker') ||
              cc.includes('muipickerscalendar') || cc.includes('muicalendarday') ||
              cc.includes('muipickersmodal') || cc.includes('muipickerspopper') ||
              cc.includes('muipickerslayout') || cc.includes('muipickerscalendarheader') ||
              cc.includes('muiclock') || cc.includes('muitimeclock') ||
              cc.includes('muidigitalclock') || cc.includes('muimultisectiondigitalclock'))
            return { framework: 'mui', popup: c.closest('[class*="MuiPopper"], [class*="MuiDialog"], [class*="MuiPickersPopper"]') || c };
          // Ant Design DatePicker / TimePicker
          if (cc.includes('ant-picker-dropdown') || cc.includes('ant-picker-panel') ||
              cc.includes('ant-picker-cell') || cc.includes('ant-picker-time-panel') ||
              cc.includes('ant-picker-header') || cc.includes('ant-picker-body') ||
              cc.includes('ant-picker-content') || cc.includes('ant-picker-date-panel') ||
              cc.includes('ant-calendar'))
            return { framework: 'antd', popup: c.closest('.ant-picker-dropdown, .ant-picker-panel-container') || c };
          // Chakra UI / react-day-picker
          if (cc.includes('chakra-datepicker') || cc.includes('rdp-day') || cc.includes('rdp-cell') ||
              cc.includes('rdp-month') || cc.includes('rdp-caption') || cc.includes('rdp-table'))
            return { framework: 'chakra', popup: c.closest('[class*="rdp"], [class*="chakra-datepicker"]') || c };
          // PrimeReact Calendar
          if (cc.includes('p-datepicker') || cc.includes('p-datepicker-calendar') ||
              cc.includes('p-monthpicker') || cc.includes('p-yearpicker') ||
              cc.includes('p-timepicker'))
            return { framework: 'primereact', popup: c.closest('.p-datepicker') || c };
          // Flatpickr
          if (cc.includes('flatpickr-calendar') || cc.includes('flatpickr-day') ||
              cc.includes('flatpickr-month') || cc.includes('flatpickr-time'))
            return { framework: 'flatpickr', popup: c.closest('.flatpickr-calendar') || c };
          // Bootstrap Datepicker
          if (cc.includes('datepicker-dropdown') || cc.includes('datepicker-days') ||
              cc.includes('datepicker-months') || cc.includes('datepicker-years'))
            return { framework: 'bootstrap-datepicker', popup: c.closest('.datepicker-dropdown, .datepicker') || c };
          // Generic calendar heuristics
          if ((cc.includes('calendar') && (cc.includes('day') || cc.includes('cell') || cc.includes('date'))) ||
              (cc.includes('datepicker') && (cc.includes('day') || cc.includes('cell'))))
            return { framework: 'generic', popup: c.closest('[class*="calendar"], [class*="datepicker"]') || c };
          c = c.parentElement;
        }
        return null;
      };

      const detected = parentCls(el);
      if (!detected) return { isPicker: false };

      // Find the associated input element
      const inputEl = this._findDateTimeInput(detected.framework, detected.popup);

      return {
        isPicker: true,
        framework: detected.framework,
        inputEl,
        popupEl: detected.popup,
      };
    },

    /**
     * Find the date/time input element associated with a picker popup.
     */
    _findDateTimeInput(framework, popupEl) {
      // Strategy 1: Look for a focused input of date/time type
      const focused = document.activeElement;
      if (focused && (focused.tagName || '').toLowerCase() === 'input') {
        const ft = (focused.type || '').toLowerCase();
        if (['date', 'time', 'datetime-local', 'month', 'week', 'text'].includes(ft)) {
          return focused;
        }
      }

      // Strategy 2: Framework-specific lookup
      switch (framework) {
        case 'react-datepicker': {
          const wrapper = document.querySelector('.react-datepicker-wrapper input') ||
                          document.querySelector('.react-datepicker__input-container input');
          if (wrapper) return wrapper;
          break;
        }
        case 'mui': {
          const muiInput = document.querySelector('.MuiInputBase-input[type], .MuiOutlinedInput-input, .MuiInput-input');
          if (muiInput) return muiInput;
          break;
        }
        case 'antd': {
          const antInput = document.querySelector('.ant-picker-focused input, .ant-picker-input input');
          if (antInput) return antInput;
          break;
        }
        case 'primereact': {
          const primeInput = document.querySelector('.p-calendar .p-inputtext, .p-calendar input');
          if (primeInput) return primeInput;
          break;
        }
        case 'flatpickr': {
          const fpInput = document.querySelector('.flatpickr-input, input[data-input]');
          if (fpInput) return fpInput;
          break;
        }
      }

      // Strategy 3: Find any recently focused date-related input
      const dateInputs = document.querySelectorAll(
        'input[type="date"], input[type="time"], input[type="datetime-local"], ' +
        'input[type="month"], input[type="week"], ' +
        'input[class*="date" i], input[class*="picker" i], input[class*="calendar" i], ' +
        'input[placeholder*="date" i], input[placeholder*="DD" i], input[placeholder*="MM" i], ' +
        'input[placeholder*="YYYY" i], input[placeholder*="mm/dd" i], input[placeholder*="dd/mm" i]'
      );
      if (dateInputs.length === 1) return dateInputs[0];

      // Strategy 4: Look near the popup in DOM
      if (popupEl) {
        const prev = popupEl.previousElementSibling;
        if (prev) {
          const inp = prev.querySelector('input') || (prev.tagName === 'INPUT' ? prev : null);
          if (inp) return inp;
        }
      }

      return null;
    },

    /**
     * Determine the action type (set_date, set_time, set_datetime) based on
     * the input element and detected framework.
     */
    _classifyDateTimeAction(inputEl, framework) {
      if (!inputEl) return 'set_date'; // default
      const type = (inputEl.type || '').toLowerCase();
      if (type === 'time') return 'set_time';
      if (type === 'datetime-local') return 'set_datetime';
      if (type === 'date') return 'set_date';
      if (type === 'month') return 'set_date';
      if (type === 'week') return 'set_date';
      // For text-type inputs used by frameworks, inspect attributes
      const cls = (inputEl.className || '').toLowerCase();
      const ph = (inputEl.placeholder || '').toLowerCase();
      const ariaLabel = (inputEl.getAttribute('aria-label') || '').toLowerCase();
      const name = (inputEl.name || '').toLowerCase();
      if (cls.includes('time') || ph.includes('time') || ariaLabel.includes('time') || name.includes('time')) {
        if (cls.includes('date') || ph.includes('date') || ariaLabel.includes('date') || name.includes('date'))
          return 'set_datetime';
        return 'set_time';
      }
      return 'set_date';
    },

    /**
     * Normalize a date/time value to ISO 8601 format.
     * Handles: native input values (already ISO), display formats, timestamps.
     */
    _normalizeToISO(value, actionType) {
      if (!value) return '';
      const str = String(value).trim();
      if (!str) return '';

      // Already ISO format?  (2025-01-15, 14:30, 2025-01-15T14:30)
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(str)) return str;
      if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
      if (/^\d{2}:\d{2}(:\d{2})?$/.test(str)) return str;
      if (/^\d{4}-W\d{2}$/.test(str)) return str;   // week: 2025-W03
      if (/^\d{4}-\d{2}$/.test(str)) return str;     // month: 2025-01

      // Try parsing as a Date
      const d = new Date(str);
      if (!isNaN(d.getTime())) {
        if (actionType === 'set_time') {
          return d.toTimeString().slice(0, 5); // HH:MM
        }
        if (actionType === 'set_datetime') {
          return d.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
        }
        return d.toISOString().slice(0, 10); // YYYY-MM-DD
      }

      // Unable to normalize — return raw value
      return str;
    },

    /**
     * Extract the current display format from a date input (for metadata).
     */
    _detectDisplayFormat(inputEl) {
      if (!inputEl) return '';
      const ph = inputEl.placeholder || '';
      if (ph) return ph;
      // Infer from the current value pattern
      const val = inputEl.value || '';
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(val)) return 'MM/DD/YYYY';
      if (/^\d{2}-\d{2}-\d{4}$/.test(val)) return 'DD-MM-YYYY';
      if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return 'YYYY-MM-DD';
      if (/^\d{2}:\d{2}$/.test(val)) return 'HH:mm';
      if (/^\d{2}:\d{2}:\d{2}$/.test(val)) return 'HH:mm:ss';
      return '';
    },

    /**
     * Start observing for calendar popup value changes.
     * When a user clicks a date cell, the input value updates —
     * this observer captures that final value.
     */
    _startDatePickerWatch(inputEl, framework) {
      this._datePickerActive = inputEl;
      this._datePickerValueBefore = inputEl ? (inputEl.value || '') : '';
      this._datePickerFramework = framework;
      this._datePickerSuppressClicks = true;

      // Watch for value changes via polling (works for all frameworks)
      // The change/input events will also fire and _handleChange/_handleInput
      // will detect the active picker and emit the right action.
      if (this._datePickerPollTimer) clearInterval(this._datePickerPollTimer);
      this._datePickerPollTimer = setInterval(() => {
        if (!this._datePickerActive) {
          clearInterval(this._datePickerPollTimer);
          return;
        }
        // Check if popup is still open
        const popup = this._isDatePickerPopupOpen(framework);
        if (!popup) {
          this._finalizeDatePicker();
        }
      }, 300);
    },

    /**
     * Check if a datepicker popup is still open.
     */
    _isDatePickerPopupOpen(framework) {
      switch (framework) {
        case 'react-datepicker':
          return !!document.querySelector('.react-datepicker-popper, .react-datepicker:not(.react-datepicker--closed)');
        case 'mui':
          return !!document.querySelector('[class*="MuiPickersPopper"], [class*="MuiDialog"][class*="picker" i], [class*="MuiPopper"]');
        case 'antd':
          return !!document.querySelector('.ant-picker-dropdown:not(.ant-picker-dropdown-hidden), .ant-picker-panel-container');
        case 'primereact':
          return !!document.querySelector('.p-datepicker:not(.p-datepicker-inline)');
        case 'flatpickr':
          return !!document.querySelector('.flatpickr-calendar.open');
        default:
          return !!document.querySelector('[class*="calendar"][class*="open" i], [class*="datepicker"][class*="open" i], [class*="picker-dropdown"]');
      }
    },

    /**
     * Finalize date picker interaction — emit the set_date/set_time/set_datetime action
     * with the final value from the input.
     */
    _finalizeDatePicker() {
      const inputEl = this._datePickerActive;
      if (!inputEl) return;

      const newValue = inputEl.value || '';
      const oldValue = this._datePickerValueBefore || '';

      // Only emit if value actually changed
      if (newValue && newValue !== oldValue) {
        const actionType = this._classifyDateTimeAction(inputEl, this._datePickerFramework);
        const isoValue = this._normalizeToISO(newValue, actionType);

        this._sendAction({
          action: actionType,
          interactionType: 'datetime',
          element: this._extractElement(inputEl),
          url: window.location.href,
          value: isoValue || newValue,
          rawValue: newValue,
          valueBefore: oldValue,
          valueAfter: newValue,
          isoValue: isoValue,
          displayFormat: this._detectDisplayFormat(inputEl),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
          framework: this._datePickerFramework || 'native',
          controlSubType: this._datePickerFramework || 'native',
          timestamp: Date.now(),
        });
      }

      // Cleanup
      this._datePickerActive = null;
      this._datePickerValueBefore = null;
      this._datePickerFramework = null;
      this._datePickerSuppressClicks = false;
      if (this._datePickerPollTimer) {
        clearInterval(this._datePickerPollTimer);
        this._datePickerPollTimer = null;
      }
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
