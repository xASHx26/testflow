/**
 * TestFlow — Report Configuration Service
 *
 * Manages screenshot and report-generation settings.
 * Settings are persisted to a JSON file in the user data folder.
 */

const fs   = require('fs');
const path = require('path');
const { app } = require('electron');

const CONFIG_FILE = 'report-settings.json';

/** Default settings – every key is documented. */
const DEFAULTS = {
  // ─── Screenshot strategy ──────────────────────────────────
  screenshot: {
    afterEachStep:           false,
    afterFailure:            true,
    afterEachTestCase:       false,
    beforeEachStep:          false,
    onlyOnAssertionFailure:  false,
    captureFullPage:         true,
    captureElementOnly:      false,
    compressImages:          false,
  },

  // ─── Report storage ───────────────────────────────────────
  storage: {
    reportFolder:            '',      // empty = <project>/reports
    autoTimestampFolder:     true,
    overwritePrevious:       false,
    retainLastN:             10,
    includeRawJson:          true,
  },

  // ─── Status Criteria ──────────────────────────────────────
  statusCriteria: {
    passWhenAllStepsPass:      true,
    failOnFirstStepFailure:    true,
    skipWhenNoStepsExecuted:   true,
    treatTimeoutAsFail:        true,
    treatElementNotFoundAsFail: true,
    treatNavigationErrorAsFail: true,
    treatAssertionFailAsFail:  true,
    treatNetworkErrorAsFail:   false,
    ignoreOptionalStepFailures: false,
  },

  // ─── Timeouts & Retry ────────────────────────────────────
  execution: {
    defaultStepTimeoutMs:    30000,
    defaultNavigationTimeoutMs: 60000,
    retryFailedSteps:        0,
    retryFailedTests:        0,
    delayBetweenStepsMs:     0,
    delayBetweenRetriesMs:   1000,
    continueOnFailure:       false,
  },

  // ─── Report Metadata ──────────────────────────────────────
  metadata: {
    projectName:             'TestFlow Report',
    environment:             'Development',
    testerName:              '',
    buildNumber:             '',
    tags:                    '',
    description:             '',
  },

  // ─── Advanced (future toggles) ────────────────────────────
  advanced: {
    includeNetworkLogs:      false,
    includeConsoleLogs:      false,
    includeTimingBreakdown:  true,
    includePerformanceMetrics: false,
    generateTrendChart:      false,
    anonymizeSensitiveData:  false,
    groupByTag:              false,
    showStepDuration:        true,
    showSkippedTests:        true,
    embedScreenshotsInline:  true,
  },
};

class ReportConfig {
  constructor() {
    this._configPath = path.join(
      (app && app.getPath ? app.getPath('userData') : '.'),
      CONFIG_FILE,
    );
    this._settings = null;
  }

  /** Return the full settings object (lazy-loaded). */
  get() {
    if (!this._settings) this._load();
    return JSON.parse(JSON.stringify(this._settings));
  }

  /** Merge partial updates and persist. */
  update(partial) {
    if (!this._settings) this._load();
    this._deepMerge(this._settings, partial);
    this._save();
    return this.get();
  }

  /** Reset to factory defaults and persist. */
  reset() {
    this._settings = JSON.parse(JSON.stringify(DEFAULTS));
    this._save();
    return this.get();
  }

  // ─── Internals ────────────────────────────────────────────

  _load() {
    try {
      if (fs.existsSync(this._configPath)) {
        const raw = fs.readFileSync(this._configPath, 'utf-8');
        const saved = JSON.parse(raw);
        this._settings = JSON.parse(JSON.stringify(DEFAULTS));
        this._deepMerge(this._settings, saved);
      } else {
        this._settings = JSON.parse(JSON.stringify(DEFAULTS));
      }
    } catch {
      this._settings = JSON.parse(JSON.stringify(DEFAULTS));
    }
  }

  _save() {
    try {
      const dir = path.dirname(this._configPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this._configPath, JSON.stringify(this._settings, null, 2), 'utf-8');
    } catch (err) {
      console.error('[ReportConfig] Failed to save settings:', err.message);
    }
  }

  _deepMerge(target, source) {
    if (!source || typeof source !== 'object') return;
    for (const key of Object.keys(source)) {
      if (
        target[key] &&
        typeof target[key] === 'object' &&
        !Array.isArray(target[key]) &&
        typeof source[key] === 'object' &&
        !Array.isArray(source[key])
      ) {
        this._deepMerge(target[key], source[key]);
      } else {
        target[key] = source[key];
      }
    }
  }
}

module.exports = { ReportConfig };
