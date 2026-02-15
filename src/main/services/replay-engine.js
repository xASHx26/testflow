/**
 * TestFlow — Replay Engine
 * 
 * Replays recorded flows inside the embedded browser with locator fallback,
 * explicit waits, and per-step diagnostics.
 */

const EventEmitter = require('events');

class ReplayEngine extends EventEmitter {
  constructor(browserEngine, locatorEngine, reportConfig) {
    super();
    this.browserEngine = browserEngine;
    this.locatorEngine = locatorEngine;
    this.reportConfig  = reportConfig || null;
    this.state = 'idle'; // idle | playing | paused | stepping
    this.currentFlow = null;
    this.currentStepIndex = -1;
    this.results = [];
    this.abortController = null;
    /** @type {Object<string, { buffer: Buffer, base64: string }>} */
    this.screenshots = {};
  }

  /**
   * Start replaying a flow
   */
  async startReplay(flow) {
    if (this.state !== 'idle') {
      return { success: false, message: 'Replay already in progress' };
    }

    this.currentFlow = flow;
    this.currentStepIndex = 0;
    this.results = [];
    this.screenshots = {};
    this.state = 'playing';
    this.abortController = { aborted: false };

    this.emit('state-changed', this.state);
    this.emit('replay-started', { flowId: flow.id, totalSteps: flow.steps.length });

    try {
      // Inject the visual cursor overlay so the user can see the mouse
      await this._injectCursor();

      // Navigate to the initial URL before replaying steps
      if (flow.startUrl) {
        this.emit('step-started', { stepId: '__navigate_start', index: -1, total: flow.steps.length, label: `Navigating to ${flow.startUrl}` });
        await this.browserEngine.navigate(flow.startUrl);
        // Wait for page to settle
        await this._sleep(1500);
        // Re-inject cursor after navigation (new page)
        await this._injectCursor();
        this.emit('step-completed', { stepId: '__navigate_start', index: -1, status: 'passed', label: `Navigated to start URL` });
      }

      await this._executeSteps();
    } catch (error) {
      this.emit('replay-error', { error: error.message });
    }

    // Clean up the visual cursor
    await this._destroyCursor();

    this.state = 'idle';
    this.emit('state-changed', this.state);
    this.emit('replay-finished', {
      flowId: flow.id,
      results: this.results,
      passed: this.results.every(r => r.status === 'passed'),
      screenshots: this.screenshots,
    });

    return { success: true, results: this.results, screenshots: this.screenshots };
  }

  /**
   * Stop the current replay
   */
  async stopReplay() {
    if (this.abortController) {
      this.abortController.aborted = true;
    }
    await this._destroyCursor();
    this.state = 'idle';
    this.emit('state-changed', this.state);
    return { success: true };
  }

  /**
   * Step over: execute one step and pause
   */
  async stepOver() {
    if (this.state !== 'paused' && this.state !== 'idle') {
      return { success: false, message: 'Cannot step in current state' };
    }

    if (!this.currentFlow || this.currentStepIndex >= this.currentFlow.steps.length) {
      return { success: false, message: 'No more steps to execute' };
    }

    this.state = 'stepping';
    this.emit('state-changed', this.state);

    const step = this.currentFlow.steps[this.currentStepIndex];
    const result = await this._executeStep(step);
    this.results.push(result);
    this.currentStepIndex++;

    this.state = 'paused';
    this.emit('state-changed', this.state);

    return { success: true, result };
  }

  /**
   * Get the current state of replay
   */
  getState() {
    return {
      state: this.state,
      flowId: this.currentFlow?.id || null,
      currentStep: this.currentStepIndex,
      totalSteps: this.currentFlow?.steps?.length || 0,
      results: this.results,
    };
  }

  /**
   * Execute all steps in sequence
   */
  async _executeSteps() {
    const steps = this.currentFlow.steps.filter(s => s.enabled !== false);

    for (let i = 0; i < steps.length; i++) {
      if (this.abortController?.aborted) break;

      this.currentStepIndex = i;
      const step = steps[i];

      this.emit('step-started', { stepId: step.id, index: i, total: steps.length });

      // Pre-step screenshot (if configured)
      await this._captureScreenshot(step.id + '_before', 'beforeEachStep');

      const result = await this._executeStep(step);
      this.results.push(result);

      // Post-step screenshot (if configured)
      await this._captureScreenshot(step.id, 'afterEachStep');

      this.emit('step-complete', { ...result, index: i, total: steps.length });

      // Re-inject cursor after each step (in case the page navigated)
      await this._ensureCursor();

      // Brief pause between steps so the user can follow along
      await this._sleep(300);

      if (result.status === 'failed') {
        // Failure screenshot (always captured by default)
        await this._captureScreenshot(step.id + '_failure', 'afterFailure');
        this.emit('step-failed', result);
        break; // Stop on failure
      }
    }
  }

  /**
   * Execute a single step with locator fallback and diagnostics
   */
  async _executeStep(step) {
    const startTime = Date.now();
    const diagnostics = {
      locatorUsed: null,
      locatorsFailed: [],
      fallbackUsed: false,
      waitType: step.wait?.type || 'visible',
      duration: 0,
    };

    try {
      // Handle navigation separately
      if (step.type === 'navigate') {
        const url = step.testData?.url || step.url;
        await this.browserEngine.navigate(url);
        await this._wait(step.wait);
        diagnostics.duration = Date.now() - startTime;
        return this._buildResult(step, 'passed', diagnostics);
      }

      // Handle scroll separately — scroll targets window, not a DOM element
      if (step.type === 'scroll' || step.action === 'scroll') {
        await this._performAction(step, { strategy: 'css', value: 'window' });
        diagnostics.duration = Date.now() - startTime;
        return this._buildResult(step, 'passed', diagnostics);
      }

      // Handle alert/confirm/prompt steps — no DOM element to locate
      if (step.type === 'alert' || step.action === 'alert') {
        await this._performAction(step, { strategy: 'css', value: 'body' });
        diagnostics.duration = Date.now() - startTime;
        return this._buildResult(step, 'passed', diagnostics);
      }

      // Find the element using locator fallback
      let locatorResult = await this._findElement(step.locators, step.wait);
      diagnostics.locatorUsed = locatorResult.locator;
      diagnostics.locatorsFailed = locatorResult.failed;
      diagnostics.fallbackUsed = locatorResult.fallbackUsed;

      // Recovery: if the element is a react-select dropdown option that
      // disappeared (e.g. a scroll closed the dropdown), re-open and retry.
      if (!locatorResult.found && (step.type === 'click' || step.action === 'click')) {
        const reopened = await this._tryRecoverReactSelect(step);
        if (reopened) {
          locatorResult = await this._findElement(step.locators, step.wait);
          diagnostics.locatorUsed = locatorResult.locator;
          diagnostics.locatorsFailed = locatorResult.failed;
          diagnostics.fallbackUsed = locatorResult.fallbackUsed;
        }
      }

      // Recovery for select/dropdown: if the target element is inside a
      // datepicker popup that isn't open yet, open it and retry.
      if (!locatorResult.found && (step.type === 'select' || step.action === 'select')) {
        const isDatepicker = (step.locators || []).some(l => {
          const v = l.value || '';
          return typeof v === 'string' && v.toLowerCase().includes('datepicker');
        });
        if (isDatepicker) {
          await this.browserEngine.executeScript(`
            (() => {
              const dpInput = document.querySelector('.react-datepicker-wrapper input') ||
                              document.querySelector('input[id*="date" i]') ||
                              document.querySelector('input[id*="Date" i]');
              if (dpInput) dpInput.click();
            })()
          `);
          await this._sleep(800);
          locatorResult = await this._findElement(step.locators, step.wait);
          diagnostics.locatorUsed = locatorResult.locator;
          diagnostics.locatorsFailed = locatorResult.failed;
          diagnostics.fallbackUsed = true;
        }
      }

      if (!locatorResult.found) {
        diagnostics.duration = Date.now() - startTime;
        return this._buildResult(step, 'failed', diagnostics, 'Element not found with any locator');
      }

      // Execute the action
      await this._performAction(step, locatorResult.locator);

      diagnostics.duration = Date.now() - startTime;
      return this._buildResult(step, 'passed', diagnostics);
    } catch (error) {
      diagnostics.duration = Date.now() - startTime;
      return this._buildResult(step, 'failed', diagnostics, error.message);
    }
  }

  /**
   * Find an element using the locator fallback chain
   */
  async _findElement(locators, waitConfig) {
    const result = { found: false, locator: null, failed: [], fallbackUsed: false };

    if (!locators || locators.length === 0) {
      return result;
    }

    // Sort by confidence (highest first)
    const sorted = [...locators].sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

    for (let i = 0; i < sorted.length; i++) {
      const locator = sorted[i];

      try {
        const exists = await this._waitForElement(locator, waitConfig);
        if (exists) {
          result.found = true;
          result.locator = locator;
          result.fallbackUsed = i > 0;
          return result;
        }
      } catch (e) {
        result.failed.push({ locator, error: e.message });
      }
    }

    return result;
  }

  /**
   * Wait for an element to meet the wait condition
   */
  /**
   * Wait for an element to meet the wait condition.
   * Also validates that the locator finds EXACTLY ONE element to avoid
   * clicking the wrong element when a generic selector matches multiple.
   */
  async _waitForElement(locator, waitConfig) {
    const timeout = waitConfig?.timeout || 5000;
    const waitType = waitConfig?.type || 'visible';
    const interval = 200;
    const maxAttempts = Math.ceil(timeout / interval);

    const locatorJs = this._buildLocatorJs(locator);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        let check;
        switch (waitType) {
          case 'clickable':
          case 'visible':
            check = `
              (() => {
                const el = ${locatorJs};
                if (!el) return false;
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
              })()
            `;
            break;
          case 'present':
            check = `!!${locatorJs}`;
            break;
          default:
            check = `!!${locatorJs}`;
        }

        const found = await this.browserEngine.executeScript(check);
        if (found) {
          // Verify uniqueness — if multiple elements match, reject this
          // locator so the fallback chain tries a more specific one.
          if (locator.type === 'css') {
            const escapedCss = locator.value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            const count = await this.browserEngine.executeScript(
              `document.querySelectorAll('${escapedCss}').length`
            );
            if (count > 1) return false;
          }
          // buttonText: check if multiple buttons share the same text
          if (locator.type === 'buttonText') {
            const escapedBt = locator.value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            const count = await this.browserEngine.executeScript(`
              Array.from(document.querySelectorAll('button,[role="button"]')).filter(
                el => el.textContent.trim() === '${escapedBt}'
              ).length
            `);
            if (count > 1) return false;
          }
          // linkText: check if multiple links share the same text
          if (locator.type === 'linkText') {
            const escapedLt = locator.value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            const count = await this.browserEngine.executeScript(`
              Array.from(document.querySelectorAll('a')).filter(
                el => el.textContent.trim() === '${escapedLt}'
              ).length
            `);
            if (count > 1) return false;
          }
          // text: generic text match — very likely to match many elements
          if (locator.type === 'text') {
            const escapedTx = locator.value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            const count = await this.browserEngine.executeScript(`
              Array.from(document.querySelectorAll('*')).filter(
                el => el.children.length === 0 && el.textContent.trim() === '${escapedTx}'
              ).length
            `);
            if (count > 1) return false;
          }
          return true;
        }
      } catch (e) {
        // Continue waiting
      }

      await this._sleep(interval);
    }

    return false;
  }

  /**
   * Inject the visual cursor into the browser page (idempotent)
   */
  async _injectCursor() {
    try {
      await this.browserEngine.injectCursor();
      await this.browserEngine.executeScript('window.__testflow_cursor?.init()');
      await this.browserEngine.executeScript('window.__testflow_cursor?.show()');
    } catch (e) { /* page not ready */ }
  }

  /**
   * Tear down the visual cursor overlay
   */
  async _destroyCursor() {
    try {
      await this.browserEngine.executeScript('window.__testflow_cursor?.destroy()');
    } catch (e) { /* non-fatal */ }
  }

  /**
   * Re-inject cursor if the page navigated (cursor DOM lost)
   */
  async _ensureCursor() {
    try {
      const exists = await this.browserEngine.executeScript('!!window.__testflow_cursor');
      if (!exists) await this._injectCursor();
    } catch (e) {
      await this._injectCursor();
    }
  }

  /**
   * Perform the action on the element — WITH visual cursor animation
   */
  async _performAction(step, locator) {
    const locatorJs = this._buildLocatorJs(locator);

    // Make sure cursor is present (page may have reloaded)
    await this._ensureCursor();

    switch (step.type) {
      case 'click': {
        // Check if the target is a <select> — skip the click because the native
        // OS dropdown blocks all JS execution. The subsequent 'select' step
        // handles the value change programmatically.
        const tagCheck = await this.browserEngine.executeScript(`
          (() => {
            const el = ${locatorJs};
            if (!el) return 'missing';
            return el.tagName ? el.tagName.toLowerCase() : 'unknown';
          })()
        `);
        if (tagCheck === 'select') {
          // Just focus it instead of clicking (avoids native dropdown)
          await this._visualMoveAndHighlight(locatorJs, 'select dropdown');
          await this.browserEngine.executeScript(`
            (() => { const el = ${locatorJs}; if (el) el.focus(); })()
          `);
          await this._sleep(200);
          await this._visualCleanup();
          break;
        }

        // React-select: detect if the clicked element is a react-select
        // container/placeholder (needs focus+ArrowDown to open the dropdown)
        // vs. an option element (needs a normal click to select the value).
        const rsClickType = await this.browserEngine.executeScript(`
          (() => {
            let el = ${locatorJs};
            if (!el) return 'normal';
            // If the element itself IS a react-select option, use normal click
            const elId = el.id || '';
            if (/^react-select-\\d+-option-/.test(elId)) return 'option';
            // Also check class names for option elements
            const cls = el.className || '';
            if (typeof cls === 'string' && cls.includes('-option')) return 'option';
            // Walk up looking for a react-select container
            let node = el;
            while (node && node !== document.body) {
              const input = node.querySelector('input[id^="react-select-"]');
              if (input) return input.id;
              node = node.parentElement;
            }
            return 'normal';
          })()
        `);
        if (rsClickType !== 'normal' && rsClickType !== 'option') {
          // This is a react-select container/placeholder click — open the dropdown
          await this._visualMoveAndHighlight(locatorJs, 'click');
          await this._visualClickRipple();
          await this.browserEngine.executeScript(`
            (() => {
              const input = document.getElementById('${rsClickType}');
              if (!input) return;
              input.focus();
              input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40, bubbles: true }));
            })()
          `);
          await this._sleep(400);
          await this._visualCleanup();
        } else if (rsClickType === 'option') {
          // React-select option — just click it directly using the recorded
          // locator. The dropdown should already be open from the prior
          // container click step.
          await this._visualClick(locatorJs, 'click');
        } else {
          // Normal click (including react-select options which need click to select)
          await this._visualClick(locatorJs, 'click');
        }
        break;
      }

      case 'toggle':
      case 'check': {
        const cbVal = Object.values(step.testData || {})[0];
        if (typeof cbVal === 'boolean') {
          // Move cursor, highlight, click only if state differs
          await this._visualMoveAndHighlight(locatorJs, cbVal ? 'check ✓' : 'uncheck ✗');
          await this.browserEngine.executeScript(`
            (() => {
              const el = ${locatorJs};
              if (!el) return;
              if (el.checked === ${cbVal}) return; // Already in desired state
              // If the input is hidden (e.g. custom-control-input), click
              // its associated <label> instead so the browser registers it.
              const rect = el.getBoundingClientRect();
              const style = window.getComputedStyle(el);
              const isHidden = rect.width === 0 || rect.height === 0 ||
                               style.opacity === '0' || style.visibility === 'hidden' ||
                               style.display === 'none' || style.position === 'absolute';
              if (isHidden && el.id) {
                const label = document.querySelector('label[for="' + el.id + '"]');
                if (label) { label.click(); return; }
              }
              el.click();
            })()
          `);
          await this._visualClickRipple();
          await this._visualCleanup();
        } else {
          await this._visualClick(locatorJs, 'check');
        }
        break;
      }

      case 'radio': {
        const radioVal  = Object.values(step.testData || {})[0];
        const radioName = step.element?.name;
        if (radioName && radioVal != null) {
          const eName = String(radioName).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
          const eVal  = String(radioVal).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
          // Find the radio input, then click its label if the input is hidden
          const radioLocator = `(document.querySelector('input[type="radio"][name="${eName}"][value="${eVal}"]') || ${locatorJs})`;
          await this._visualMoveAndHighlight(radioLocator, `select: ${radioVal}`);
          await this._visualClickRipple();
          await this.browserEngine.executeScript(`
            (() => {
              const el = ${radioLocator};
              if (!el) return;
              // If the radio input is hidden, click the associated label
              const rect = el.getBoundingClientRect();
              const style = window.getComputedStyle(el);
              const isHidden = rect.width === 0 || rect.height === 0 ||
                               style.opacity === '0' || style.visibility === 'hidden' ||
                               style.display === 'none' || style.position === 'absolute';
              if (isHidden && el.id) {
                const label = document.querySelector('label[for="' + el.id + '"]');
                if (label) { label.click(); return; }
              }
              el.click();
            })()
          `);
          await this._sleep(120);
          await this._visualCleanup();
        } else {
          await this._visualClick(locatorJs, 'radio');
        }
        break;
      }

      case 'input':
      case 'type': {
        const value = Object.values(step.testData || {})[0] || '';
        const escaped = String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        // Move cursor to field, highlight, then type character-by-character
        await this._visualMoveAndHighlight(locatorJs, `type: "${value.length > 20 ? value.slice(0, 17) + '…' : value}"`);
        await this._visualClickRipple();
        // Typing effect (char by char in the injected page)
        await this.browserEngine.executeScript(`
          window.__testflow_cursor?.typeEffect(${JSON.stringify(locatorJs)}, '${escaped}', ${Math.min(value.length * 55, 1800)})
        `);
        await this._sleep(200);
        await this._visualCleanup();
        break;
      }

      case 'select': {
        const value = Object.values(step.testData || {})[0] || '';
        const escaped = String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const lowerEscaped = String(value).toLowerCase().replace(/\\/g, '\\\\').replace(/'/g, "\\'");

        await this._visualMoveAndHighlight(locatorJs, `select: "${value}"`);
        await this._visualClickRipple();
        // Perform the actual selection with multi-strategy matching:
        //   1. Exact value-attribute match
        //   2. Exact display-text match
        //   3. Case-insensitive value-attribute match
        //   4. Case-insensitive display-text match
        //   5. Partial / contains match (for long option text)
        // Uses the native value setter + React's change handler to ensure
        // React-controlled <select> elements (e.g. datepicker month/year) update.
        const selectOk = await this.browserEngine.executeScript(`
          (() => {
            const el = ${locatorJs};
            if (!el) return 'not-found';
            el.focus();
            if (el.tagName && el.tagName.toLowerCase() === 'select' && el.options) {
              const prev = el.value;
              const opts = Array.from(el.options);
              const target = '${escaped}';
              const targetLower = '${lowerEscaped}';
              let matched = null;
              // 1. Exact value-attribute match
              matched = opts.find(o => o.value === target);
              // 2. Exact display-text match
              if (!matched) matched = opts.find(o => o.text.trim() === target || o.textContent.trim() === target);
              // 3. Case-insensitive value match
              if (!matched) matched = opts.find(o => o.value.toLowerCase() === targetLower);
              // 4. Case-insensitive text match
              if (!matched) matched = opts.find(o => o.text.trim().toLowerCase() === targetLower || o.textContent.trim().toLowerCase() === targetLower);
              // 5. Partial / contains match (for long option texts)
              if (!matched && target.length > 2) matched = opts.find(o => o.text.trim().toLowerCase().includes(targetLower) || o.value.toLowerCase().includes(targetLower));
              if (matched) {
                el.value = matched.value;
              } else {
                // Last resort — set value directly
                el.value = target;
              }
              // Use native setter to trigger React's synthetic onChange
              const nativeSetter = Object.getOwnPropertyDescriptor(
                window.HTMLSelectElement.prototype, 'value')?.set;
              if (nativeSetter) nativeSetter.call(el, el.value);
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return matched ? 'ok' : (el.value !== prev ? 'ok' : 'no-match');
            } else {
              el.value = '${escaped}';
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return 'ok';
            }
          })()
        `);
        if (selectOk === 'not-found') throw new Error('Select element not found during action');
        if (selectOk === 'no-match') throw new Error(`Failed to select "${value}" — no matching option`);
        await this._sleep(500);
        await this._visualCleanup();
        break;
      }

      case 'slider': {
        const value = Object.values(step.testData || {})[0] || 0;
        await this._visualMoveAndHighlight(locatorJs, `slide → ${value}`);
        await this._visualClickRipple();
        await this.browserEngine.executeScript(`
          (() => {
            const el = ${locatorJs};
            if (el) {
              const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
              if (nativeSetter) nativeSetter.call(el, ${value});
              else el.value = ${value};
              el.dispatchEvent(new Event('input', {bubbles:true}));
              el.dispatchEvent(new Event('change', {bubbles:true}));
            }
          })()
        `);
        await this._sleep(200);
        await this._visualCleanup();
        break;
      }

      case 'submit':
        await this._visualMoveAndHighlight(locatorJs, 'submit');
        await this._visualClickRipple();
        await this.browserEngine.executeScript(`
          (() => {
            const el = ${locatorJs};
            if (el) {
              const form = el.closest('form') || el;
              if (form.submit) form.submit();
              else el.click();
            }
          })()
        `);
        await this._visualCleanup();
        break;

      case 'scroll': {
        const scrollVal = Object.values(step.testData || {})[0];
        const scrollY = parseInt(scrollVal, 10) || 0;
        await this.browserEngine.executeScript(`
          window.__testflow_cursor?.showTooltip('scroll → y=${scrollY}');
        `);
        await this._sleep(200);
        await this.browserEngine.executeScript(`window.scrollTo(0, ${scrollY})`);
        await this._sleep(300);
        await this.browserEngine.executeScript(`
          window.__testflow_cursor?.hideTooltip();
        `);
        break;
      }

      case 'change': {
        const value = Object.values(step.testData || {})[0] || '';
        const escaped = String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        await this._visualMoveAndHighlight(locatorJs, `set: "${value}"`);
        await this._visualClickRipple();
        await this.browserEngine.executeScript(`
          (() => {
            const el = ${locatorJs};
            if (!el) return;
            const tag = (el.tagName || '').toLowerCase();
            const nativeSetter = tag === 'textarea'
              ? Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
              : Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
            if (nativeSetter) nativeSetter.call(el, '${escaped}');
            else el.value = '${escaped}';
            const tracker = el._valueTracker;
            if (tracker) tracker.setValue('');
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          })()
        `);
        await this._sleep(200);
        await this._visualCleanup();
        break;
      }

      // ─── Date/Time/DateTime Setting ──────────────────────────
      // Programmatic value setting with React state synchronization.
      // Records VALUE not click sequences — handles native, react-datepicker,
      // MUI, Ant Design, Chakra UI, PrimeReact, Flatpickr, and generic calendars.
      case 'set_date':
      case 'set_time':
      case 'set_datetime': {
        // Get the ISO value (primary test data value), skipping __meta keys
        const tdEntries = Object.entries(step.testData || {});
        const dataEntry = tdEntries.find(([k]) => !k.endsWith('__meta'));
        const isoValue = dataEntry ? String(dataEntry[1]) : '';
        const meta = tdEntries.find(([k]) => k.endsWith('__meta'));
        const metaObj = meta ? meta[1] : {};
        const framework = metaObj.framework || step.framework || 'native';
        const displayVal = isoValue.length > 16 ? isoValue.slice(0, 16) : isoValue;
        const actionLabel = step.type === 'set_time' ? 'time' : step.type === 'set_datetime' ? 'date/time' : 'date';
        const escaped = isoValue.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

        await this._visualMoveAndHighlight(locatorJs, `set ${actionLabel}: "${displayVal}"`);
        await this._visualClickRipple();

        // Programmatic value setting with full React event dispatch
        const setResult = await this.browserEngine.executeScript(`
          (() => {
            const el = ${locatorJs};
            if (!el) return 'not-found';
            const tag = (el.tagName || '').toLowerCase();
            const type = (el.type || '').toLowerCase();
            const value = '${escaped}';
            const framework = '${framework}';

            // ─── Strategy 1: Native date/time/datetime-local inputs ───
            if (tag === 'input' && ['date','time','datetime-local','month','week'].includes(type)) {
              // Use native setter to bypass React's controlled component guard
              const nativeSetter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype, 'value')?.set;
              if (nativeSetter) nativeSetter.call(el, value);
              else el.value = value;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return 'ok-native';
            }

            // ─── Strategy 2: React-controlled text input (frameworks) ──
            // Most date picker libraries render a text input with type="text"
            // and manage the value through React state.

            // Focus the input first
            if (typeof el.focus === 'function') el.focus();

            // Clear current value
            const nativeSetter = Object.getOwnPropertyDescriptor(
              window.HTMLInputElement.prototype, 'value')?.set ||
              Object.getOwnPropertyDescriptor(
              window.HTMLTextAreaElement.prototype, 'value')?.set;

            if (nativeSetter) {
              nativeSetter.call(el, '');
              el.dispatchEvent(new Event('input', { bubbles: true }));
            }

            // Set the new value via native setter (React intercepts this)
            if (nativeSetter) {
              nativeSetter.call(el, value);
            } else {
              el.value = value;
            }

            // Dispatch the full event sequence that React listens for
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));

            // For React 16+: trigger the synthetic event system
            // React uses a custom event property tracker
            const tracker = el._valueTracker;
            if (tracker) {
              tracker.setValue('');  // Force React to see a change
            }
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));

            // ─── Framework-specific post-processing ─────────────
            if (framework === 'react-datepicker') {
              // react-datepicker may need Enter or Tab to confirm
              el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
            } else if (framework === 'antd') {
              // Ant Design may need Enter to confirm selection
              el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
            } else if (framework === 'flatpickr') {
              // Flatpickr: programmatic API if available
              if (el._flatpickr) {
                try { el._flatpickr.setDate(value, true); return 'ok-flatpickr-api'; }
                catch(e) {}
              }
            }

            // Blur to trigger validation / close popups
            el.dispatchEvent(new Event('blur', { bubbles: true }));

            return 'ok-framework';
          })()
        `);

        if (setResult === 'not-found') throw new Error(`${actionLabel} element not found during action`);

        // Wait for framework to process the value change and close any popup
        await this._sleep(500);

        // Verify the value was set correctly (non-fatal check)
        const verifyOk = await this.browserEngine.executeScript(`
          (() => {
            const el = ${locatorJs};
            if (!el) return false;
            const current = el.value || '';
            const expected = '${escaped}';
            // Exact match or contains (some frameworks reformat)
            return current === expected || current.includes(expected) || expected.includes(current);
          })()
        `);
        if (!verifyOk) {
          // Try a secondary strategy: click to open popup, then re-set
          await this.browserEngine.executeScript(`
            (() => {
              const el = ${locatorJs};
              if (!el) return;
              el.click();
            })()
          `);
          await this._sleep(500);
          await this.browserEngine.executeScript(`
            (() => {
              const el = ${locatorJs};
              if (!el) return;
              const nativeSetter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype, 'value')?.set;
              if (nativeSetter) nativeSetter.call(el, '${escaped}');
              else el.value = '${escaped}';
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              const tracker = el._valueTracker;
              if (tracker) tracker.setValue('');
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
              el.dispatchEvent(new Event('blur', { bubbles: true }));
            })()
          `);
          await this._sleep(300);
        }

        await this._visualCleanup();
        break;
      }

      // Handle navigate type within a step (mid-flow navigation)
      case 'navigate': {
        const url = step.testData?.url || step.url;
        await this.browserEngine.executeScript(`
          window.__testflow_cursor?.showTooltip('navigate → ${(url || '').replace(/'/g, "\\'")}');
        `);
        await this._sleep(400);
        await this.browserEngine.navigate(url);
        await this._wait(step.wait);
        await this._injectCursor();
        break;
      }

      case 'hover':
        await this._visualMoveAndHighlight(locatorJs, 'hover');
        await this._sleep(800);
        await this.browserEngine.executeScript(`
          (() => { const el = ${locatorJs}; if (el) {
            el.dispatchEvent(new MouseEvent('mouseenter', {bubbles:true}));
            el.dispatchEvent(new MouseEvent('mouseover', {bubbles:true}));
          }})()
        `);
        await this._sleep(400);
        await this.browserEngine.executeScript(`
          (() => { const el = ${locatorJs}; if (el) {
            el.dispatchEvent(new MouseEvent('mouseleave', {bubbles:true}));
            el.dispatchEvent(new MouseEvent('mouseout', {bubbles:true}));
          }})()
        `);
        await this._visualCleanup();
        break;

      case 'drag': {
        await this._visualMoveAndHighlight(locatorJs, 'drag start');
        await this._visualClickRipple();

        // Use the RECORDED pixel coordinates for the drag.
        // Element-based lookup fails because the source and drop target
        // often resolve to the same element (the source IS at the drop location).
        // Falling back to recorded dragStartX/Y → dragEndX/Y is reliable.
        let sx = step.dragStartX;
        let sy = step.dragStartY;
        let dx = step.dragEndX;
        let dy = step.dragEndY;

        // If no recorded coordinates, fall back to element bounding rects
        if (sx == null || sy == null || dx == null || dy == null) {
          let dropLocatorJs = null;
          if (step.dropTarget) {
            const dt = step.dropTarget;
            if (dt.id) {
              dropLocatorJs = `document.getElementById('${dt.id.replace(/'/g, "\\'")}')`;
            } else if (dt.text) {
              dropLocatorJs = `Array.from(document.querySelectorAll('${dt.tag || '*'}')).find(el => el.textContent.trim() === '${(dt.text || '').replace(/'/g, "\\'")}')`;
            }
          }
          const fallback = await this.browserEngine.executeScript(`
            (() => {
              const src = ${locatorJs};
              const dst = ${dropLocatorJs || locatorJs};
              if (!src) return null;
              const sr = src.getBoundingClientRect();
              const dr = dst ? dst.getBoundingClientRect() : sr;
              return {
                sx: Math.round(sr.left + sr.width / 2),
                sy: Math.round(sr.top + sr.height / 2),
                dx: Math.round(dr.left + dr.width / 2),
                dy: Math.round(dr.top + dr.height / 2),
              };
            })()
          `);
          if (fallback) { sx = fallback.sx; sy = fallback.sy; dx = fallback.dx; dy = fallback.dy; }
        } else {
          // Recorded coords are viewport-relative at record time.
          // The element may have shifted, so re-anchor the START coords to the
          // element's current position and compute a delta-based target.
          const anchor = await this.browserEngine.executeScript(`
            (() => {
              const el = ${locatorJs};
              if (!el) return null;
              const r = el.getBoundingClientRect();
              return { cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2) };
            })()
          `);
          if (anchor) {
            const deltaX = dx - sx;
            const deltaY = dy - sy;
            sx = anchor.cx;
            sy = anchor.cy;
            dx = sx + deltaX;
            dy = sy + deltaY;
          }
        }

        if (sx != null && sy != null && dx != null && dy != null) {
          // Focus the BrowserView so it receives input
          this.browserEngine.focusView();
          await this._sleep(100);

          // 1. Mouse down at source
          this.browserEngine.sendNativeInputEvent({
            type: 'mouseDown', x: sx, y: sy,
            button: 'left', clickCount: 1,
          });
          await this._sleep(400); // Long press for react-beautiful-dnd

          // 2. Initial nudge (small moves to trigger drag detection)
          for (let n = 1; n <= 5; n++) {
            this.browserEngine.sendNativeInputEvent({
              type: 'mouseMove', x: sx, y: sy + n * 2,
              modifiers: ['leftButtonDown'],
            });
            await this._sleep(20);
          }
          await this._sleep(100);

          // 3. Move from source to target
          const moveSteps = 20;
          for (let i = 1; i <= moveSteps; i++) {
            const frac = i / moveSteps;
            const mx = Math.round(sx + (dx - sx) * frac);
            const my = Math.round(sy + (dy - sy) * frac);
            this.browserEngine.sendNativeInputEvent({
              type: 'mouseMove', x: mx, y: my,
              modifiers: ['leftButtonDown'],
            });
            await this._sleep(20);
          }
          await this._sleep(200);

          // 4. Mouse up at target
          this.browserEngine.sendNativeInputEvent({
            type: 'mouseUp', x: dx, y: dy,
            button: 'left', clickCount: 1,
          });
        }

        await this.browserEngine.executeScript(`
          window.__testflow_cursor?.showTooltip('drag \u2192 drop')
        `);
        await this._sleep(600);
        await this._visualCleanup();
        break;
      }

      case 'modal':
        await this.browserEngine.executeScript(`
          window.__testflow_cursor?.showTooltip('waiting for modal\u2026')
        `);
        await this._sleep(1000);
        await this._visualCleanup();
        break;

      case 'alert': {
        const dialogType = step.testData?.dialog_type || 'alert';
        const dialogMsg = step.testData?.dialog_message || '';
        const msgShort = dialogMsg.length > 40 ? dialogMsg.substring(0, 37) + '...' : dialogMsg;
        await this.browserEngine.executeScript(`
          window.__testflow_cursor?.showTooltip('${dialogType}: "${msgShort.replace(/'/g, "\\'")}"  ✓ auto-accepted')
        `);
        // Dialog overrides are already injected — they auto-accept.
        // Just show visual feedback and continue.
        await this._sleep(800);
        await this._visualCleanup();
        break;
      }

      default:
        await this._visualClick(locatorJs, step.type || 'action');
    }
  }

  // ─── Visual helpers ─────────────────────────────────────────

  /**
   * Full visual click sequence: move → highlight → tooltip → ripple → click → cleanup
   */
  async _visualClick(locatorJs, label) {
    await this._visualMoveAndHighlight(locatorJs, label);
    await this._visualClickRipple();
    // Perform the actual click with full pointer/mouse event sequence.
    // First scroll into view and verify the target element is actually at
    // the click coordinates (not obscured by another element / dropdown).
    await this.browserEngine.executeScript(`
      (() => {
        const el = ${locatorJs};
        if (!el) return;
        el.scrollIntoView({block:'center', behavior:'instant'});
        if (typeof el.focus === 'function') el.focus();
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        // Verify this element (or a descendant) is at the click point
        const atPoint = document.elementFromPoint(cx, cy);
        const clickTarget = (atPoint && (el === atPoint || el.contains(atPoint))) ? el : (atPoint || el);
        // If the element at the point is NOT our target, try to click our
        // target directly anyway (it may be partially obscured but still
        // clickable via .click())
        const target = (atPoint && el !== atPoint && !el.contains(atPoint)) ? el : clickTarget;
        const tr = target.getBoundingClientRect();
        const tcx = tr.left + tr.width / 2;
        const tcy = tr.top + tr.height / 2;
        const opts = { bubbles:true, cancelable:true, view:window, clientX:tcx, clientY:tcy, button:0 };
        target.dispatchEvent(new PointerEvent('pointerdown', opts));
        target.dispatchEvent(new MouseEvent('mousedown', opts));
        target.dispatchEvent(new PointerEvent('pointerup', opts));
        target.dispatchEvent(new MouseEvent('mouseup', opts));
        target.click();
      })()
    `);
    await this._sleep(120);
    await this._visualCleanup();
  }

  /**
   * Move cursor to element and show highlight + tooltip
   */
  async _visualMoveAndHighlight(locatorJs, label) {
    try {
      // Scroll into view
      await this.browserEngine.executeScript(`
        (() => { const el = ${locatorJs}; if (el) el.scrollIntoView({block:'center', behavior:'smooth'}); })()
      `);
      await this._sleep(250);

      // Move cursor
      await this.browserEngine.executeScript(`
        window.__testflow_cursor?.moveToElement(${JSON.stringify(locatorJs)}, 400)
      `);
      await this._sleep(450);

      // Highlight the target element
      await this.browserEngine.executeScript(`
        window.__testflow_cursor?.highlightElement(${JSON.stringify(locatorJs)})
      `);

      // Show tooltip
      if (label) {
        await this.browserEngine.executeScript(`
          window.__testflow_cursor?.showTooltip(${JSON.stringify(label)})
        `);
      }
      await this._sleep(200);
    } catch (e) { /* non-fatal visual issue */ }
  }

  /**
   * Play the click ripple effect
   */
  async _visualClickRipple() {
    try {
      await this.browserEngine.executeScript(`window.__testflow_cursor?.click()`);
      await this._sleep(300);
    } catch (e) { /* non-fatal */ }
  }

  /**
   * Hide highlight + tooltip after action completes
   */
  async _visualCleanup() {
    try {
      await this.browserEngine.executeScript(`
        window.__testflow_cursor?.hideHighlight();
        window.__testflow_cursor?.hideTooltip();
      `);
    } catch (e) { /* non-fatal */ }
  }

  /**
   * Build JavaScript expression to locate an element
   */
  _buildLocatorJs(locator) {
    const escaped = locator.value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    switch (locator.type) {
      case 'id':
        return `document.getElementById('${escaped}')`;
      case 'css':
        return `document.querySelector('${escaped}')`;
      case 'xpath':
        return `document.evaluate('${escaped}', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue`;
      case 'name':
        return `document.querySelector('[name="${escaped}"]')`;
      case 'role':
        return `document.querySelector('[role="${escaped}"]')`;
      case 'aria-label':
        return `document.querySelector('[aria-label="${escaped}"]')`;
      case 'linkText':
        return `Array.from(document.querySelectorAll('a')).find(el => el.textContent.trim() === '${escaped}')`;
      case 'buttonText':
        return `Array.from(document.querySelectorAll('button,[role="button"]')).find(el => el.textContent.trim() === '${escaped}')`;
      case 'nthButtonText': {
        const idx = locator.index || 0;
        return `Array.from(document.querySelectorAll('button,[role="button"]')).filter(el => el.textContent.trim() === '${escaped}')[${idx}]`;
      }
      case 'nthLinkText': {
        const idx = locator.index || 0;
        return `Array.from(document.querySelectorAll('a')).filter(el => el.textContent.trim() === '${escaped}')[${idx}]`;
      }
      case 'text':
        return `Array.from(document.querySelectorAll('*')).find(el => el.children.length === 0 && el.textContent.trim() === '${escaped}')`;
      default:
        return `document.querySelector('${escaped}')`;
    }
  }

  /**
   * Wait implementation based on wait config
   */
  async _wait(waitConfig) {
    if (!waitConfig) return;

    switch (waitConfig.type) {
      case 'networkIdle':
        await this._sleep(2000); // Simplified: wait for network to settle
        break;
      case 'navigation':
        await this._sleep(1500);
        break;
      default:
        await this._sleep(300);
    }
  }

  /**
   * Build a step result object
   */
  _buildResult(step, status, diagnostics, error = null) {
    return {
      stepId: step.id,
      stepType: step.type,
      description: step.description,
      status,
      diagnostics,
      error,
      timestamp: Date.now(),
    };
  }

  /**
   * Recovery helper: if a step targets a react-select dropdown option that is
   * not in the DOM (dropdown closed by scroll / blur), re-open the parent
   * dropdown container so the option becomes available again.
   */
  async _tryRecoverReactSelect(step) {
    const locators = step.locators || [];
    // Check if any locator has a react-select option ID pattern
    const rsLocator = locators.find(
      l => l.type === 'id' && /^react-select-\d+-option-\d+$/.test(l.value)
    );
    if (!rsLocator) return false;

    const match = rsLocator.value.match(/^react-select-(\d+)-option-/);
    if (!match) return false;

    const selectNum = match[1];
    try {
      // Focus the hidden input and press ArrowDown to open the menu.
      // This is the most reliable way — react-select explicitly handles
      // onKeyDown for ArrowDown and opens the menu.
      const opened = await this.browserEngine.executeScript(`
        (() => {
          const input = document.getElementById('react-select-${selectNum}-input');
          if (!input) return false;
          input.focus();
          input.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'ArrowDown', keyCode: 40, bubbles: true
          }));
          return true;
        })()
      `);
      if (opened) {
        await this._sleep(800); // Wait for dropdown menu to render
        return true;
      }
    } catch (e) { /* non-fatal */ }
    return false;
  }

  /**
   * Capture a screenshot if the corresponding config flag is enabled.
   * @param {string} screenshotId  – unique id for the screenshot
   * @param {string} trigger       – config key: afterEachStep | afterFailure | beforeEachStep | afterEachTestCase
   */
  async _captureScreenshot(screenshotId, trigger) {
    try {
      const cfg = this.reportConfig?.get?.()?.screenshot;
      if (!cfg) return;

      const shouldCapture =
        (trigger === 'afterEachStep'     && cfg.afterEachStep) ||
        (trigger === 'afterFailure'      && cfg.afterFailure) ||
        (trigger === 'beforeEachStep'    && cfg.beforeEachStep) ||
        (trigger === 'afterEachTestCase' && cfg.afterEachTestCase);

      if (!shouldCapture) return;

      const buffer = await this.browserEngine.captureScreenshot();
      this.screenshots[screenshotId] = {
        buffer,
        base64: buffer.toString('base64'),
      };
    } catch (err) {
      // Screenshot failure must never stop replay
      console.warn('[ReplayEngine] Screenshot capture failed:', err.message);
    }
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Replay from a test case JSON (with top-level testData map).
   * Converts the testCase steps back into a flow-like structure using the
   * editable testData map, then runs the standard replay pipeline.
   */
  async replayTestCase(testCase) {
    if (!testCase || !testCase.steps) {
      return { success: false, message: 'Invalid test case' };
    }

    const tdMap  = testCase.testData     || {};
    const tdMeta = testCase.testDataMeta || {};

    // Convert test case back to a flow object
    const flow = {
      id: testCase.id,
      name: testCase.name,
      startUrl: testCase.startUrl,
      steps: testCase.steps.map((tc, i) => {
        const step = {
          id: `tc-step-${i}`,
          type: tc.action,
          action: tc.action,
          description: tc.description || '',
          locators: tc.allLocators || (tc.locator ? [tc.locator] : []),
          wait: tc.waitCondition || null,
          enabled: true,
        };

        // New format: look up value from top-level testData via testDataKey
        if (tc.testDataKey && tc.testDataKey in tdMap) {
          const value = tdMap[tc.testDataKey];
          const meta  = tdMeta[tc.testDataKey] || {};
          step.testData = { [tc.testDataKey]: value };
          step.value    = value;
          const ct = meta.controlType || meta.type || 'text';
          step.element  = {
            name: meta.elementName || tc.testDataKey,
            type: ct,
            id:   meta.elementId || '',
            // Infer tag from controlType so _performAction routes correctly
            tag: ct === 'select' || ct === 'combobox' || ct === 'listbox' ? 'select' : '',
          };

          // v3: for date/time actions, include the __meta in testData
          // so the replay handler can access framework info
          if (['set_date', 'set_time', 'set_datetime'].includes(step.type)) {
            if (meta.framework || meta.controlSubType || meta.isoValue) {
              step.testData[tc.testDataKey + '__meta'] = {
                isoValue: meta.isoValue || '',
                displayFormat: meta.displayFormat || '',
                timezone: meta.timezone || '',
                framework: meta.framework || 'native',
                controlSubType: meta.controlSubType || 'native',
              };
            }
            step.framework = meta.framework || 'native';
          }
        }
        // Legacy support: old-style per-step testData {field, value, type}
        else if (tc.testData) {
          step.testData = { [tc.testData.field || 'value']: tc.testData.value };
          step.value    = tc.testData.value;
          step.element  = { name: tc.testData.field, type: tc.testData.type };
        }

        if (tc.url) {
          step.url      = tc.url;
          step.testData = { url: tc.url };
        }

        return step;
      }),
    };

    return this.startReplay(flow);
  }
}

module.exports = { ReplayEngine };
