/**
 * TestFlow — Export Engine
 *
 * Production-quality export pipeline that converts recorded manual testing
 * artifacts into clean automation outputs.
 *
 * Supported formats:
 *   1. Selenium (Python) — pytest-compatible scripts with data separation
 *   2. Markdown Report   — human-readable test documentation
 *   3. JSON Flow Data    — normalized, versioned, CI-ready
 *
 * Architecture:
 *   validate(flow) → normalize(flow) → generate(format) → write(output)
 *
 * All exporters consume the same normalized FlowSnapshot — no exporter
 * reads raw flow data directly.
 */

const fs = require('fs');
const path = require('path');

// ─── Schema version for JSON export backward compat ──────
const FLOW_SCHEMA_VERSION = '1.0.0';

// ─── Locator priority (higher = preferred) ───────────────
const LOCATOR_PRIORITY = {
  'id': 100,
  'data-testid': 95,
  'aria-label': 85,
  'role': 80,
  'name': 75,
  'css': 50,
  'xpath': 30,
  'text': 20,
};

class ExportEngine {
  constructor() {
    this._progress = null;
  }

  // ═══════════════════════════════════════════════════════════
  //  PUBLIC API
  // ═══════════════════════════════════════════════════════════

  /**
   * Validate whether a flow is exportable.
   * Returns { valid, errors[], warnings[] }
   */
  validate(flow) {
    const errors = [];
    const warnings = [];

    if (!flow) {
      errors.push('No flow provided.');
      return { valid: false, errors, warnings };
    }
    if (!flow.id) errors.push('Flow has no ID.');
    if (!flow.name || !flow.name.trim()) errors.push('Flow has no name.');
    if (!flow.steps || flow.steps.length === 0) {
      errors.push('Flow has no recorded steps. Record at least one action before exporting.');
    }

    if (flow.steps) {
      const enabled = flow.steps.filter(s => s.enabled !== false);
      if (enabled.length === 0) {
        errors.push('All steps are disabled — nothing to export.');
      }

      for (const step of enabled) {
        if (step.type === 'navigate' && !step.url && !step.testData?.url) {
          warnings.push(`Step ${step.order || '?'}: navigate has no URL.`);
        }
        if (step.type !== 'navigate' && step.type !== 'scroll' && (!step.locators || step.locators.length === 0)) {
          warnings.push(`Step ${step.order || '?'} (${step.type}): no locators — fallback will be limited.`);
        }
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Export Selenium Python script + data file.
   */
  async exportSeleniumPython(flow, outputDir, options = {}) {
    this._emit('start', { format: 'selenium-python', flow: flow.name });

    const validation = this.validate(flow);
    if (!validation.valid) {
      this._emit('error', { message: validation.errors.join('\n') });
      throw new ExportError('Validation failed', validation.errors, validation.warnings);
    }
    if (validation.warnings.length) {
      this._emit('warning', { warnings: validation.warnings });
    }

    const snapshot = this._normalize(flow);
    const baseName = this._toSnakeCase(flow.name);
    const files = [];

    // 1) Test data JSON
    const dataDir = path.join(outputDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    const dataPath = path.join(dataDir, `${baseName}_data.json`);
    const testDataObj = this._buildTestDataJSON(snapshot);
    fs.writeFileSync(dataPath, JSON.stringify(testDataObj, null, 2), 'utf-8');
    files.push({ path: dataPath, type: 'data', description: 'Test data (JSON)' });
    this._emit('progress', { step: 'Test data file written', file: dataPath });

    // 2) Locators module (POM only)
    if (options.pageObjectModel) {
      const locDir = path.join(outputDir, 'locators');
      fs.mkdirSync(locDir, { recursive: true });
      const locPath = path.join(locDir, `${baseName}_locators.py`);
      fs.writeFileSync(locPath, this._generateLocatorsModule(snapshot), 'utf-8');
      files.push({ path: locPath, type: 'locators', description: 'Page locators (Python)' });
      this._emit('progress', { step: 'Locators module written', file: locPath });
    }

    // 3) Test script
    const scriptPath = path.join(outputDir, `test_${baseName}.py`);
    const scriptContent = options.pageObjectModel
      ? this._generatePOMScript(snapshot, baseName)
      : this._generateFlatScript(snapshot, baseName);
    fs.writeFileSync(scriptPath, scriptContent, 'utf-8');
    files.push({ path: scriptPath, type: 'script', description: 'Test script (Python)' });
    this._emit('progress', { step: 'Test script written', file: scriptPath });

    this._emit('done', { format: 'selenium-python', files: files.length });
    return {
      files,
      format: 'selenium-python',
      stepCount: snapshot.steps.length,
      warnings: validation.warnings,
    };
  }

  /**
   * Export Markdown documentation report.
   */
  async exportMarkdown(flow, outputPath) {
    this._emit('start', { format: 'markdown', flow: flow.name });

    const validation = this.validate(flow);
    if (!validation.valid) {
      this._emit('error', { message: validation.errors.join('\n') });
      throw new ExportError('Validation failed', validation.errors, validation.warnings);
    }

    const snapshot = this._normalize(flow);
    const md = this._generateMarkdown(snapshot);
    fs.writeFileSync(outputPath, md, 'utf-8');

    this._emit('done', { format: 'markdown', files: 1 });
    return {
      path: outputPath,
      format: 'markdown',
      stepCount: snapshot.steps.length,
      warnings: validation.warnings,
    };
  }

  /**
   * Export normalized JSON flow data.
   */
  async exportJSON(flow, outputPath) {
    this._emit('start', { format: 'json', flow: flow.name });

    const validation = this.validate(flow);
    if (!validation.valid) {
      this._emit('error', { message: validation.errors.join('\n') });
      throw new ExportError('Validation failed', validation.errors, validation.warnings);
    }

    const snapshot = this._normalize(flow);
    const exportData = {
      $schema: 'testflow-flow-v1',
      version: FLOW_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      generator: 'TestFlow IDE',
      flow: {
        id: snapshot.id,
        name: snapshot.name,
        description: snapshot.description,
        created: snapshot.created,
        modified: snapshot.modified,
        tags: snapshot.tags,
        startUrl: snapshot.startUrl,
      },
      testData: snapshot.testData,
      steps: snapshot.steps.map(s => ({
        id: s.id,
        order: s.order,
        type: s.type,
        description: s.description,
        enabled: s.enabled,
        url: s.url || null,
        element: s.element ? {
          tag: s.element.tag,
          id: s.element.id || null,
          name: s.element.name || null,
          classes: s.element.classes || null,
          role: s.element.role || null,
          ariaLabel: s.element.ariaLabel || null,
          text: s.element.text ? s.element.text.substring(0, 200) : null,
        } : null,
        locators: (s.locators || []).map(l => ({
          strategy: l.type || l.strategy,
          value: l.value,
          confidence: l.confidence,
        })),
        testData: s.testData || null,
        wait: s.wait || null,
      })),
    };

    const cleaned = JSON.parse(JSON.stringify(exportData));
    fs.writeFileSync(outputPath, JSON.stringify(cleaned, null, 2), 'utf-8');

    this._emit('done', { format: 'json', files: 1 });
    return {
      path: outputPath,
      format: 'json',
      stepCount: snapshot.steps.length,
      warnings: validation.warnings,
    };
  }

  /**
   * Set a progress callback: fn(event, data)
   */
  onProgress(fn) {
    this._progress = fn;
  }

  // ═══════════════════════════════════════════════════════════
  //  NORMALIZATION
  // ═══════════════════════════════════════════════════════════

  _normalize(flow) {
    return {
      id: flow.id,
      name: flow.name,
      description: flow.metadata?.description || '',
      created: flow.created,
      modified: flow.modified,
      tags: flow.metadata?.tags || [],
      startUrl: flow.metadata?.startUrl || '',
      testData: { ...(flow.testData || {}) },
      steps: (flow.steps || []).map((s, idx) => ({
        ...s,
        order: s.order || idx + 1,
        description: s.description || this._autoDescription(s),
        enabled: s.enabled !== false,
        locators: this._rankLocators(s.locators || []),
      })),
    };
  }

  _rankLocators(locators) {
    return [...locators].sort((a, b) => {
      const aPrio = LOCATOR_PRIORITY[a.type || a.strategy] || 10;
      const bPrio = LOCATOR_PRIORITY[b.type || b.strategy] || 10;
      const aScore = (a.confidence || 0) * 0.6 + (aPrio / 100) * 0.4;
      const bScore = (b.confidence || 0) * 0.6 + (bPrio / 100) * 0.4;
      return bScore - aScore;
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  SELENIUM PYTHON — FLAT SCRIPT
  // ═══════════════════════════════════════════════════════════

  _generateFlatScript(snapshot, baseName) {
    const className = this._toPascalCase(snapshot.name);
    const L = [];

    L.push(this._pyHeader(snapshot));
    L.push(`import json`);
    L.push(`import os`);
    L.push(`import logging`);
    L.push(``);
    L.push(`from selenium import webdriver`);
    L.push(`from selenium.webdriver.common.by import By`);
    L.push(`from selenium.webdriver.support.ui import WebDriverWait`);
    L.push(`from selenium.webdriver.support import expected_conditions as EC`);
    L.push(`from selenium.webdriver.support.ui import Select`);
    L.push(`from selenium.common.exceptions import (`);
    L.push(`    NoSuchElementException,`);
    L.push(`    TimeoutException,`);
    L.push(`    ElementClickInterceptedException,`);
    L.push(`)`);
    L.push(``);
    L.push(`logger = logging.getLogger(__name__)`);
    L.push(``);
    L.push(``);
    L.push(`# ─── Test Data ─────────────────────────────────────────────`);
    L.push(`DATA_FILE = os.path.join(os.path.dirname(__file__), "data", "${baseName}_data.json")`);
    L.push(``);
    L.push(``);
    L.push(`def load_test_data():`);
    L.push(`    """Load test data from external JSON file."""`);
    L.push(`    with open(DATA_FILE, "r", encoding="utf-8") as f:`);
    L.push(`        return json.load(f)`);
    L.push(``);
    L.push(``);
    L.push(`# ─── Locator Helpers ───────────────────────────────────────`);
    L.push(`def find_with_fallback(driver, locators, timeout=10):`);
    L.push(`    """`);
    L.push(`    Attempt to find an element using multiple locator strategies.`);
    L.push(`    Returns the first successful match, logs failures.`);
    L.push(`    """`);
    L.push(`    last_error = None`);
    L.push(`    for strategy, value in locators:`);
    L.push(`        try:`);
    L.push(`            element = WebDriverWait(driver, timeout).until(`);
    L.push(`                EC.presence_of_element_located((strategy, value))`);
    L.push(`            )`);
    L.push(`            return element`);
    L.push(`        except (TimeoutException, NoSuchElementException) as e:`);
    L.push(`            logger.warning("Locator failed: %s=%s — %s", strategy, value, e)`);
    L.push(`            last_error = e`);
    L.push(`    raise last_error or NoSuchElementException("No locator matched")`);
    L.push(``);
    L.push(``);
    L.push(`# ─── Test Class ────────────────────────────────────────────`);
    L.push(`class Test${className}:`);
    L.push(`    """${snapshot.description || snapshot.name}"""`);
    L.push(``);
    L.push(`    def setup_method(self):`);
    L.push(`        self.driver = webdriver.Chrome()`);
    L.push(`        self.driver.maximize_window()`);
    L.push(`        self.wait = WebDriverWait(self.driver, 10)`);
    L.push(`        self.data = load_test_data()`);
    L.push(``);
    L.push(`    def teardown_method(self):`);
    L.push(`        self.driver.quit()`);
    L.push(``);
    L.push(`    def test_${this._toSnakeCase(snapshot.name)}(self):`);
    L.push(`        driver = self.driver`);
    L.push(`        wait = self.wait`);
    L.push(`        data = self.data`);
    L.push(``);

    for (const step of snapshot.steps) {
      if (!step.enabled) {
        L.push(`        # [DISABLED] Step ${step.order}: ${step.description}`);
        L.push(``);
        continue;
      }
      L.push(`        # Step ${step.order}: ${step.description}`);
      L.push(this._stepToPython(step, '        '));
      L.push(``);
    }

    L.push(``);
    L.push(`if __name__ == "__main__":`);
    L.push(`    import pytest`);
    L.push(`    pytest.main([__file__, "-v"])`);
    L.push(``);

    return L.join('\n');
  }

  // ═══════════════════════════════════════════════════════════
  //  SELENIUM PYTHON — PAGE OBJECT MODEL
  // ═══════════════════════════════════════════════════════════

  _generatePOMScript(snapshot, baseName) {
    const className = this._toPascalCase(snapshot.name);
    const L = [];

    L.push(this._pyHeader(snapshot));
    L.push(`import json`);
    L.push(`import os`);
    L.push(`import logging`);
    L.push(``);
    L.push(`from selenium import webdriver`);
    L.push(`from selenium.webdriver.common.by import By`);
    L.push(`from selenium.webdriver.support.ui import WebDriverWait`);
    L.push(`from selenium.webdriver.support import expected_conditions as EC`);
    L.push(`from selenium.webdriver.support.ui import Select`);
    L.push(`from selenium.common.exceptions import (`);
    L.push(`    NoSuchElementException,`);
    L.push(`    TimeoutException,`);
    L.push(`)`);
    L.push(``);
    L.push(`logger = logging.getLogger(__name__)`);
    L.push(``);
    L.push(`DATA_FILE = os.path.join(os.path.dirname(__file__), "data", "${baseName}_data.json")`);
    L.push(``);
    L.push(``);
    L.push(`def load_test_data():`);
    L.push(`    with open(DATA_FILE, "r", encoding="utf-8") as f:`);
    L.push(`        return json.load(f)`);
    L.push(``);
    L.push(``);

    // Page Object
    L.push(`# ─── Page Object ───────────────────────────────────────────`);
    L.push(`class ${className}Page:`);
    L.push(`    """Page object for ${snapshot.name}"""`);
    L.push(``);
    L.push(`    def __init__(self, driver):`);
    L.push(`        self.driver = driver`);
    L.push(`        self.wait = WebDriverWait(driver, 10)`);
    L.push(``);
    L.push(`    # ── Locators ──`);

    const elementMap = new Map();
    for (const step of snapshot.steps) {
      if (!step.enabled || step.type === 'navigate' || step.type === 'scroll') continue;
      if (step.locators && step.locators.length > 0) {
        const key = step.element?.name || step.element?.id || `element_${step.order}`;
        if (!elementMap.has(key)) {
          const best = step.locators[0];
          const by = this._locatorToBy(best);
          const varName = this._toConstName(key);
          elementMap.set(key, varName);
          L.push(`    ${varName} = (${by.by}, ${this._pyStr(by.value)})`);
        }
      }
    }
    L.push(``);

    for (const step of snapshot.steps) {
      if (!step.enabled) continue;
      const methodName = this._toSnakeCase(step.description.substring(0, 50));
      L.push(`    def ${methodName}(self, data=None):`);
      L.push(`        """${step.description}"""`);
      L.push(`        driver = self.driver`);
      L.push(`        wait = self.wait`);
      L.push(this._stepToPython(step, '        ', true));
      L.push(``);
    }

    L.push(``);
    L.push(`# ─── Test Class ────────────────────────────────────────────`);
    L.push(`class Test${className}:`);
    L.push(`    """${snapshot.description || snapshot.name}"""`);
    L.push(``);
    L.push(`    def setup_method(self):`);
    L.push(`        self.driver = webdriver.Chrome()`);
    L.push(`        self.driver.maximize_window()`);
    L.push(`        self.page = ${className}Page(self.driver)`);
    L.push(`        self.data = load_test_data()`);
    L.push(``);
    L.push(`    def teardown_method(self):`);
    L.push(`        self.driver.quit()`);
    L.push(``);
    L.push(`    def test_${this._toSnakeCase(snapshot.name)}(self):`);

    for (const step of snapshot.steps) {
      if (!step.enabled) continue;
      const methodName = this._toSnakeCase(step.description.substring(0, 50));
      L.push(`        self.page.${methodName}(data=self.data)`);
    }
    L.push(``);
    L.push(``);
    L.push(`if __name__ == "__main__":`);
    L.push(`    import pytest`);
    L.push(`    pytest.main([__file__, "-v"])`);
    L.push(``);

    return L.join('\n');
  }

  _generateLocatorsModule(snapshot) {
    const className = this._toPascalCase(snapshot.name);
    const L = [];
    L.push(this._pyHeader(snapshot, 'Locators'));
    L.push(`from selenium.webdriver.common.by import By`);
    L.push(``);
    L.push(``);
    L.push(`class ${className}Locators:`);
    L.push(`    """Centralized locators for ${snapshot.name}"""`);
    L.push(``);

    const seen = new Set();
    for (const step of snapshot.steps) {
      if (!step.enabled || step.type === 'navigate' || step.type === 'scroll') continue;
      if (step.locators && step.locators.length > 0) {
        const key = step.element?.name || step.element?.id || `element_${step.order}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const varName = this._toConstName(key);
        L.push(`    # Step ${step.order}: ${step.description}`);
        for (let i = 0; i < Math.min(step.locators.length, 3); i++) {
          const loc = step.locators[i];
          const by = this._locatorToBy(loc);
          const suffix = i === 0 ? '' : `_FALLBACK_${i}`;
          const conf = Math.round((loc.confidence || 0) * 100);
          L.push(`    ${varName}${suffix} = (${by.by}, ${this._pyStr(by.value)})  # ${conf}%`);
        }
        L.push(``);
      }
    }

    return L.join('\n');
  }

  // ═══════════════════════════════════════════════════════════
  //  STEP → PYTHON CODE
  // ═══════════════════════════════════════════════════════════

  _stepToPython(step, indent = '        ') {
    const L = [];
    const best = step.locators?.[0];

    if (!best && step.type !== 'navigate' && step.type !== 'scroll') {
      L.push(`${indent}# ⚠ WARNING: No locator — manual fix required`);
      L.push(`${indent}pass`);
      return L.join('\n');
    }

    const locatorList = (step.locators || []).slice(0, 3).map(l => {
      const by = this._locatorToBy(l);
      return `(${by.by}, ${this._pyStr(by.value)})`;
    });
    const useFallback = locatorList.length > 1;

    switch (step.type) {
      case 'navigate': {
        const url = step.testData?.url || step.url || '';
        const dataKey = this._findDataKey(step.testData, 'url');
        if (dataKey) {
          L.push(`${indent}driver.get(data.get(${this._pyStr(dataKey)}, ${this._pyStr(url)}))`);
        } else {
          L.push(`${indent}driver.get(${this._pyStr(url)})`);
        }
        break;
      }

      case 'click': {
        if (useFallback) {
          L.push(`${indent}element = find_with_fallback(driver, [`);
          for (const loc of locatorList) L.push(`${indent}    ${loc},`);
          L.push(`${indent}])`);
          L.push(`${indent}wait.until(EC.element_to_be_clickable(element))`);
          L.push(`${indent}element.click()`);
        } else {
          const by = this._locatorToBy(best);
          L.push(`${indent}wait.until(EC.element_to_be_clickable((${by.by}, ${this._pyStr(by.value)}))).click()`);
        }
        break;
      }

      case 'type': {
        const entries = Object.entries(step.testData || {});
        const dataKey = entries.length > 0 ? entries[0][0] : null;
        const rawValue = entries.length > 0 ? entries[0][1] : '';
        const valueExpr = dataKey
          ? `data.get(${this._pyStr(dataKey)}, ${this._pyStr(rawValue)})`
          : this._pyStr(rawValue);

        if (useFallback) {
          L.push(`${indent}element = find_with_fallback(driver, [`);
          for (const loc of locatorList) L.push(`${indent}    ${loc},`);
          L.push(`${indent}])`);
          L.push(`${indent}wait.until(EC.visibility_of(element))`);
        } else {
          const by = this._locatorToBy(best);
          L.push(`${indent}element = wait.until(EC.visibility_of_element_located((${by.by}, ${this._pyStr(by.value)})))`);
        }
        L.push(`${indent}element.clear()`);
        L.push(`${indent}element.send_keys(${valueExpr})`);
        break;
      }

      case 'select': {
        const entries = Object.entries(step.testData || {});
        const dataKey = entries.length > 0 ? entries[0][0] : null;
        const rawValue = entries.length > 0 ? entries[0][1] : '';
        const valueExpr = dataKey
          ? `data.get(${this._pyStr(dataKey)}, ${this._pyStr(rawValue)})`
          : this._pyStr(rawValue);
        const by = this._locatorToBy(best);
        L.push(`${indent}select_el = wait.until(EC.visibility_of_element_located((${by.by}, ${this._pyStr(by.value)})))`);
        L.push(`${indent}Select(select_el).select_by_visible_text(${valueExpr})`);
        break;
      }

      case 'check':
      case 'radio': {
        const by = this._locatorToBy(best);
        L.push(`${indent}element = wait.until(EC.element_to_be_clickable((${by.by}, ${this._pyStr(by.value)})))`);
        L.push(`${indent}if not element.is_selected():`);
        L.push(`${indent}    element.click()`);
        break;
      }

      case 'submit': {
        const by = this._locatorToBy(best);
        L.push(`${indent}wait.until(EC.element_to_be_clickable((${by.by}, ${this._pyStr(by.value)}))).submit()`);
        break;
      }

      case 'scroll': {
        const x = step.testData?.scrollX || 0;
        const y = step.testData?.scrollY || 300;
        L.push(`${indent}driver.execute_script("window.scrollBy(arguments[0], arguments[1])", ${x}, ${y})`);
        break;
      }

      case 'hover': {
        const by = this._locatorToBy(best);
        L.push(`${indent}from selenium.webdriver.common.action_chains import ActionChains`);
        L.push(`${indent}element = wait.until(EC.visibility_of_element_located((${by.by}, ${this._pyStr(by.value)})))`);
        L.push(`${indent}ActionChains(driver).move_to_element(element).perform()`);
        break;
      }

      case 'slider': {
        const entries = Object.entries(step.testData || {});
        const rawValue = entries.length > 0 ? entries[0][1] : 0;
        const by = this._locatorToBy(best);
        L.push(`${indent}slider = wait.until(EC.visibility_of_element_located((${by.by}, ${this._pyStr(by.value)})))`);
        L.push(`${indent}driver.execute_script(`);
        L.push(`${indent}    "arguments[0].value = arguments[1];`);
        L.push(`${indent}     arguments[0].dispatchEvent(new Event('input'));",`);
        L.push(`${indent}    slider, ${rawValue}`);
        L.push(`${indent})`);
        break;
      }

      default: {
        if (best) {
          const by = this._locatorToBy(best);
          L.push(`${indent}wait.until(EC.element_to_be_clickable((${by.by}, ${this._pyStr(by.value)}))).click()`);
        } else {
          L.push(`${indent}# ⚠ Unknown step type: ${step.type}`);
          L.push(`${indent}pass`);
        }
      }
    }

    return L.join('\n');
  }

  // ═══════════════════════════════════════════════════════════
  //  MARKDOWN REPORT
  // ═══════════════════════════════════════════════════════════

  _generateMarkdown(snapshot) {
    const L = [];

    L.push(`# Test Flow Report: ${snapshot.name}`);
    L.push(``);
    L.push(`> Auto-generated by **TestFlow** — Test Automation IDE  `);
    L.push(`> ${new Date().toISOString()}`);
    L.push(``);

    if (snapshot.description) {
      L.push(`## Description`);
      L.push(``);
      L.push(snapshot.description);
      L.push(``);
    }

    // Summary
    L.push(`## Summary`);
    L.push(``);
    L.push(`| Property | Value |`);
    L.push(`|----------|-------|`);
    L.push(`| Flow ID | \`${snapshot.id}\` |`);
    L.push(`| Total Steps | ${snapshot.steps.length} |`);
    L.push(`| Enabled Steps | ${snapshot.steps.filter(s => s.enabled).length} |`);
    L.push(`| Created | ${snapshot.created || 'N/A'} |`);
    L.push(`| Last Modified | ${snapshot.modified || 'N/A'} |`);
    if (snapshot.tags.length) L.push(`| Tags | ${snapshot.tags.join(', ')} |`);
    if (snapshot.startUrl) L.push(`| Start URL | ${snapshot.startUrl} |`);
    L.push(``);

    // Test Data
    const dataEntries = Object.entries(snapshot.testData || {});
    if (dataEntries.length > 0) {
      L.push(`## Test Data`);
      L.push(``);
      L.push(`| Key | Value |`);
      L.push(`|-----|-------|`);
      for (const [key, value] of dataEntries) {
        const masked = this._shouldMask(key) ? '••••••••' : String(value);
        L.push(`| \`${key}\` | \`${masked}\` |`);
      }
      L.push(``);
    }

    // Steps
    L.push(`## Steps`);
    L.push(``);

    for (const step of snapshot.steps) {
      const badge = step.enabled ? '✅' : '⏭️ DISABLED';
      L.push(`### Step ${step.order}: ${step.description} ${badge}`);
      L.push(``);
      L.push(`| Property | Detail |`);
      L.push(`|----------|--------|`);
      L.push(`| **Action** | \`${step.type}\` |`);
      if (step.url) L.push(`| **URL** | ${step.url} |`);
      if (step.element?.tag) {
        const elDesc = `\`<${step.element.tag}>\`` +
          (step.element.id ? ` #${step.element.id}` : '') +
          (step.element.name ? ` [name="${step.element.name}"]` : '');
        L.push(`| **Element** | ${elDesc} |`);
      }
      L.push(``);

      if (step.locators && step.locators.length > 0) {
        L.push(`**Locator Strategy (ranked):**`);
        L.push(``);
        for (let i = 0; i < Math.min(step.locators.length, 5); i++) {
          const loc = step.locators[i];
          const conf = Math.round((loc.confidence || 0) * 100);
          const bar = '█'.repeat(Math.round(conf / 10)) + '░'.repeat(10 - Math.round(conf / 10));
          const rank = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉';
          const strategy = loc.type || loc.strategy;
          L.push(`${rank} \`${strategy}\`: \`${loc.value}\` — ${bar} ${conf}%`);
        }
        L.push(``);
      }

      if (step.testData && Object.keys(step.testData).length > 0) {
        L.push(`**Input Data:**`);
        L.push(``);
        for (const [k, v] of Object.entries(step.testData)) {
          const masked = this._shouldMask(k) ? '••••••••' : v;
          L.push(`- \`${k}\` = \`${masked}\``);
        }
        L.push(``);
      }

      if (step.screenshot) {
        L.push(`**Screenshot:**`);
        L.push(``);
        L.push(`![Step ${step.order}](${step.screenshot})`);
        L.push(``);
      }
    }

    // Element Summary
    const stepsWithLocators = snapshot.steps.filter(s => s.locators && s.locators.length > 0);
    if (stepsWithLocators.length > 0) {
      L.push(`## Element Indicator Summary`);
      L.push(``);
      L.push(`| Step | Element | Strategy | Value | Confidence |`);
      L.push(`|------|---------|----------|-------|------------|`);
      for (const step of stepsWithLocators) {
        const best = step.locators[0];
        const elName = step.element?.ariaLabel || step.element?.name || step.element?.id || step.element?.tag || '-';
        const strategy = best.type || best.strategy;
        const val = best.value.length > 40 ? best.value.substring(0, 40) + '…' : best.value;
        L.push(`| ${step.order} | ${elName} | \`${strategy}\` | \`${val}\` | ${Math.round((best.confidence || 0) * 100)}% |`);
      }
      L.push(``);
    }

    L.push(`---`);
    L.push(``);
    L.push(`*Report generated by TestFlow v1.0.0*`);
    L.push(``);

    return L.join('\n');
  }

  // ═══════════════════════════════════════════════════════════
  //  HELPERS
  // ═══════════════════════════════════════════════════════════

  _buildTestDataJSON(snapshot) {
    const data = {};
    for (const [k, v] of Object.entries(snapshot.testData || {})) data[k] = v;
    for (const step of snapshot.steps) {
      if (step.testData) {
        for (const [k, v] of Object.entries(step.testData)) {
          if (k !== 'url') data[k] = v;
        }
      }
    }
    return data;
  }

  _locatorToBy(locator) {
    const type = locator.type || locator.strategy;
    switch (type) {
      case 'id':          return { by: 'By.ID', value: locator.value };
      case 'data-testid': return { by: 'By.CSS_SELECTOR', value: `[data-testid="${locator.value}"]` };
      case 'name':        return { by: 'By.NAME', value: locator.value };
      case 'css':         return { by: 'By.CSS_SELECTOR', value: locator.value };
      case 'xpath':       return { by: 'By.XPATH', value: locator.value };
      case 'aria-label':  return { by: 'By.CSS_SELECTOR', value: `[aria-label="${locator.value}"]` };
      case 'role':        return { by: 'By.CSS_SELECTOR', value: `[role="${locator.value}"]` };
      case 'text':        return { by: 'By.XPATH', value: `//*[contains(text(),"${locator.value}")]` };
      case 'linkText':    return { by: 'By.LINK_TEXT', value: locator.value };
      default:            return { by: 'By.CSS_SELECTOR', value: locator.value };
    }
  }

  _findDataKey(testData) {
    if (!testData) return null;
    const keys = Object.keys(testData);
    return keys.length > 0 ? keys[0] : null;
  }

  _autoDescription(step) {
    const el = step.element?.tag || '';
    const id = step.element?.id ? ` #${step.element.id}` : '';
    switch (step.type) {
      case 'navigate': return `Navigate to ${step.url || 'page'}`;
      case 'click':    return `Click ${el}${id}`.trim();
      case 'type':     return `Type into ${el}${id}`.trim();
      case 'select':   return `Select from ${el}${id}`.trim();
      case 'check':    return `Check ${el}${id}`.trim();
      case 'scroll':   return 'Scroll page';
      case 'hover':    return `Hover over ${el}${id}`.trim();
      case 'submit':   return `Submit ${el}${id}`.trim();
      default:         return `${step.type} on ${el}${id}`.trim() || step.type;
    }
  }

  _pyStr(str) {
    if (str === null || str === undefined) return '""';
    const escaped = String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `"${escaped}"`;
  }

  _pyHeader(snapshot, suffix = '') {
    const title = suffix ? `${snapshot.name} — ${suffix}` : snapshot.name;
    return [
      `"""`,
      `${title}`,
      ``,
      `Auto-generated by TestFlow — Test Automation IDE`,
      `Generated: ${new Date().toISOString()}`,
      `Flow ID:   ${snapshot.id}`,
      ``,
      `Do not edit test data inline — modify data/${this._toSnakeCase(snapshot.name)}_data.json instead.`,
      `"""`,
      ``,
    ].join('\n');
  }

  _shouldMask(key) {
    return /password|secret|token|api[_-]?key|credential|auth/i.test(key);
  }

  _toPascalCase(str) {
    return str.replace(/[^a-zA-Z0-9]+(.)/g, (_, c) => c.toUpperCase())
              .replace(/^(.)/, (_, c) => c.toUpperCase())
              .replace(/[^a-zA-Z0-9]/g, '') || 'Unnamed';
  }

  _toSnakeCase(str) {
    return str.toLowerCase()
              .replace(/[^a-zA-Z0-9]+/g, '_')
              .replace(/^_|_$/g, '')
              .substring(0, 60) || 'unnamed';
  }

  _toConstName(str) {
    return str.toUpperCase()
              .replace(/[^A-Z0-9]+/g, '_')
              .replace(/^_|_$/g, '')
              .substring(0, 40) || 'ELEMENT';
  }

  _emit(event, data) {
    if (this._progress) {
      try { this._progress(event, data); } catch (_) {}
    }
  }
}

/**
 * Structured export error with validation context.
 */
class ExportError extends Error {
  constructor(message, errors = [], warnings = []) {
    super(message);
    this.name = 'ExportError';
    this.errors = errors;
    this.warnings = warnings;
  }
}

module.exports = { ExportEngine, ExportError };
