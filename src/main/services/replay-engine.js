/**
 * TestFlow — Replay Engine
 * 
 * Replays recorded flows inside the embedded browser with locator fallback,
 * explicit waits, and per-step diagnostics.
 */

const EventEmitter = require('events');

class ReplayEngine extends EventEmitter {
  constructor(browserEngine, locatorEngine) {
    super();
    this.browserEngine = browserEngine;
    this.locatorEngine = locatorEngine;
    this.state = 'idle'; // idle | playing | paused | stepping
    this.currentFlow = null;
    this.currentStepIndex = -1;
    this.results = [];
    this.abortController = null;
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
    });

    return { success: true, results: this.results };
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

      const result = await this._executeStep(step);
      this.results.push(result);

      this.emit('step-complete', { ...result, index: i, total: steps.length });

      // Re-inject cursor after each step (in case the page navigated)
      await this._ensureCursor();

      // Brief pause between steps so the user can follow along
      await this._sleep(300);

      if (result.status === 'failed') {
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

      // Find the element using locator fallback
      const locatorResult = await this._findElement(step.locators, step.wait);
      diagnostics.locatorUsed = locatorResult.locator;
      diagnostics.locatorsFailed = locatorResult.failed;
      diagnostics.fallbackUsed = locatorResult.fallbackUsed;

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
          // For CSS selectors, verify uniqueness — if multiple elements match,
          // reject this locator so the fallback chain tries a more specific one.
          if (locator.type === 'css') {
            const escapedCss = locator.value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            const count = await this.browserEngine.executeScript(
              `document.querySelectorAll('${escapedCss}').length`
            );
            if (count > 1) {
              // Not unique — let the fallback chain try the next locator
              return false;
            }
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
      case 'click':
        await this._visualClick(locatorJs, 'click');
        break;

      case 'check': {
        const cbVal = Object.values(step.testData || {})[0];
        if (typeof cbVal === 'boolean') {
          // Move cursor, highlight, click only if state differs
          await this._visualMoveAndHighlight(locatorJs, cbVal ? 'check ✓' : 'uncheck ✗');
          await this.browserEngine.executeScript(`
            (() => {
              const el = ${locatorJs};
              if (el && el.checked !== ${cbVal}) el.click();
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
          const radioLocator = `(document.querySelector('input[type="radio"][name="${eName}"][value="${eVal}"]') || ${locatorJs})`;
          await this._visualClick(radioLocator, `select: ${radioVal}`);
        } else {
          await this._visualClick(locatorJs, 'radio');
        }
        break;
      }

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
        await this._visualMoveAndHighlight(locatorJs, `select: "${value}"`);
        await this._visualClickRipple();
        await this.browserEngine.executeScript(`
          window.__testflow_cursor?.selectEffect(${JSON.stringify(locatorJs)}, '${escaped}')
        `);
        await this._sleep(350);
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

      case 'scroll':
        await this.browserEngine.executeScript(`
          window.__testflow_cursor?.showTooltip('scroll ↓');
        `);
        await this._sleep(200);
        await this.browserEngine.executeScript(`window.scrollBy(0, 300)`);
        await this._sleep(300);
        await this.browserEngine.executeScript(`
          window.__testflow_cursor?.hideTooltip();
        `);
        break;

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
    // Perform the actual click
    await this.browserEngine.executeScript(`
      (() => { const el = ${locatorJs}; if (el) el.click(); })()
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
      case 'text':
        return `Array.from(document.querySelectorAll('*')).find(el => el.textContent.trim() === '${escaped}')`;
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
          step.element  = {
            name: meta.elementName || tc.testDataKey,
            type: meta.controlType || meta.type || 'text',
            id:   meta.elementId || '',
          };
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
