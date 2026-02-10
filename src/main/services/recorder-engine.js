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
      // v2: universal capture metadata
      interactionType: rawAction.interactionType || '',
      options: rawAction.options || null,
      valueBefore: rawAction.valueBefore ?? null,
      valueAfter: rawAction.valueAfter ?? null,
      dropTarget: rawAction.dropTarget || null,
      modalAction: rawAction.modalAction || null,
      scrollX: rawAction.scrollX ?? null,
      scrollY: rawAction.scrollY ?? null,
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
    const tag  = (element?.tag || '').toLowerCase();
    const type = (element?.type || '').toLowerCase();
    const ct   = (element?.controlType || '').toLowerCase();
    const it   = (rawAction.interactionType || '').toLowerCase();

    if (action === 'navigate') return 'navigate';

    // Text input (v2: 'input', legacy: 'type')
    if (action === 'input' || action === 'type') return 'input';

    // Direct select from change handler
    if (action === 'select') {
      if (it === 'radio') return 'radio';
      return 'select';
    }

    // Toggle (checkbox/switch)
    if (action === 'toggle') return 'toggle';

    if (action === 'click') {
      if (it === 'toggle' || it === 'checkbox') return 'toggle';
      if (it === 'radio') return 'radio';
      if (tag === 'select' || ct === 'select' || ct === 'combobox' || ct === 'listbox') return 'select';
      if (ct === 'checkbox' || (tag === 'input' && type === 'checkbox')) return 'toggle';
      if (ct === 'radio'    || (tag === 'input' && type === 'radio'))    return 'radio';
      if (ct === 'slider'   || (tag === 'input' && type === 'range'))    return 'slider';
      if (ct === 'toggle')  return 'toggle';
      return 'click';
    }

    if (action === 'change') {
      if (tag === 'select' || ct === 'select' || ct === 'combobox') return 'select';
      if (ct === 'checkbox' || ct === 'toggle' || (tag === 'input' && type === 'checkbox')) return 'toggle';
      if (ct === 'radio' || (tag === 'input' && type === 'radio')) return 'radio';
      if (ct === 'slider' || (tag === 'input' && type === 'range')) return 'slider';
      return 'change';
    }

    if (action === 'scroll') return 'scroll';
    if (action === 'hover')  return 'hover';
    if (action === 'drag')   return 'drag';
    if (action === 'modal')  return 'modal';
    if (action === 'submit') return 'submit';

    return 'click'; // fallback
  }

  /**
   * Generate a human-readable description of the step
   */
  _generateDescription(rawAction) {
    const el = rawAction.element || {};
    const ct = (el.controlType || '').toLowerCase();
    const identifier = el.ariaLabel || el.label || el.placeholder || el.text || el.name || el.id || el.tag || 'element';
    const truncated = identifier.length > 50 ? identifier.substring(0, 47) + '...' : identifier;

    switch (rawAction.action) {
      case 'navigate':
        return `Navigate to ${rawAction.url || rawAction.value || ''}`;
      case 'click':
        if (ct === 'toggle')   return `Toggle switch "${truncated}"`;
        if (ct === 'checkbox') return `Toggle checkbox "${truncated}"`;
        if (ct === 'radio')    return `Select radio "${truncated}"`;
        return `Click on "${truncated}"`;
      case 'type':
      case 'input':
        return `Type "${rawAction.value || ''}" into "${truncated}"`;
      case 'change':
        if (ct === 'select' || ct === 'combobox' || ct === 'listbox' || ct === 'multiselect')
          return `Select "${rawAction.value}" in "${truncated}"`;
        if (ct === 'checkbox' || ct === 'toggle')
          return `Toggle "${truncated}" ${rawAction.checked ? 'on' : 'off'}`;
        if (ct === 'radio') return `Select radio "${truncated}" → ${rawAction.value}`;
        if (ct === 'slider' || ct === 'range' || ct === 'rating')
          return `Set "${truncated}" to ${rawAction.value}`;
        if (ct === 'color') return `Pick color ${rawAction.value} for "${truncated}"`;
        if (ct === 'file')  return `Upload "${rawAction.value}" to "${truncated}"`;
        if (['date', 'time', 'datetime', 'month', 'week'].includes(ct))
          return `Set "${truncated}" to ${rawAction.value}`;
        return `Change "${truncated}" to "${rawAction.value || ''}"`;
      case 'submit':
        return `Submit form "${truncated}"`;
      case 'scroll':
        return `Scroll to y=${rawAction.scrollY || 0}`;
      case 'toggle':
        return `Toggle "${truncated}" ${rawAction.checked || rawAction.valueAfter ? 'on' : 'off'}`;
      case 'select':
        if (rawAction.interactionType === 'radio')
          return `Select radio "${truncated}" \u2192 ${rawAction.value}`;
        return `Select "${rawAction.selectedText || rawAction.value || ''}" in "${truncated}"`;
      case 'hover':
        return `Hover over "${truncated}"`;
      case 'drag':
        return `Drag "${truncated}" to target`;
      case 'modal':
        return `Modal ${rawAction.modalAction || 'detected'}: "${truncated}"`;
      default:
        return `${rawAction.action} on "${truncated}"`;
    }
  }

  /**
   * Extract test data as a simple key→value pair.
   *
   * Every interaction that carries a value produces { sanitized_key: value }.
   * The value type matches the control: string for text fields, boolean for
   * checkboxes/toggles, number for sliders/ranges, etc.
   */
  _extractTestData(rawAction) {
    const el  = rawAction.element || {};
    const raw = el.name || el.ariaLabel || el.label || el.placeholder || el.id || `element_${this.stepCounter}`;
    const key = raw.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
    const ct  = (el.controlType || el.type || '').toLowerCase();

    switch (rawAction.action) {
      case 'type':
      case 'input':
        return { [key]: rawAction.value || '' };

      case 'click': {
        // Checkbox / toggle → boolean
        if (ct === 'checkbox' || ct === 'toggle') return { [key]: !!rawAction.checked };
        // Radio → selected value
        if (ct === 'radio') return { [key]: rawAction.value || '' };
        // Generic clicks → just note it was clicked
        return { [key]: true };
      }

      case 'change': {
        // Select / combobox → prefer the option's value attribute (e.g. "1")
        // over the display text (e.g. "Option 1") so el.value = val works.
        if (ct === 'select' || ct === 'combobox' || ct === 'listbox' || ct === 'multiselect' || ct === 'cascader')
          return { [key]: rawAction.selectedValue || rawAction.value || '' };
        // Checkbox / toggle → boolean
        if (ct === 'checkbox' || ct === 'toggle') return { [key]: !!rawAction.checked };
        // Radio → value
        if (ct === 'radio') return { [key]: rawAction.value || '' };
        // Slider / range / number / rating → number
        if (ct === 'slider' || ct === 'range' || ct === 'number' || ct === 'rating' || ct === 'meter')
          return { [key]: parseFloat(rawAction.value) || 0 };
        // Color → hex string
        if (ct === 'color') return { [key]: rawAction.value || '#000000' };
        // File → filename(s) string
        if (ct === 'file') return { [key]: rawAction.value || '' };
        // Date / time pickers → string value
        if (['date', 'time', 'datetime', 'month', 'week'].includes(ct))
          return { [key]: rawAction.value || '' };
        // Fallback
        return { [key]: rawAction.value || '' };
      }

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

    // Text input
    if (rawAction.action === 'input' || rawAction.action === 'type') {
      return { type: 'visible', timeout: 5000 };
    }

    // Select/change/toggle → wait for element to be interactable
    if (['select', 'change', 'toggle'].includes(rawAction.action)) {
      return { type: 'visible', timeout: 5000 };
    }

    // Navigation
    if (rawAction.action === 'navigate') {
      return { type: 'networkIdle', timeout: 15000 };
    }

    // Hover/drag/scroll/modal → brief wait
    if (['hover', 'drag', 'scroll', 'modal'].includes(rawAction.action)) {
      return { type: 'visible', timeout: 3000 };
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
   * Generate a test case JSON from a recorded flow.
   *
   * Produces a top-level `testData` map (field → value) that is simple
   * and editable.  `testDataMeta` stores the controlType so the editor
   * can render the right widget.  Each data-bearing step gets a
   * `testDataKey` pointing into the map so replay can look up the value.
   *
   * Supported controlType values (comprehensive list):
   *   text, password, email, number, tel, url, search,
   *   textarea, contenteditable,
   *   checkbox, radio, toggle,
   *   select, combobox, listbox, multiselect, cascader,
   *   slider, rating, meter,
   *   color, file,
   *   date, time, datetime, month, week,
   *   button, link, submit, hidden,
   *   chips, transfer, progress, scrollbar,
   *   tab, tablist, tree, treeitem, grid, gridcell,
   *   unknown
   */
  _generateTestCase(flow) {
    const testData     = {};   // flat key→value map (the editable test data)
    const testDataMeta = {};   // key→{controlType, stepIndex, label, elementName, elementId}
    const usedKeys     = {};   // collision counter

    // EVERY user interaction MUST be represented in testcase.json — no exceptions.
    const steps = (flow.steps || []).map((step, index) => {
      const classifiedType = step.type || step.action;

      const tc = {
        stepIndex: index,
        action: classifiedType,
        interactionType: step.interactionType || classifiedType,
        description: step.description || '',
        locator: step.locators?.[0] || null,
        allLocators: step.locators || [],
        waitCondition: step.wait || null,
      };

      // Navigation URL (kept on the step, not in testData)
      if (step.action === 'navigate') {
        tc.url = step.url || '';
        return tc;
      }

      // Aggregate ALL interaction data into the top-level testData map
      if (step.testData && Object.keys(step.testData).length > 0) {
        const [rawKey, rawValue] = Object.entries(step.testData)[0];

        // Ensure unique key (email, email_2, email_3 …)
        let key = rawKey;
        if (usedKeys[key]) {
          usedKeys[key]++;
          key = `${rawKey}_${usedKeys[key]}`;
        } else {
          usedKeys[key] = 1;
        }

        // Determine controlType — prefer injected controlType, fall back to tag/type
        const el    = step.element || {};
        const elCt  = (el.controlType || '').toLowerCase();
        const elType = (el.type || '').toLowerCase();
        const elTag  = (el.tag  || '').toLowerCase();
        let controlType = elCt || elType || 'text';

        // Normalize well-known synonyms
        if (elTag === 'select' && controlType === '')          controlType = 'select';
        if (elTag === 'textarea' && controlType === '')        controlType = 'textarea';
        if (elType === 'range')                                 controlType = 'slider';
        if (el.contentEditable && controlType === 'unknown')    controlType = 'contenteditable';

        // Human-readable label
        const label = el.label || el.ariaLabel || el.placeholder || el.name || el.id || rawKey;

        testData[key]     = rawValue;
        testDataMeta[key] = {
          controlType: controlType,
          interactionType: step.interactionType || classifiedType,
          stepIndex:   index,
          label:       label,
          elementName: el.name || '',
          elementId:   el.id   || '',
          options: step.options || undefined,
          valueBefore: step.valueBefore ?? undefined,
        };

        tc.testDataKey = key;
      }

      return tc;
    });

    // Keep raw page-level step data (full element info, all locators, test data)
    const pageData = (flow.steps || []).map((step, index) => ({
      stepIndex: index,
      action: step.action,
      type: step.type,
      description: step.description || '',
      url: step.url || '',
      element: step.element || null,
      locators: step.locators || [],
      testData: step.testData || {},
      wait: step.wait || null,
    }));

    return {
      id:           flow.id,
      name:         flow.name || 'Untitled Test Case',
      startUrl:     flow.startUrl || '',
      createdAt:    new Date().toISOString(),
      status:       'recorded',
      testData,
      testDataMeta,
      steps,
      pageData,
    };
  }
}

module.exports = { RecorderEngine };
