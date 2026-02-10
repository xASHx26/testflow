/**
 * TestFlow — Recorder Engine
 * 
 * Intent-based action recorder. Intercepts user actions in the embedded browser
 * and converts them to automation-ready step objects with locators and test data.
 */

const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');

class RecorderEngine extends EventEmitter {
  constructor(browserEngine, locatorEngine, flowEngine) {
    super();
    this.browserEngine = browserEngine;
    this.locatorEngine = locatorEngine;
    this.flowEngine = flowEngine;
    this.state = 'idle'; // idle | recording | paused
    this.currentFlowId = null;
    this.stepCounter = 0;
    this._actionHandler = null;
    this.startUrl = null; // URL when recording began
  }

  /**
   * Start recording user actions
   */
  async startRecording(flowId) {
    if (this.state === 'recording') return { success: false, message: 'Already recording' };

    // Capture the current URL as the starting point for replay
    this.startUrl = this.browserEngine.getCurrentUrl() || '';

    this.currentFlowId = flowId || this.flowEngine.getActiveFlowId();
    if (!this.currentFlowId) {
      // Auto-create a flow
      const flow = this.flowEngine.createFlow('Untitled Recording');
      this.currentFlowId = flow.id;
    }

    // Store the startUrl in the flow
    const flow = this.flowEngine.getFlow(this.currentFlowId);
    if (flow) {
      flow.startUrl = this.startUrl;
      flow.metadata = flow.metadata || {};
      flow.metadata.startUrl = this.startUrl;
    }

    this.stepCounter = 0;
    this.state = 'recording';

    // Inject recorder script into the embedded browser
    await this.browserEngine.injectRecorder();
    await this.browserEngine.executeScript('window.__testflow_recorder?.start()');

    // Listen for actions from the injected script
    this._setupActionListener();

    this.emit('state-changed', this.state);
    return { success: true, flowId: this.currentFlowId, state: this.state };
  }

  /**
   * Stop recording — navigate back to startUrl and generate test case
   */
  async stopRecording() {
    if (this.state === 'idle') return { success: false, message: 'Not recording' };

    await this.browserEngine.executeScript('window.__testflow_recorder?.stop()');
    this._teardownActionListener();

    this.state = 'idle';
    const flowId = this.currentFlowId;
    this.currentFlowId = null;

    // Get the recorded flow and generate a test case
    const flow = this.flowEngine.getFlow(flowId);
    const testCase = flow ? this._generateTestCase(flow) : null;

    // Navigate back to the start URL so the user sees the initial state
    if (this.startUrl) {
      try {
        await this.browserEngine.navigate(this.startUrl);
      } catch (e) {
        // Non-fatal — continue
      }
    }

    this.emit('state-changed', this.state);
    return { success: true, flowId, state: this.state, testCase };
  }

  /**
   * Pause recording (stop capturing but keep context)
   */
  async pauseRecording() {
    if (this.state !== 'recording') return { success: false, message: 'Not recording' };

    await this.browserEngine.executeScript('window.__testflow_recorder?.pause()');
    this.state = 'paused';

    this.emit('state-changed', this.state);
    return { success: true, state: this.state };
  }

  /**
   * Resume recording after pause
   */
  async resumeRecording() {
    if (this.state !== 'paused') return { success: false, message: 'Not paused' };

    await this.browserEngine.executeScript('window.__testflow_recorder?.resume()');
    this.state = 'recording';

    this.emit('state-changed', this.state);
    return { success: true, state: this.state };
  }

  /**
   * Get current recorder state
   */
  getState() {
    return {
      state: this.state,
      flowId: this.currentFlowId,
      stepCount: this.stepCounter,
    };
  }

  /**
   * Process a raw action from the injected recorder and convert to a Step
   */
  _processAction(rawAction) {
    if (this.state !== 'recording') return null;

    this.stepCounter++;

    // Generate ranked locators for the element
    const locators = this.locatorEngine.generateLocators(rawAction.element);
    const rankedLocators = this.locatorEngine.rankLocators(locators);

    // Build the automation-ready step
    const step = {
      id: uuidv4(),
      order: this.stepCounter,
      type: this._classifyIntent(rawAction),
      action: rawAction.action,
      description: this._generateDescription(rawAction),
      timestamp: Date.now(),
      url: rawAction.url || '',
      element: {
        tag: rawAction.element?.tag || '',
        type: rawAction.element?.type || '',
        id: rawAction.element?.id || '',
        name: rawAction.element?.name || '',
        classes: rawAction.element?.classes || [],
        text: rawAction.element?.text || '',
        placeholder: rawAction.element?.placeholder || '',
        ariaLabel: rawAction.element?.ariaLabel || '',
        role: rawAction.element?.role || '',
        label: rawAction.element?.label || '',
        href: rawAction.element?.href || '',
        value: rawAction.element?.value || '',
      },
      locators: rankedLocators,
      testData: this._extractTestData(rawAction),
      wait: this._inferWait(rawAction),
      screenshot: null,
      enabled: true,
      group: null,
      notes: '',
    };

    // Add step to flow
    this.flowEngine.addStep(this.currentFlowId, step);

    this.emit('action-recorded', step);
    return step;
  }

  /**
   * Classify the user intent from a raw DOM action
   */
  _classifyIntent(rawAction) {
    const { action, element } = rawAction;
    const tag = (element?.tag || '').toLowerCase();
    const type = (element?.type || '').toLowerCase();

    if (action === 'navigate') return 'navigate';
    if (action === 'type' || action === 'input') return 'type';

    if (action === 'click') {
      if (tag === 'select' || element?.role === 'listbox') return 'select';
      if (tag === 'input' && type === 'checkbox') return 'check';
      if (tag === 'input' && type === 'radio') return 'radio';
      if (tag === 'input' && type === 'range') return 'slider';
      if (tag === 'button' || type === 'submit' || element?.role === 'button') return 'click';
      if (tag === 'a') return 'click';
      return 'click';
    }

    if (action === 'change') {
      if (tag === 'select') return 'select';
      if (tag === 'input' && type === 'checkbox') return 'check';
      if (tag === 'input' && type === 'radio') return 'radio';
      if (tag === 'input' && type === 'range') return 'slider';
      return 'change';
    }

    if (action === 'scroll') return 'scroll';
    if (action === 'hover') return 'hover';
    if (action === 'focus') return 'focus';
    if (action === 'submit') return 'submit';

    return 'unknown';
  }

  /**
   * Generate a human-readable description of the step
   */
  _generateDescription(rawAction) {
    const el = rawAction.element || {};
    const identifier = el.ariaLabel || el.label || el.placeholder || el.text || el.name || el.id || el.tag || 'element';
    const truncated = identifier.length > 50 ? identifier.substring(0, 47) + '...' : identifier;

    switch (rawAction.action) {
      case 'navigate':
        return `Navigate to ${rawAction.url || rawAction.value || ''}`;
      case 'click':
        return `Click on "${truncated}"`;
      case 'type':
      case 'input':
        return `Type "${rawAction.value || ''}" into "${truncated}"`;
      case 'change':
        if (el.type === 'checkbox') return `Toggle checkbox "${truncated}"`;
        if (el.type === 'radio') return `Select radio "${truncated}"`;
        if (el.tag === 'select') return `Select "${rawAction.value}" in "${truncated}"`;
        return `Change "${truncated}" to "${rawAction.value || ''}"`;
      case 'submit':
        return `Submit form "${truncated}"`;
      case 'scroll':
        return `Scroll page`;
      default:
        return `${rawAction.action} on "${truncated}"`;
    }
  }

  /**
   * Extract test data as key-value pairs from the action
   */
  _extractTestData(rawAction) {
    const el = rawAction.element || {};
    const key = el.name || el.ariaLabel || el.label || el.placeholder || el.id || `element_${this.stepCounter}`;
    const sanitizedKey = key.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();

    switch (rawAction.action) {
      case 'type':
      case 'input':
        return { [sanitizedKey]: rawAction.value || '' };
      case 'click':
        if (el.type === 'checkbox') return { [sanitizedKey]: !!rawAction.checked };
        if (el.type === 'radio') return { [sanitizedKey]: rawAction.value || true };
        return { [`btn_${sanitizedKey}`]: true };
      case 'change':
        if (el.tag === 'select') return { [sanitizedKey]: rawAction.value || '' };
        if (el.type === 'range') return { [sanitizedKey]: parseFloat(rawAction.value) || 0 };
        if (el.type === 'checkbox') return { [sanitizedKey]: !!rawAction.checked };
        return { [sanitizedKey]: rawAction.value || '' };
      case 'navigate':
        return { url: rawAction.url || rawAction.value || '' };
      default:
        return {};
    }
  }

  /**
   * Infer the appropriate wait strategy for a step
   */
  _inferWait(rawAction) {
    const el = rawAction.element || {};
    const tag = (el.tag || '').toLowerCase();

    // Clicks on submit buttons or links → wait for navigation
    if (rawAction.action === 'click') {
      if (el.type === 'submit' || tag === 'a' || el.role === 'link') {
        return { type: 'navigation', timeout: 10000 };
      }
      return { type: 'clickable', timeout: 5000 };
    }

    // Type actions → wait for element to be visible
    if (rawAction.action === 'type' || rawAction.action === 'input') {
      return { type: 'visible', timeout: 5000 };
    }

    // Select changes → wait for element to be interactable
    if (rawAction.action === 'change') {
      return { type: 'visible', timeout: 5000 };
    }

    // Navigation → wait for page load
    if (rawAction.action === 'navigate') {
      return { type: 'networkIdle', timeout: 15000 };
    }

    return { type: 'visible', timeout: 5000 };
  }

  /**
   * Setup listener for actions from the injected recorder script
   */
  _setupActionListener() {
    const webContents = this.browserEngine.getWebContents();
    if (!webContents) return;

    const { ipcMain } = require('electron');
    this._actionHandler = (event, rawAction) => {
      const step = this._processAction(rawAction);
      if (step) {
        // Forward to renderer
        this.browserEngine.mainWindow.webContents.send('recorder:action-recorded', step);
      }
    };

    ipcMain.on('recorder:raw-action', this._actionHandler);
  }

  /**
   * Teardown the action listener
   */
  _teardownActionListener() {
    if (this._actionHandler) {
      const { ipcMain } = require('electron');
      ipcMain.removeListener('recorder:raw-action', this._actionHandler);
      this._actionHandler = null;
    }
  }

  /**
   * Generate a test case JSON from a recorded flow
   */
  _generateTestCase(flow) {
    const testCase = {
      id: flow.id,
      name: flow.name || 'Untitled Test Case',
      startUrl: flow.startUrl || '',
      createdAt: new Date().toISOString(),
      status: 'recorded',
      steps: (flow.steps || []).map((step, index) => {
        const tc = {
          stepIndex: index,
          action: step.type || step.action,  // Use classified type (click/type/select etc.)
          description: step.description || '',
          locator: step.locators?.[0] || null,
          allLocators: step.locators || [],
          waitCondition: step.wait || null,
        };
        // Include test data for type/input actions
        if (step.action === 'type' || step.action === 'input') {
          tc.testData = {
            value: step.value || '',
            field: step.element?.name || step.element?.id || step.locators?.[0]?.value || 'unknown',
            type: step.element?.type || 'text',
          };
        }
        // Include value for select/change actions
        if (step.action === 'change' || step.action === 'select') {
          tc.testData = {
            value: step.value || '',
            field: step.element?.name || step.element?.id || 'unknown',
            type: 'select',
          };
        }
        // Include navigation URL
        if (step.action === 'navigate') {
          tc.url = step.url || '';
        }
        return tc;
      }),
    };
    return testCase;
  }
}

module.exports = { RecorderEngine };
