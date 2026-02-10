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
      // Navigate to the initial URL before replaying steps
      if (flow.startUrl) {
        this.emit('step-started', { stepId: '__navigate_start', index: -1, total: flow.steps.length, label: `Navigating to ${flow.startUrl}` });
        await this.browserEngine.navigate(flow.startUrl);
        // Wait for page to settle
        await this._sleep(1500);
        this.emit('step-completed', { stepId: '__navigate_start', index: -1, status: 'passed', label: `Navigated to start URL` });
      }

      await this._executeSteps();
    } catch (error) {
      this.emit('replay-error', { error: error.message });
    }

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
        if (found) return true;
      } catch (e) {
        // Continue waiting
      }

      await this._sleep(interval);
    }

    return false;
  }

  /**
   * Perform the action on the element
   */
  async _performAction(step, locator) {
    const locatorJs = this._buildLocatorJs(locator);

    switch (step.type) {
      case 'click':
        await this.browserEngine.executeScript(`
          (() => {
            const el = ${locatorJs};
            if (el) { el.scrollIntoView({block:'center'}); el.click(); }
          })()
        `);
        break;

      case 'check': {
        // If testData provides a boolean, set the checkbox to that state
        const cbVal = Object.values(step.testData || {})[0];
        if (typeof cbVal === 'boolean') {
          await this.browserEngine.executeScript(`
            (() => {
              const el = ${locatorJs};
              if (el) {
                el.scrollIntoView({block:'center'});
                if (el.checked !== ${cbVal}) el.click();
              }
            })()
          `);
        } else {
          await this.browserEngine.executeScript(`
            (() => { const el = ${locatorJs}; if (el) { el.scrollIntoView({block:'center'}); el.click(); } })()
          `);
        }
        break;
      }

      case 'radio': {
        // If testData provides a string value + element.name, click the matching radio
        const radioVal  = Object.values(step.testData || {})[0];
        const radioName = step.element?.name;
        if (radioName && radioVal != null) {
          const eName = String(radioName).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
          const eVal  = String(radioVal).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
          await this.browserEngine.executeScript(`
            (() => {
              let el = document.querySelector('input[type="radio"][name="${eName}"][value="${eVal}"]');
              if (!el) el = ${locatorJs};
              if (el) { el.scrollIntoView({block:'center'}); el.click(); }
            })()
          `);
        } else {
          await this.browserEngine.executeScript(`
            (() => { const el = ${locatorJs}; if (el) { el.scrollIntoView({block:'center'}); el.click(); } })()
          `);
        }
        break;
      }

      case 'type': {
        const value = Object.values(step.testData || {})[0] || '';
        const escaped = String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        await this.browserEngine.executeScript(`
          (() => {
            const el = ${locatorJs};
            if (el) {
              el.scrollIntoView({block:'center'});
              el.focus();
              el.value = '';
              const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
                || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
              if (nativeInputValueSetter) nativeInputValueSetter.call(el, '${escaped}');
              else el.value = '${escaped}';
              el.dispatchEvent(new Event('input', {bubbles:true}));
              el.dispatchEvent(new Event('change', {bubbles:true}));
            }
          })()
        `);
        break;
      }

      case 'select': {
        const value = Object.values(step.testData || {})[0] || '';
        const escaped = String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        await this.browserEngine.executeScript(`
          (() => {
            const el = ${locatorJs};
            if (el) {
              el.scrollIntoView({block:'center'});
              el.value = '${escaped}';
              el.dispatchEvent(new Event('change', {bubbles:true}));
            }
          })()
        `);
        break;
      }

      case 'slider': {
        const value = Object.values(step.testData || {})[0] || 0;
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
        break;
      }

      case 'submit':
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
        break;

      case 'scroll':
        await this.browserEngine.executeScript(`window.scrollBy(0, 300)`);
        break;

      default:
        await this.browserEngine.executeScript(`
          (() => { const el = ${locatorJs}; if (el) el.click(); })()
        `);
    }
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
            type: meta.type || 'text',
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
