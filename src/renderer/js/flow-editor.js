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
          <button class="step-action-btn step-edit-btn" title="Edit Step">✎</button>
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
        this._openEditStepDialog(step);
      } else {
        this._selectStep(idx, step);
      }
    });

    const descEl = card.querySelector('.step-description');
    descEl.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      this._openEditStepDialog(step);
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

  // ─── Edit Step Dialog ─────────────────────────────────────
  async _openEditStepDialog(step) {
    if (!this.activeFlowId) return;

    const esc = (s) => { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; };
    const actionTypes = ['navigate','click','input','select','toggle','radio','slider','hover','scroll','drag','submit','alert'];
    const actionOpts = actionTypes.map(a => `<option value="${a}"${a === (step.type || step.action) ? ' selected' : ''}>${a}</option>`).join('');

    const locatorRows = (step.locators || []).map((loc, i) => `
      <div class="edit-locator-row" data-idx="${i}">
        <select class="modal-input edit-loc-strategy" style="width:90px;flex:none">
          <option value="css"${loc.strategy === 'css' ? ' selected' : ''}>CSS</option>
          <option value="xpath"${loc.strategy === 'xpath' ? ' selected' : ''}>XPath</option>
          <option value="id"${loc.strategy === 'id' ? ' selected' : ''}>ID</option>
          <option value="name"${loc.strategy === 'name' ? ' selected' : ''}>Name</option>
          <option value="text"${loc.strategy === 'text' ? ' selected' : ''}>Text</option>
          <option value="aria"${loc.strategy === 'aria' ? ' selected' : ''}>Aria</option>
        </select>
        <input type="text" class="modal-input edit-loc-value" value="${esc(loc.value)}" style="flex:1" />
        <button class="step-action-btn danger edit-loc-remove" title="Remove">&times;</button>
      </div>
    `).join('');

    const testDataKeys = Object.keys(step.testData || {});
    const testDataRows = testDataKeys.map(k => `
      <div class="edit-testdata-row">
        <input type="text" class="modal-input edit-td-key" value="${esc(k)}" placeholder="Key" style="width:120px;flex:none" />
        <input type="text" class="modal-input edit-td-val" value="${esc((step.testData || {})[k])}" placeholder="Value" style="flex:1" />
        <button class="step-action-btn danger edit-td-remove" title="Remove">&times;</button>
      </div>
    `).join('');

    const bodyHtml = `
      <div class="edit-step-form">
        <div class="edit-step-row">
          <label class="modal-label">Description</label>
          <input type="text" id="edit-step-desc" class="modal-input" value="${esc(step.description || '')}" />
        </div>
        <div class="edit-step-row-group">
          <div class="edit-step-row" style="flex:1">
            <label class="modal-label">Action Type</label>
            <select id="edit-step-type" class="modal-input">${actionOpts}</select>
          </div>
          <div class="edit-step-row" style="flex:1">
            <label class="modal-label">URL</label>
            <input type="text" id="edit-step-url" class="modal-input" value="${esc(step.url || '')}" />
          </div>
        </div>
        <div class="edit-step-row">
          <label class="modal-label">Value / Input Text</label>
          <input type="text" id="edit-step-value" class="modal-input" value="${esc(step.element?.value || step.valueAfter || '')}"
            placeholder="Text that was typed or selected" />
        </div>
        <div class="edit-step-row">
          <label class="modal-label">Locators</label>
          <div id="edit-step-locators" class="edit-locator-list">${locatorRows || '<span class="text-muted">No locators</span>'}</div>
          <button id="edit-add-locator" class="btn-sm btn-ghost" style="margin-top:4px">+ Add Locator</button>
        </div>
        <div class="edit-step-row">
          <label class="modal-label">Test Data</label>
          <div id="edit-step-testdata" class="edit-locator-list">${testDataRows || '<span class="text-muted">No test data</span>'}</div>
          <button id="edit-add-testdata" class="btn-sm btn-ghost" style="margin-top:4px">+ Add Test Data</button>
        </div>
        <div class="edit-step-row-group">
          <div class="edit-step-row" style="flex:1">
            <label class="modal-label">Wait Type</label>
            <select id="edit-step-wait-type" class="modal-input">
              <option value="auto"${(step.wait?.type || 'auto') === 'auto' ? ' selected' : ''}>Auto</option>
              <option value="fixed"${step.wait?.type === 'fixed' ? ' selected' : ''}>Fixed Delay</option>
              <option value="element"${step.wait?.type === 'element' ? ' selected' : ''}>Wait for Element</option>
              <option value="none"${step.wait?.type === 'none' ? ' selected' : ''}>None</option>
            </select>
          </div>
          <div class="edit-step-row" style="flex:1">
            <label class="modal-label">Timeout (ms)</label>
            <input type="number" id="edit-step-wait-timeout" class="modal-input" value="${step.wait?.timeout || 5000}" min="0" step="500" />
          </div>
        </div>
        <div class="edit-step-row">
          <label class="modal-label">Notes</label>
          <textarea id="edit-step-notes" class="modal-input" rows="2" placeholder="Optional notes…">${esc(step.notes || '')}</textarea>
        </div>
        <div class="edit-step-row">
          <label class="modal-label">
            <input type="checkbox" id="edit-step-enabled" ${step.enabled !== false ? 'checked' : ''} /> Enabled
          </label>
        </div>
      </div>
    `;

    // Show the modal
    const overlay = document.getElementById('modal-overlay');
    overlay.innerHTML = `
      <div class="modal-content" style="max-width:620px;max-height:85vh;display:flex;flex-direction:column">
        <div class="modal-header">
          <h3>Edit Step — #${step.order || ''}</h3>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body" style="overflow-y:auto;flex:1">${bodyHtml}</div>
        <div class="modal-footer">
          <button class="btn btn-secondary modal-btn" id="edit-step-cancel">Cancel</button>
          <button class="btn btn-primary modal-btn" id="edit-step-save">Save</button>
        </div>
      </div>
    `;
    overlay.classList.remove('hidden');

    // Wire up dynamic add/remove for locators
    const locatorList = document.getElementById('edit-step-locators');
    document.getElementById('edit-add-locator').addEventListener('click', () => {
      const row = document.createElement('div');
      row.className = 'edit-locator-row';
      row.innerHTML = `
        <select class="modal-input edit-loc-strategy" style="width:90px;flex:none">
          <option value="css">CSS</option><option value="xpath">XPath</option>
          <option value="id">ID</option><option value="name">Name</option>
          <option value="text">Text</option><option value="aria">Aria</option>
        </select>
        <input type="text" class="modal-input edit-loc-value" value="" style="flex:1" placeholder="Enter selector…" />
        <button class="step-action-btn danger edit-loc-remove" title="Remove">&times;</button>
      `;
      // Remove the "no locators" hint
      const hint = locatorList.querySelector('.text-muted');
      if (hint) hint.remove();
      locatorList.appendChild(row);
    });
    locatorList.addEventListener('click', (e) => {
      if (e.target.closest('.edit-loc-remove')) e.target.closest('.edit-locator-row').remove();
    });

    // Wire up dynamic add/remove for test data
    const tdList = document.getElementById('edit-step-testdata');
    document.getElementById('edit-add-testdata').addEventListener('click', () => {
      const row = document.createElement('div');
      row.className = 'edit-testdata-row';
      row.innerHTML = `
        <input type="text" class="modal-input edit-td-key" value="" placeholder="Key" style="width:120px;flex:none" />
        <input type="text" class="modal-input edit-td-val" value="" placeholder="Value" style="flex:1" />
        <button class="step-action-btn danger edit-td-remove" title="Remove">&times;</button>
      `;
      const hint = tdList.querySelector('.text-muted');
      if (hint) hint.remove();
      tdList.appendChild(row);
    });
    tdList.addEventListener('click', (e) => {
      if (e.target.closest('.edit-td-remove')) e.target.closest('.edit-testdata-row').remove();
    });

    // Save / Cancel
    return new Promise((resolve) => {
      const close = () => { overlay.classList.add('hidden'); overlay.innerHTML = ''; resolve(); };

      overlay.querySelector('.modal-close').addEventListener('click', close);
      document.getElementById('edit-step-cancel').addEventListener('click', close);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

      document.getElementById('edit-step-save').addEventListener('click', async () => {
        // Collect form data
        const updates = {};
        const newDesc = document.getElementById('edit-step-desc').value.trim();
        if (newDesc !== (step.description || '')) updates.description = newDesc;

        const newType = document.getElementById('edit-step-type').value;
        if (newType !== (step.type || step.action)) { updates.type = newType; updates.action = newType; }

        const newUrl = document.getElementById('edit-step-url').value.trim();
        if (newUrl !== (step.url || '')) updates.url = newUrl;

        const newValue = document.getElementById('edit-step-value').value;
        if (newValue !== (step.element?.value || step.valueAfter || '')) {
          updates.valueAfter = newValue;
          if (!updates.element) updates.element = { ...(step.element || {}) };
          updates.element.value = newValue;
        }

        // Locators
        const locRows = locatorList.querySelectorAll('.edit-locator-row');
        const newLocators = [];
        locRows.forEach(row => {
          const strat = row.querySelector('.edit-loc-strategy').value;
          const val = row.querySelector('.edit-loc-value').value.trim();
          if (val) newLocators.push({ strategy: strat, value: val, confidence: 1.0 });
        });
        updates.locators = newLocators;

        // Test Data
        const tdRows = tdList.querySelectorAll('.edit-testdata-row');
        const newTestData = {};
        tdRows.forEach(row => {
          const k = row.querySelector('.edit-td-key').value.trim();
          const v = row.querySelector('.edit-td-val').value;
          if (k) newTestData[k] = v;
        });
        updates.testData = newTestData;

        // Wait
        updates.wait = {
          type: document.getElementById('edit-step-wait-type').value,
          timeout: parseInt(document.getElementById('edit-step-wait-timeout').value) || 5000
        };

        // Notes
        const newNotes = document.getElementById('edit-step-notes').value;
        if (newNotes !== (step.notes || '')) updates.notes = newNotes;

        // Enabled
        const newEnabled = document.getElementById('edit-step-enabled').checked;
        if (newEnabled !== (step.enabled !== false)) updates.enabled = newEnabled;

        try {
          await window.testflow.flow.updateStep(this.activeFlowId, step.id, updates);
        } catch (err) {
          console.error('Failed to update step', err);
        }

        close();
        this._renderSteps();
      });
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
