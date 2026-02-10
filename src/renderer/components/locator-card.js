/**
 * TestFlow — Locator Card Component
 * 
 * Standalone locator card builder — reusable for inspector panel,
 * mini inspector, and export previews.
 */

class LocatorCardComponent {
  /**
   * Build a locator card DOM element.
   * @param {Object} locator - { strategy, value, confidence }
   * @param {Object} options - { primary, showCopy, onClick }
   * @returns {HTMLElement}
   */
  static create(locator, options = {}) {
    const { primary = false, showCopy = true, onClick = null } = options;

    const card = document.createElement('div');
    card.className = `locator-card-component${primary ? ' primary' : ''}`;

    const pct = Math.round(locator.confidence * 100);
    const barColor = pct >= 80 ? 'var(--green)' : pct >= 50 ? 'var(--yellow)' : 'var(--red)';

    card.innerHTML = `
      <div class="loc-card-header">
        <span class="loc-strategy-badge">${LocatorCardComponent._esc(locator.strategy)}</span>
        <span class="loc-pct">${pct}%</span>
        ${showCopy ? '<button class="loc-copy-btn" title="Copy">📋</button>' : ''}
      </div>
      <div class="loc-card-value" title="${LocatorCardComponent._esc(locator.value)}">${LocatorCardComponent._esc(locator.value)}</div>
      <div class="loc-card-bar">
        <div class="loc-card-bar-fill" style="width:${pct}%;background:${barColor}"></div>
      </div>
    `;

    if (showCopy) {
      card.querySelector('.loc-copy-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(locator.value);
        const btn = e.target;
        btn.textContent = '✅';
        setTimeout(() => btn.textContent = '📋', 1500);
      });
    }

    if (onClick) {
      card.style.cursor = 'pointer';
      card.addEventListener('click', () => onClick(locator));
    }

    return card;
  }

  /**
   * Build a list of locator cards.
   * @param {Array} locators - Array of locator objects
   * @param {Object} options - Passed through to create()
   * @returns {DocumentFragment}
   */
  static createList(locators, options = {}) {
    const fragment = document.createDocumentFragment();
    const sorted = [...locators].sort((a, b) => b.confidence - a.confidence);

    sorted.forEach((loc, i) => {
      const card = LocatorCardComponent.create(loc, {
        ...options,
        primary: i === 0
      });
      fragment.appendChild(card);
    });

    return fragment;
  }

  static _esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }
}

window.LocatorCardComponent = LocatorCardComponent;
