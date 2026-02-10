/**
 * TestFlow — Step Card Component
 * 
 * Standalone step card builder — used when step cards 
 * need to be rendered outside of FlowEditor (e.g., in export previews).
 */

class StepCardComponent {
  /**
   * Build a step card DOM element.
   * @param {Object} step - Step data object
   * @param {number} index - Step order index (0-based)
   * @param {Object} options - { compact, showLocators, showTestData }
   * @returns {HTMLElement}
   */
  static create(step, index, options = {}) {
    const { compact = false, showLocators = false, showTestData = false } = options;

    const card = document.createElement('div');
    card.className = `step-card-component${compact ? ' compact' : ''}`;
    card.dataset.stepId = step.id;

    const typeBadge = StepCardComponent._typeIcon(step.action);
    const statusBadge = step.enabled === false ? '<span class="step-badge disabled">disabled</span>' : '';
    const desc = StepCardComponent._esc(step.description || step.action);

    let html = `
      <div class="step-card-row">
        <span class="step-order-badge">${index + 1}</span>
        <span class="step-type-icon">${typeBadge}</span>
        <span class="step-desc">${StepCardComponent._highlightVars(desc)}</span>
        ${statusBadge}
      </div>
    `;

    if (showLocators && step.locators && step.locators.length > 0) {
      const primary = step.locators[0];
      html += `
        <div class="step-card-locators">
          <span class="loc-strategy">${StepCardComponent._esc(primary.strategy)}</span>
          <span class="loc-value">${StepCardComponent._esc(primary.value)}</span>
          <span class="loc-confidence">${Math.round(primary.confidence * 100)}%</span>
        </div>
      `;
    }

    if (showTestData && step.testData && step.testData.length > 0) {
      const dataHtml = step.testData.map(td =>
        `<span class="td-chip">${StepCardComponent._esc(td.key)}: ${StepCardComponent._esc(td.value)}</span>`
      ).join('');
      html += `<div class="step-card-data">${dataHtml}</div>`;
    }

    card.innerHTML = html;
    return card;
  }

  static _typeIcon(action) {
    const icons = {
      navigate: '🌐', click: '👆', type: '⌨️', select: '📋',
      check: '☑️', radio: '🔘', submit: '📤', scroll: '↕️',
      slider: '🎚️', hover: '🖱️'
    };
    return icons[action] || '▶️';
  }

  static _highlightVars(text) {
    return text.replace(/\{\{(\w+)\}\}/g, '<span class="var-highlight">{{$1}}</span>');
  }

  static _esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }
}

window.StepCardComponent = StepCardComponent;
