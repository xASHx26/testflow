/**
 * TestFlow — Flow Engine
 * 
 * Manages test flows: creation, step management, grouping, ordering,
 * variable substitution, and serialization.
 */

const { v4: uuidv4 } = require('uuid');

class FlowEngine {
  constructor(projectManager) {
    this.projectManager = projectManager;
    this.flows = new Map();
    this.activeFlowId = null;
  }

  /**
   * Create a new flow
   */
  createFlow(name) {
    const flow = {
      id: uuidv4(),
      name: name || 'Untitled Flow',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      steps: [],
      groups: [],
      variables: {},
      metadata: {
        description: '',
        tags: [],
        author: '',
        startUrl: '',
      },
      testData: {},
    };

    this.flows.set(flow.id, flow);
    this.activeFlowId = flow.id;

    // Persist to project
    if (this.projectManager.getProjectPath()) {
      this.projectManager.saveFlow(flow);
    }

    return flow;
  }

  /**
   * Get a flow by ID
   */
  getFlow(flowId) {
    if (this.flows.has(flowId)) {
      return this.flows.get(flowId);
    }

    // Try loading from disk
    const flow = this.projectManager.loadFlow(flowId);
    if (flow) {
      this.flows.set(flow.id, flow);
    }
    return flow || null;
  }

  /**
   * Get all flows
   */
  getAllFlows() {
    // Merge in-memory with disk
    const diskFlows = this.projectManager.listFlows();
    for (const ref of diskFlows) {
      if (!this.flows.has(ref.id)) {
        const flow = this.projectManager.loadFlow(ref.id);
        if (flow) this.flows.set(flow.id, flow);
      }
    }

    return Array.from(this.flows.values()).map(f => ({
      id: f.id,
      name: f.name,
      stepCount: f.steps.length,
      modified: f.modified,
    }));
  }

  /**
   * Add a step to a flow
   */
  addStep(flowId, step) {
    const flow = this.getFlow(flowId);
    if (!flow) throw new Error(`Flow ${flowId} not found`);

    flow.steps.push(step);
    flow.modified = new Date().toISOString();

    // Merge step test data into flow-level test data
    if (step.testData) {
      Object.assign(flow.testData, step.testData);
    }

    this._persist(flow);
    return step;
  }

  /**
   * Update a step in a flow
   */
  updateStep(flowId, stepId, updates) {
    const flow = this.getFlow(flowId);
    if (!flow) throw new Error(`Flow ${flowId} not found`);

    const stepIndex = flow.steps.findIndex(s => s.id === stepId);
    if (stepIndex === -1) throw new Error(`Step ${stepId} not found`);

    flow.steps[stepIndex] = { ...flow.steps[stepIndex], ...updates };
    flow.modified = new Date().toISOString();

    this._persist(flow);
    return flow.steps[stepIndex];
  }

  /**
   * Remove a step from a flow
   */
  removeStep(flowId, stepId) {
    const flow = this.getFlow(flowId);
    if (!flow) throw new Error(`Flow ${flowId} not found`);

    flow.steps = flow.steps.filter(s => s.id !== stepId);
    flow.modified = new Date().toISOString();

    // Re-order remaining steps
    flow.steps.forEach((s, i) => { s.order = i + 1; });

    this._persist(flow);
    return true;
  }

  /**
   * Reorder steps
   */
  reorderSteps(flowId, orderedStepIds) {
    const flow = this.getFlow(flowId);
    if (!flow) throw new Error(`Flow ${flowId} not found`);

    const stepMap = new Map(flow.steps.map(s => [s.id, s]));
    flow.steps = orderedStepIds
      .map(id => stepMap.get(id))
      .filter(Boolean)
      .map((s, i) => ({ ...s, order: i + 1 }));

    flow.modified = new Date().toISOString();
    this._persist(flow);
    return flow.steps;
  }

  /**
   * Toggle a step's enabled state
   */
  toggleStep(flowId, stepId, enabled) {
    return this.updateStep(flowId, stepId, { enabled });
  }

  /**
   * Create a step group
   */
  createGroup(flowId, name, stepIds) {
    const flow = this.getFlow(flowId);
    if (!flow) throw new Error(`Flow ${flowId} not found`);

    const group = {
      id: uuidv4(),
      name,
      stepIds,
      collapsed: false,
    };

    flow.groups.push(group);

    // Tag steps with group
    stepIds.forEach(sid => {
      const step = flow.steps.find(s => s.id === sid);
      if (step) step.group = group.id;
    });

    flow.modified = new Date().toISOString();
    this._persist(flow);
    return group;
  }

  /**
   * Set a flow variable
   */
  setVariable(flowId, key, value) {
    const flow = this.getFlow(flowId);
    if (!flow) throw new Error(`Flow ${flowId} not found`);

    flow.variables[key] = value;
    flow.modified = new Date().toISOString();
    this._persist(flow);
    return true;
  }

  /**
   * Rename a flow
   */
  renameFlow(flowId, newName) {
    const flow = this.getFlow(flowId);
    if (!flow) throw new Error(`Flow ${flowId} not found`);

    flow.name = newName;
    flow.modified = new Date().toISOString();
    this._persist(flow);
    return flow;
  }

  /**
   * Delete a flow
   */
  deleteFlow(flowId) {
    this.flows.delete(flowId);
    try {
      this.projectManager.deleteFlow(flowId);
    } catch (e) {
      // Persistence may fail (e.g. no project open) — in-memory delete still valid
    }
    if (this.activeFlowId === flowId) {
      this.activeFlowId = null;
    }
    return true;
  }

  /**
   * Get the active flow ID
   */
  getActiveFlowId() {
    return this.activeFlowId;
  }

  /**
   * Set the active flow
   */
  setActiveFlow(flowId) {
    this.activeFlowId = flowId;
  }

  /**
   * Substitute variables in step values
   * Variables use the syntax {{variable_name}}
   */
  resolveVariables(flow, step) {
    const resolved = JSON.parse(JSON.stringify(step));

    if (!flow.variables || Object.keys(flow.variables).length === 0) {
      return resolved;
    }

    const replace = (str) => {
      if (typeof str !== 'string') return str;
      return str.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
        return flow.variables[varName] !== undefined ? flow.variables[varName] : match;
      });
    };

    // Resolve in test data
    if (resolved.testData) {
      for (const [key, value] of Object.entries(resolved.testData)) {
        resolved.testData[key] = replace(value);
      }
    }

    // Resolve in URL
    if (resolved.url) {
      resolved.url = replace(resolved.url);
    }

    return resolved;
  }

  /**
   * Persist flow to disk
   */
  _persist(flow) {
    if (this.projectManager.getProjectPath()) {
      this.projectManager.saveFlow(flow);

      // Also save aggregated test data
      this.projectManager.saveTestData(flow.id, flow.testData);
    }
  }

  /**
   * Persist ALL in-memory flows to disk.
   * Called after a project is created/opened to save any flows that were
   * recorded before the project existed.
   */
  persistAllFlows() {
    if (!this.projectManager.getProjectPath()) return 0;
    let count = 0;
    for (const flow of this.flows.values()) {
      this.projectManager.saveFlow(flow);
      if (flow.testData && Object.keys(flow.testData).length > 0) {
        this.projectManager.saveTestData(flow.id, flow.testData);
      }
      count++;
    }
    return count;
  }
}

module.exports = { FlowEngine };
