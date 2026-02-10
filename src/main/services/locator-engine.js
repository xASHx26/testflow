/**
 * TestFlow — Locator Engine
 * 
 * Generates multiple locators per element, ranks them by confidence,
 * and provides fallback chain for replay stability.
 */

class LocatorEngine {
  constructor() {
    // Weights for confidence scoring
    this.weights = {
      uniqueness: 0.4,
      stability: 0.35,
      readability: 0.25,
    };

    // Attributes known to be dynamic (should lower confidence)
    this.dynamicPatterns = [
      /^ng-/,         // Angular
      /^data-reactid/,
      /^data-v-/,     // Vue scoped
      /^_ngcontent/,
      /^_nghost/,
      /ember\d+/,
      /^js-/,
      /[0-9a-f]{8,}/i, // Hash-like
      /\d{10,}/,       // Timestamp-like
    ];
  }

  /**
   * Generate all possible locators for an element
   */
  generateLocators(elementData) {
    if (!elementData) return [];

    const locators = [];

    // 1. ID-based locator (highest priority if stable)
    if (elementData.id && !this._isDynamic(elementData.id)) {
      locators.push({
        type: 'id',
        value: elementData.id,
        strategy: 'id',
        confidence: 0,
      });
    }

    // 2. Name-based locator
    if (elementData.name) {
      locators.push({
        type: 'name',
        value: elementData.name,
        strategy: 'name',
        confidence: 0,
      });
    }

    // 3. ARIA label locator
    if (elementData.ariaLabel) {
      locators.push({
        type: 'aria-label',
        value: elementData.ariaLabel,
        strategy: 'accessibility',
        confidence: 0,
      });
    }

    // 4. Role-based locator
    if (elementData.role) {
      const roleSelector = elementData.ariaLabel
        ? `[role="${elementData.role}"][aria-label="${elementData.ariaLabel}"]`
        : `[role="${elementData.role}"]`;
      locators.push({
        type: 'css',
        value: roleSelector,
        strategy: 'role',
        confidence: 0,
      });
    }

    // 5. Label-based locator (for form elements)
    if (elementData.label && elementData.id) {
      locators.push({
        type: 'css',
        value: `label[for="${elementData.id}"] + ${elementData.tag || '*'}`,
        strategy: 'label',
        confidence: 0,
      });
    }

    // 6. Placeholder-based locator
    if (elementData.placeholder) {
      locators.push({
        type: 'css',
        value: `[placeholder="${this._escapeCSS(elementData.placeholder)}"]`,
        strategy: 'placeholder',
        confidence: 0,
      });
    }

    // 7. CSS selector (composed)
    const cssSelector = this._buildCSSSelector(elementData);
    if (cssSelector) {
      locators.push({
        type: 'css',
        value: cssSelector,
        strategy: 'css',
        confidence: 0,
      });
    }

    // 8. Text-based locator
    if (elementData.text && elementData.text.length < 100) {
      locators.push({
        type: 'xpath',
        value: this._buildTextXPath(elementData),
        strategy: 'text',
        confidence: 0,
      });
    }

    // 9. Relative XPath
    if (elementData.xpath) {
      locators.push({
        type: 'xpath',
        value: elementData.xpath,
        strategy: 'relativeXPath',
        confidence: 0,
      });
    }

    // 10. Data-testid / data-cy / data-test (testing attributes)
    for (const attr of ['data-testid', 'data-cy', 'data-test', 'data-automation-id']) {
      if (elementData[attr]) {
        locators.push({
          type: 'css',
          value: `[${attr}="${this._escapeCSS(elementData[attr])}"]`,
          strategy: 'testAttribute',
          confidence: 0,
        });
      }
    }

    // 11. Absolute XPath (lowest priority)
    if (elementData.absoluteXpath) {
      locators.push({
        type: 'xpath',
        value: elementData.absoluteXpath,
        strategy: 'absoluteXPath',
        confidence: 0,
      });
    }

    return locators;
  }

  /**
   * Rank locators by confidence score
   */
  rankLocators(locators) {
    return locators
      .map(loc => ({
        ...loc,
        confidence: this._calculateConfidence(loc),
      }))
      .sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Calculate the confidence score for a locator
   */
  _calculateConfidence(locator) {
    let uniqueness = 0;
    let stability = 0;
    let readability = 0;

    switch (locator.strategy) {
      case 'testAttribute':
        uniqueness = 0.95;
        stability = 0.95;
        readability = 0.85;
        break;

      case 'id':
        uniqueness = 0.95;
        stability = this._isDynamic(locator.value) ? 0.2 : 0.9;
        readability = 0.8;
        break;

      case 'name':
        uniqueness = 0.85;
        stability = 0.85;
        readability = 0.8;
        break;

      case 'accessibility':
        uniqueness = 0.8;
        stability = 0.85;
        readability = 0.9;
        break;

      case 'role':
        uniqueness = 0.6;
        stability = 0.8;
        readability = 0.85;
        break;

      case 'label':
        uniqueness = 0.75;
        stability = 0.8;
        readability = 0.9;
        break;

      case 'placeholder':
        uniqueness = 0.7;
        stability = 0.7;
        readability = 0.85;
        break;

      case 'css':
        uniqueness = 0.7;
        stability = 0.65;
        readability = 0.7;
        break;

      case 'text':
        uniqueness = 0.6;
        stability = 0.5;
        readability = 0.9;
        break;

      case 'relativeXPath':
        uniqueness = 0.75;
        stability = 0.55;
        readability = 0.5;
        break;

      case 'absoluteXPath':
        uniqueness = 0.95;
        stability = 0.15;
        readability = 0.1;
        break;

      default:
        uniqueness = 0.5;
        stability = 0.5;
        readability = 0.5;
    }

    // Check for dynamic patterns in the value
    if (this._isDynamic(locator.value)) {
      stability *= 0.3;
    }

    // Penalize very long selectors
    if (locator.value.length > 100) {
      readability *= 0.5;
      stability *= 0.7;
    }

    return parseFloat(
      (
        uniqueness * this.weights.uniqueness +
        stability * this.weights.stability +
        readability * this.weights.readability
      ).toFixed(3)
    );
  }

  /**
   * Check if a value contains dynamic patterns
   */
  _isDynamic(value) {
    if (!value) return false;
    return this.dynamicPatterns.some(pattern => pattern.test(value));
  }

  /**
   * Build a composed CSS selector from element data
   */
  _buildCSSSelector(el) {
    let selector = el.tag || '';

    if (el.id && !this._isDynamic(el.id)) {
      selector += `#${this._escapeCSS(el.id)}`;
      return selector;
    }

    // Use stable classes only
    if (el.classes && el.classes.length > 0) {
      const stableClasses = el.classes.filter(c => !this._isDynamic(c) && c.length > 1);
      if (stableClasses.length > 0) {
        selector += stableClasses.slice(0, 3).map(c => `.${this._escapeCSS(c)}`).join('');
      }
    }

    // Add type attribute for inputs
    if (el.tag === 'input' && el.type) {
      selector += `[type="${el.type}"]`;
    }

    return selector || null;
  }

  /**
   * Build an XPath using text content
   */
  _buildTextXPath(el) {
    const tag = el.tag || '*';
    const text = el.text.trim();

    if (text.length < 50) {
      return `//${tag}[normalize-space(text())="${this._escapeXPath(text)}"]`;
    }

    return `//${tag}[contains(text(),"${this._escapeXPath(text.substring(0, 40))}")]`;
  }

  /**
   * Escape a value for CSS selector
   */
  _escapeCSS(value) {
    return value.replace(/([!"#$%&'()*+,./:;<=>?@[\]^`{|}~\\])/g, '\\$1');
  }

  /**
   * Escape a value for XPath
   */
  _escapeXPath(value) {
    if (!value.includes("'")) return value;
    if (!value.includes('"')) return value;
    return value.replace(/'/g, "\\'");
  }
}

module.exports = { LocatorEngine };
