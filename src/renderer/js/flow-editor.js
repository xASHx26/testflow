/**
 * TestFlow — Flow Editor
 * 
 * Manages flow list, step rendering, flow CRUD,
 * inline rename for flows and steps,
 * step selection, drag-reorder, and variable highlighting.
 */

class FlowEditor {
  constructor() {
    this.flows = [];
    this.activeFlowId = null;
    this.selectedStepIdx = -1;

    this.flowList = document.getElementById('flow-list');
    this.stepList = document.getElementById('flow-steps');
    this.stepCount = document.getElementById('step-count');
    this.btnNewFlow = document.getElementById('btn-new-flow');

    this._bind();
    this._listen();
  }

  _bind() {
    this.btnNewFlow.addEventListener('click', () => this._createFlow());
    window.testflow.on('menu:new-flow', () => this._createFlow());
  }

  _listen() {
    window.EventBus.on('recorder:stopped', () => this._refreshFlows());
    window.EventBus.on('recorder:started', (result) => {
      if (result && result.flowId) {
        this.activeFlowId = result.flowId;
        this._refreshFlows();
      }
    });
    window.EventBus.on('flow:step-added', () => this._renderSteps());
    window.EventBus.on('project:opened', () => this._refreshFlows());
    window.EventBus.on('replay:step-complete', (data) => this._markStepResult(data));

    // Live step updates during recording
    window.testflow.recorder.onAction(() => this._refreshFlows());
  }

  // ─── Flow List ───────────────────────────────────────────
  async _refreshFlows() {
    try {
      this.flows = await window.testflow.flow.getAll();
      this._renderFlowList();

      if (this.flows.length > 0 && !this.activeFlowId) {
        this._selectFlow(this.flows[0].id);
      } else if (this.activeFlowId) {
        this._renderSteps();
      }
    } catch (err) {
      console.error('Failed to refresh flows', err);
    }
  }

  _renderFlowList() {
    this.flowList.innerHTML = '';

    if (this.flows.length === 0) {
      this.flowList.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon"><span class="icon icon-2xl icon-clipboard"></span></span>
          <p>No flows yet</p>
          <p class="empty-hint">Click + or start recording</p>
        </div>`;
      return;
    }

    this.flows.forEach(flow => {
      const el = document.createElement('div');
      el.className = `flow-item${flow.id === this.activeFlowId ? ' active' : ''}`;
      el.dataset.flowId = flow.id;

      const count = flow.stepCount !== undefined ? flow.stepCount : 0;
      el.innerHTML = `
        <div class="flow-item-icon"><span class="icon icon-clipboard"></span></div>
        <div class="flow-item-info">
          <span class="flow-item-name" title="Double-click to rename">${this._esc(flow.name)}</span>
          <span class="flow-item-meta">${count} steps</span>
        </div>
        <div class="flow-item-actions">
          <button class="flow-item-btn flow-item-rename" title="Rename">✎</button>
          <button class="flow-item-btn flow-item-delete danger" title="Delete">&times;</button>
        </div>
      `;

      el.addEventListener('click', (e) => {
        if (e.target.closest('.flow-item-delete')) {
          e.stopPropagation();
          this._deleteFlow(flow.id);
        } else if (e.target.closest('.flow-item-rename')) {
          e.stopPropagation();
          this._startRenameFlow(el, flow);
        } else {
          this._selectFlow(flow.id);
        }
      });

      const nameEl = el.querySelector('.flow-item-name');
      nameEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        this._startRenameFlow(el, flow);
      });

      this.flowList.appendChild(el);
    });
  }

  // ─── Inline Rename Flow ──────────────────────────────────
  _startRenameFlow(el, flow) {
    const nameEl = el.querySelector('.flow-item-name');
    if (!nameEl) return;
    const currentName = flow.name;

    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentName;
    input.className = 'flow-rename-input';

    nameEl.replaceWith(input);
    input.focus();
    input.select();

    const commit = async () => {
      const newName = input.value.trim();
      if (newName && newName !== currentName) {
        try {
          await window.testflow.flow.rename(flow.id, newName);
          flow.name = newName;
        } catch (err) {
          console.error('Failed to rename flow', err);
        }
      }
      this._refreshFlows();
    };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') { input.value = currentName; input.blur(); }
    });
  }

  // ─── Create Flow ─────────────────────────────────────────
  async _createFlow() {
    const defaultName = `Recording ${this.flows.length + 1}`;
    try {
      const flow = await window.testflow.flow.create(defaultName);
      await window.testflow.flow.setActive(flow.id);
      this.activeFlowId = flow.id;
      await this._refreshFlows();
      // Auto-start renaming so user can type a name
      const newEl = this.flowList.querySelector(`[data-flow-id="${flow.id}"]`);
      if (newEl) {
        const cached = this.flows.find(f => f.id === flow.id);
        if (cached) this._startRenameFlow(newEl, cached);
      }
    } catch (err) {
      console.error('Failed to create flow', err);
    }
  }

  // ─── Select Flow ─────────────────────────────────────────
  async _selectFlow(flowId) {
    this.activeFlowId = flowId;
    this.selectedStepIdx = -1;

    try { await window.testflow.flow.setActive(flowId); } catch (e) { /* */ }

    this.flowList.querySelectorAll('.flow-item').forEach(el => {
      el.classList.toggle('active', el.dataset.flowId === flowId);
    });

    try {
      const flow = await window.testflow.flow.get(flowId);
      const steps = flow?.steps || [];
      if (this.stepCount) this.stepCount.textContent = steps.length;
      this._renderSteps(steps);
      window.EventBus.emit('flow:selected', flow);
    } catch (err) {
      console.error('Failed to load flow', err);
    }
  }

  // ─── Delete Flow ──────────────────────────────────────────
  async _deleteFlow(flowId) {
    if (!confirm('Delete this recording?')) return;

    try {
      await window.testflow.flow.delete(flowId);
      this.flows = this.flows.filter(f => f.id !== flowId);

      if (this.activeFlowId === flowId) {
        this.activeFlowId = null;
        if (this.stepList) {
          this.stepList.innerHTML = '<div class="empty-state"><span class="empty-icon"><span class="icon icon-2xl icon-edit"></span></span><p>No steps recorded</p></div>';
        }
        if (this.stepCount) this.stepCount.textContent = '0';
        if (this.flows.length > 0) {
          this._selectFlow(this.flows[0].id);
        }
      }

      this._renderFlowList();
    } catch (err) {
      console.error('Failed to delete flow', err);
    }
  }

  // ─── Steps ───────────────────────────────────────────────
  async _renderSteps(steps) {
    if (!steps && this.activeFlowId) {
      try {
        const flow = await window.testflow.flow.get(this.activeFlowId);
        steps = flow?.steps || [];
      } catch (e) {
        steps = [];
      }
    }

    if (!this.stepList) return;

    if (!steps || steps.length === 0) {
      this.stepList.innerHTML = '<div class="empty-state"><span class="empty-icon"><span class="icon icon-2xl icon-edit"></span></span><p>No steps recorded</p></div>';
      if (this.stepCount) this.stepCount.textContent = '0';
      return;
    }

    this.stepList.innerHTML = '';

    steps.forEach((step, idx) => {
      const card = this._buildStepCard(step, idx);
      this.stepList.appendChild(card);
    });

    if (this.stepCount) this.stepCount.textContent = steps.length;
  }

  _buildStepCard(step, idx) {
    const card = document.createElement('div');
    card.className = `step-card${idx === this.selectedStepIdx ? ' selected' : ''}`;
    card.dataset.stepId = step.id;
    card.dataset.index = idx;
    card.draggable = true;

    const typeBadge = this._typeBadge(step.type || step.action);
    const statusClass = step.enabled === false ? 'disabled' : '';
    const desc = step.description || step.action || 'Step';
    const locatorInfo = step.locators && step.locators.length > 0
      ? `${step.locators[0].strategy} (${Math.round(step.locators[0].confidence * 100)}%)`
      : '';

    card.innerHTML = `
      <div class="step-card-header ${statusClass}">
        <span class="step-order-badge">${idx + 1}</span>
        <span class="step-type-badge ${step.type || step.action}">${typeBadge}</span>
        <span class="step-description" title="Double-click to rename">${this._esc(desc)}</span>
        <div class="step-actions">
          <button class="step-action-btn step-edit-btn" title="Rename">✎</button>
          <button class="step-action-btn step-toggle" title="${step.enabled === false ? 'Enable' : 'Disable'}">${step.enabled === false ? '○' : '●'}</button>
          <button class="step-action-btn step-remove danger" title="Remove">&times;</button>
        </div>
      </div>
      ${locatorInfo ? `<div class="step-card-locator">${this._esc(locatorInfo)}</div>` : ''}
    `;

    card.addEventListener('click', (e) => {
      if (e.target.closest('.step-remove')) {
        e.stopPropagation();
        this._removeStep(step.id);
      } else if (e.target.closest('.step-toggle')) {
        e.stopPropagation();
        this._toggleStep(step.id, idx);
      } else if (e.target.closest('.step-edit-btn')) {
        e.stopPropagation();
        this._startRenameStep(card, step);
      } else {
        this._selectStep(idx, step);
      }
    });

    const descEl = card.querySelector('.step-description');
    descEl.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      this._startRenameStep(card, step);
    });

    // Drag reorder
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', idx.toString());
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
    card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('drag-over'); });
    card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('drag-over');
      const fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
      const toIdx = idx;
      if (fromIdx !== toIdx) this._reorderStep(fromIdx, toIdx);
    });

    return card;
  }

  // ─── Inline Rename Step ──────────────────────────────────
  _startRenameStep(card, step) {
    const descEl = card.querySelector('.step-description');
    if (!descEl) return;

    const currentDesc = step.description || step.action || '';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentDesc;
    input.className = 'step-rename-input';

    descEl.replaceWith(input);
    input.focus();
    input.select();

    const commit = async () => {
      const newDesc = input.value.trim();
      if (newDesc && newDesc !== currentDesc) {
        try {
          await window.testflow.flow.updateStep(this.activeFlowId, step.id, { description: newDesc });
          step.description = newDesc;
        } catch (err) {
          console.error('Failed to rename step', err);
        }
      }
      this._renderSteps();
    };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') { input.value = currentDesc; input.blur(); }
    });
  }

  _selectStep(idx, step) {
    this.selectedStepIdx = idx;
    this.stepList.querySelectorAll('.step-card').forEach((el, i) => {
      el.classList.toggle('selected', i === idx);
    });
    window.EventBus.emit('step:selected', step);
  }

  async _removeStep(stepId) {
    if (!this.activeFlowId) return;
    try {
      await window.testflow.flow.removeStep(this.activeFlowId, stepId);
      this._renderSteps();
      this._refreshFlows();
    } catch (err) {
      console.error('Failed to remove step', err);
    }
  }

  async _toggleStep(stepId) {
    if (!this.activeFlowId) return;
    try {
      await window.testflow.flow.toggleStep(this.activeFlowId, stepId);
      this._renderSteps();
    } catch (err) {
      console.error('Failed to toggle step', err);
    }
  }

  async _reorderStep(fromIdx, toIdx) {
    if (!this.activeFlowId) return;
    try {
      const flow = await window.testflow.flow.get(this.activeFlowId);
      if (!flow || !flow.steps) return;
      const ids = flow.steps.map(s => s.id);
      const [moved] = ids.splice(fromIdx, 1);
      ids.splice(toIdx, 0, moved);
      await window.testflow.flow.reorderSteps(this.activeFlowId, ids);
      this._renderSteps();
    } catch (err) {
      console.error('Failed to reorder step', err);
    }
  }

  _markStepResult(data) {
    if (!this.stepList) return;
    const cards = this.stepList.querySelectorAll('.step-card');
    const card = Array.from(cards).find(c => c.dataset.stepId === data.stepId);
    if (card) {
      card.classList.toggle('step-pass', data.status === 'pass');
      card.classList.toggle('step-fail', data.status === 'fail');
    }
  }

  // ─── Helpers ─────────────────────────────────────────────
  _typeBadge(action) {
    const icons = {
      navigate: '🌐', click: '👆', type: '⌨️', select: '📋',
      check: '☑️', radio: '🔘', submit: '📤', scroll: '↕️',
      slider: '🎚️', hover: '🖱️'
    };
    return icons[action] || '▶️';
  }

  _esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }
}

window.FlowEditor = new FlowEditor();
