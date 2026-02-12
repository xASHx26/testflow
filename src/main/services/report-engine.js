/**
 * TestFlow — Report Engine
 *
 * Generates modern, self-contained HTML execution reports (Allure-style).
 * Each report is a single index.html with embedded CSS/JS + Base64 screenshots.
 *
 * Architecture:
 *   ReplayEngine  ──▶  executionData  ──▶  ReportEngine.generate()  ──▶  index.html
 *   (step results)    (screenshots)       (standalone HTML report)
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { app } = require('electron');

class ReportEngine {
  constructor(reportConfig) {
    this.reportConfig = reportConfig;
  }

  /**
   * Generate a full HTML report.
   *
   * @param {Object} opts
   * @param {Object[]} opts.testCases   – array of { name, startUrl, status, steps, testData, ... }
   * @param {Object[]} opts.results     – per-test-case array of step-result arrays
   * @param {Object}   opts.screenshots – map  stepId → { base64, mimeType }
   * @param {number}   opts.startedAt   – epoch ms
   * @param {number}   opts.finishedAt  – epoch ms
   * @param {string}   [opts.projectName]
   * @returns {{ reportDir: string, indexPath: string }}
   */
  async generate(opts) {
    const {
      testCases   = [],
      results     = [],
      screenshots = {},
      startedAt   = Date.now(),
      finishedAt  = Date.now(),
      projectName = 'TestFlow Report',
    } = opts;

    const settings = this.reportConfig.get();

    // ── Determine output folder ──────────────────────────────
    const baseDir = settings.storage.reportFolder || this._defaultReportDir();
    const ts      = this._timestamp(startedAt);
    const reportDir = settings.storage.autoTimestampFolder
      ? path.join(baseDir, ts)
      : baseDir;

    if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });

    // ── Prune old reports ────────────────────────────────────
    if (settings.storage.autoTimestampFolder && settings.storage.retainLastN > 0) {
      this._pruneOldReports(baseDir, settings.storage.retainLastN);
    }

    // ── Build data model ─────────────────────────────────────
    const env = this._environment();
    const suiteData = this._buildSuiteData(testCases, results, screenshots, startedAt, finishedAt);

    // ── Write execution.json (optional) ──────────────────────
    if (settings.storage.includeRawJson) {
      const jsonPath = path.join(reportDir, 'execution.json');
      fs.writeFileSync(jsonPath, JSON.stringify({ env, ...suiteData }, null, 2), 'utf-8');
    }

    // ── Write screenshots to disk ────────────────────────────
    const screenshotDir = path.join(reportDir, 'screenshots');
    if (Object.keys(screenshots).length > 0) {
      if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
      for (const [id, shot] of Object.entries(screenshots)) {
        const fname = `${id}.png`;
        const buf = Buffer.isBuffer(shot.buffer)
          ? shot.buffer
          : Buffer.from(shot.base64 || '', 'base64');
        fs.writeFileSync(path.join(screenshotDir, fname), buf);
      }
    }

    // ── Render HTML ──────────────────────────────────────────
    const html = this._renderHtml(projectName, env, suiteData, screenshots);
    const indexPath = path.join(reportDir, 'index.html');
    fs.writeFileSync(indexPath, html, 'utf-8');

    return { reportDir, indexPath };
  }

  // ═══════════════════════════════════════════════════════════
  //  Data model
  // ═══════════════════════════════════════════════════════════

  _buildSuiteData(testCases, results, screenshots, startedAt, finishedAt) {
    let passed = 0, failed = 0, skipped = 0;
    const cases = testCases.map((tc, idx) => {
      const stepResults = results[idx] || [];
      const status = this._deriveStatus(tc, stepResults);
      if (status === 'passed') passed++;
      else if (status === 'failed') failed++;
      else skipped++;

      const totalDuration = stepResults.reduce(
        (s, r) => s + (r.diagnostics?.duration || 0), 0,
      );

      const steps = stepResults.map((r, si) => {
        const srcStep = (tc.steps || [])[si] || {};
        return {
          index: si + 1,
          description: r.description || srcStep.description || `${r.stepType || 'action'}`,
          element: this._stepElementLabel(srcStep, r),
          locator: r.diagnostics?.locatorUsed
            ? `${r.diagnostics.locatorUsed.type}: ${r.diagnostics.locatorUsed.value}`
            : '—',
          inputValue: this._stepInputValue(srcStep),
          status: r.status,
          duration: r.diagnostics?.duration || 0,
          error: r.error || null,
          screenshot: screenshots[r.stepId] ? `${r.stepId}.png` : null,
          locatorsFailed: (r.diagnostics?.locatorsFailed || []).map(
            lf => `${lf.locator?.type}: ${lf.locator?.value} → ${lf.error}`,
          ),
          fallbackUsed: r.diagnostics?.fallbackUsed || false,
        };
      });

      return {
        index: idx + 1,
        name: tc.name || `Test Case ${idx + 1}`,
        description: tc.description || tc.startUrl || '',
        status,
        duration: totalDuration,
        testData: tc.testData || {},
        steps,
      };
    });

    return {
      total: testCases.length,
      passed,
      failed,
      skipped,
      duration: finishedAt - startedAt,
      startedAt,
      finishedAt,
      cases,
    };
  }

  _deriveStatus(tc, stepResults) {
    if (!stepResults || stepResults.length === 0) return 'skipped';
    if (stepResults.every(r => r.status === 'passed')) return 'passed';
    return 'failed';
  }

  _stepElementLabel(srcStep, result) {
    if (srcStep.testDataKey) return srcStep.testDataKey;
    const el = srcStep.element || result.element;
    if (!el) return '—';
    return el.name || el.id || el.tag || '—';
  }

  _stepInputValue(srcStep) {
    if (srcStep.testDataKey && srcStep.testData) {
      const val = Object.values(srcStep.testData)[0];
      if (val !== undefined && val !== null) return String(val);
    }
    if (srcStep.value !== undefined && srcStep.value !== null) return String(srcStep.value);
    return null;
  }

  // ═══════════════════════════════════════════════════════════
  //  Environment
  // ═══════════════════════════════════════════════════════════

  _environment() {
    return {
      os: `${os.type()} ${os.release()} (${os.arch()})`,
      node: process.version,
      electron: process.versions.electron || '—',
      chromium: process.versions.chrome || '—',
      hostname: os.hostname(),
      user: os.userInfo().username,
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  HTML Rendering (self-contained, no external deps)
  // ═══════════════════════════════════════════════════════════

  _renderHtml(projectName, env, suite, screenshots) {
    const screenshotMap = {};
    for (const [id, shot] of Object.entries(screenshots)) {
      screenshotMap[`${id}.png`] = shot.base64 || (shot.buffer ? shot.buffer.toString('base64') : '');
    }

    return /*html*/`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${this._esc(projectName)} — Execution Report</title>
${this._renderCss()}
</head>
<body>
<div id="app">

  <!-- ─── Header ──────────────────────────────────────────── -->
  <header class="report-header">
    <div class="header-brand">
      <svg width="28" height="28" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" stroke="#a6e3a1" stroke-width="2.5"/><path d="M10 16l4 4 8-8" stroke="#a6e3a1" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <h1>${this._esc(projectName)}</h1>
    </div>
    <div class="header-meta">
      <span class="meta-badge">${new Date(suite.startedAt).toLocaleString()}</span>
      <span class="meta-badge">${this._formatDuration(suite.duration)}</span>
    </div>
  </header>

  <!-- ─── Summary Dashboard ──────────────────────────────── -->
  <section class="dashboard">
    <div class="dash-card dash-total">
      <div class="dash-value">${suite.total}</div>
      <div class="dash-label">Total</div>
    </div>
    <div class="dash-card dash-passed">
      <div class="dash-value">${suite.passed}</div>
      <div class="dash-label">Passed</div>
    </div>
    <div class="dash-card dash-failed">
      <div class="dash-value">${suite.failed}</div>
      <div class="dash-label">Failed</div>
    </div>
    <div class="dash-card dash-skipped">
      <div class="dash-value">${suite.skipped}</div>
      <div class="dash-label">Skipped</div>
    </div>
    <div class="dash-card dash-duration">
      <div class="dash-value">${this._formatDuration(suite.duration)}</div>
      <div class="dash-label">Duration</div>
    </div>
    <div class="dash-chart">
      ${this._renderDonut(suite)}
    </div>
  </section>

  <!-- ─── Environment ────────────────────────────────────── -->
  <section class="env-section">
    <h2 class="section-title">Environment</h2>
    <div class="env-grid">
      ${Object.entries(env).map(([k,v]) => `<div class="env-item"><span class="env-key">${this._esc(k)}</span><span class="env-val">${this._esc(v)}</span></div>`).join('')}
    </div>
  </section>

  <!-- ─── Test Cases ─────────────────────────────────────── -->
  <section class="cases-section">
    <h2 class="section-title">Test Cases</h2>
    <div class="filter-bar">
      <button class="filter-btn active" data-filter="all">All (${suite.total})</button>
      <button class="filter-btn" data-filter="passed">Passed (${suite.passed})</button>
      <button class="filter-btn" data-filter="failed">Failed (${suite.failed})</button>
      <button class="filter-btn" data-filter="skipped">Skipped (${suite.skipped})</button>
    </div>

    ${suite.cases.map(tc => this._renderTestCase(tc, screenshotMap)).join('\n')}
  </section>

  <!-- ─── Failures Summary ───────────────────────────────── -->
  ${suite.failed > 0 ? this._renderFailuresSummary(suite) : ''}

</div>
${this._renderJs()}
</body>
</html>`;
  }

  _renderTestCase(tc, screenshotMap) {
    const statusClass = tc.status === 'passed' ? 'status-pass' : tc.status === 'failed' ? 'status-fail' : 'status-skip';
    const statusIcon  = tc.status === 'passed' ? '✅' : tc.status === 'failed' ? '❌' : '⏭';

    const tdHtml = Object.keys(tc.testData).length > 0
      ? `<div class="tc-testdata"><strong>Test Data:</strong> ${Object.entries(tc.testData).slice(0, 6).map(([k,v]) =>
          `<span class="td-chip">${this._esc(k)}: ${this._esc(this._truncate(String(v), 30))}</span>`
        ).join(' ')}${Object.keys(tc.testData).length > 6 ? ` <em>+${Object.keys(tc.testData).length - 6} more</em>` : ''}</div>`
      : '';

    return `
    <div class="tc-card ${statusClass}" data-status="${tc.status}">
      <div class="tc-header" onclick="toggleCase(this)">
        <span class="tc-status">${statusIcon}</span>
        <span class="tc-name">${this._esc(tc.name)}</span>
        <span class="tc-meta">${tc.steps.length} steps · ${this._formatDuration(tc.duration)}</span>
        <span class="tc-chevron">▸</span>
      </div>
      <div class="tc-body hidden">
        <div class="tc-desc">${this._esc(tc.description)}</div>
        ${tdHtml}
        <table class="step-table">
          <thead>
            <tr>
              <th>#</th><th>Description</th><th>Element</th><th>Locator</th>
              <th>Value</th><th>Status</th><th>Duration</th><th></th>
            </tr>
          </thead>
          <tbody>
            ${tc.steps.map(s => this._renderStepRow(s, screenshotMap)).join('\n')}
          </tbody>
        </table>
      </div>
    </div>`;
  }

  _renderStepRow(step, screenshotMap) {
    const cls  = step.status === 'passed' ? 'row-pass' : 'row-fail';
    const icon = step.status === 'passed' ? '✅' : '❌';

    let errorHtml = '';
    if (step.error) {
      errorHtml = `<tr class="error-row"><td colspan="8"><div class="error-box">
        <strong>Error:</strong> ${this._esc(step.error)}
        ${step.locatorsFailed.length > 0 ? `<div class="fallback-log"><strong>Locator attempts:</strong><ul>${step.locatorsFailed.map(l => `<li>${this._esc(l)}</li>`).join('')}</ul></div>` : ''}
      </div></td></tr>`;
    }

    let screenshotHtml = '';
    if (step.screenshot && screenshotMap[step.screenshot]) {
      screenshotHtml = `<button class="ss-btn" onclick="showScreenshot('data:image/png;base64,${screenshotMap[step.screenshot]}')">📸</button>`;
    }

    return `
            <tr class="${cls}">
              <td>${step.index}</td>
              <td>${this._esc(step.description)}</td>
              <td class="cell-mono">${this._esc(step.element)}</td>
              <td class="cell-mono cell-loc">${this._esc(this._truncate(step.locator, 50))}</td>
              <td>${step.inputValue !== null ? this._esc(this._truncate(step.inputValue, 30)) : '<span class="dim">—</span>'}</td>
              <td>${icon}</td>
              <td>${step.duration}ms</td>
              <td>${screenshotHtml}</td>
            </tr>${errorHtml}`;
  }

  _renderFailuresSummary(suite) {
    const failedCases = suite.cases.filter(c => c.status === 'failed');
    return `
  <section class="failures-section">
    <h2 class="section-title section-title-fail">⚠ Failures (${failedCases.length})</h2>
    ${failedCases.map(tc => {
      const failedStep = tc.steps.find(s => s.status === 'failed');
      return `<div class="failure-card">
        <div class="failure-name">${this._esc(tc.name)}</div>
        ${failedStep ? `<div class="failure-step">Step ${failedStep.index}: ${this._esc(failedStep.description)}</div>
        <div class="failure-error">${this._esc(failedStep.error || 'Unknown error')}</div>
        ${failedStep.locatorsFailed.length > 0 ? `<div class="failure-fallback"><strong>Locator attempts:</strong><ul>${failedStep.locatorsFailed.map(l => `<li>${this._esc(l)}</li>`).join('')}</ul></div>` : ''}` : ''}
      </div>`;
    }).join('\n')}
  </section>`;
  }

  _renderDonut(suite) {
    const total = suite.total || 1;
    const pPassed  = (suite.passed / total) * 100;
    const pFailed  = (suite.failed / total) * 100;
    const pSkipped = (suite.skipped / total) * 100;
    // SVG donut
    const r = 40, cx = 50, cy = 50;
    const circ = 2 * Math.PI * r;
    const oPass  = 0;
    const oFail  = pPassed / 100 * circ;
    const oSkip  = oFail + (pFailed / 100 * circ);
    return `<svg viewBox="0 0 100 100" class="donut-chart">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#313244" stroke-width="12"/>
      ${suite.passed > 0  ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#a6e3a1" stroke-width="12" stroke-dasharray="${pPassed / 100 * circ} ${circ}" stroke-dashoffset="-${oPass}" transform="rotate(-90 ${cx} ${cy})"/>` : ''}
      ${suite.failed > 0  ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#f38ba8" stroke-width="12" stroke-dasharray="${pFailed / 100 * circ} ${circ}" stroke-dashoffset="-${oFail}" transform="rotate(-90 ${cx} ${cy})"/>` : ''}
      ${suite.skipped > 0 ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#6c7086" stroke-width="12" stroke-dasharray="${pSkipped / 100 * circ} ${circ}" stroke-dashoffset="-${oSkip}" transform="rotate(-90 ${cx} ${cy})"/>` : ''}
      <text x="${cx}" y="${cy}" text-anchor="middle" dy="0.35em" fill="#cdd6f4" font-size="14" font-weight="bold">${Math.round(pPassed)}%</text>
    </svg>`;
  }

  // ─── Embedded CSS ─────────────────────────────────────────
  _renderCss() {
    return `<style>
/* ── Catppuccin Mocha tokens ── */
:root{--crust:#11111b;--base:#1e1e2e;--mantle:#181825;--surface0:#313244;--surface1:#45475a;--surface2:#585b70;--overlay0:#6c7086;--overlay1:#7f849c;--subtext0:#a6adc8;--text:#cdd6f4;--green:#a6e3a1;--red:#f38ba8;--yellow:#f9e2af;--blue:#89b4fa;--mauve:#cba6f7;--teal:#94e2d5;--peach:#fab387;--flamingo:#f2cdcd;--rosewater:#f5e0dc;}
*{margin:0;padding:0;box-sizing:border-box;}
body{background:var(--base);color:var(--text);font-family:'Segoe UI',system-ui,-apple-system,sans-serif;line-height:1.6;min-height:100vh;}
#app{max-width:1280px;margin:0 auto;padding:24px 32px 48px;}

/* Header */
.report-header{display:flex;justify-content:space-between;align-items:center;padding:16px 0 24px;border-bottom:1px solid var(--surface0);}
.header-brand{display:flex;align-items:center;gap:12px;}
.header-brand h1{font-size:1.4rem;font-weight:600;color:var(--text);}
.header-meta{display:flex;gap:8px;}
.meta-badge{background:var(--surface0);padding:4px 12px;border-radius:6px;font-size:0.82rem;color:var(--subtext0);}

/* Dashboard */
.dashboard{display:flex;gap:16px;margin:24px 0;flex-wrap:wrap;align-items:center;}
.dash-card{background:var(--mantle);border:1px solid var(--surface0);border-radius:10px;padding:18px 24px;min-width:120px;text-align:center;}
.dash-value{font-size:2rem;font-weight:700;}
.dash-label{font-size:0.8rem;color:var(--overlay1);text-transform:uppercase;letter-spacing:0.05em;margin-top:2px;}
.dash-passed .dash-value{color:var(--green);}
.dash-failed .dash-value{color:var(--red);}
.dash-skipped .dash-value{color:var(--overlay0);}
.dash-total .dash-value{color:var(--blue);}
.dash-duration .dash-value{font-size:1.3rem;color:var(--peach);}
.dash-chart{margin-left:auto;}
.donut-chart{width:100px;height:100px;}

/* Environment */
.env-section{margin:24px 0;}
.section-title{font-size:1.1rem;font-weight:600;margin-bottom:12px;color:var(--subtext0);}
.env-grid{display:flex;flex-wrap:wrap;gap:8px 24px;}
.env-item{display:flex;gap:6px;font-size:0.82rem;}
.env-key{color:var(--overlay1);text-transform:capitalize;}
.env-key::after{content:':';}
.env-val{color:var(--text);font-family:'Cascadia Code',monospace;}

/* Filter bar */
.filter-bar{display:flex;gap:6px;margin-bottom:16px;}
.filter-btn{background:var(--surface0);border:1px solid var(--surface1);color:var(--subtext0);padding:5px 14px;border-radius:6px;cursor:pointer;font-size:0.82rem;transition:all .15s;}
.filter-btn:hover{background:var(--surface1);}
.filter-btn.active{background:var(--blue);color:var(--crust);border-color:var(--blue);font-weight:600;}

/* Test case cards */
.tc-card{background:var(--mantle);border:1px solid var(--surface0);border-radius:10px;margin-bottom:10px;overflow:hidden;transition:border-color .2s;}
.tc-card.status-pass{border-left:4px solid var(--green);}
.tc-card.status-fail{border-left:4px solid var(--red);}
.tc-card.status-skip{border-left:4px solid var(--overlay0);}
.tc-header{display:flex;align-items:center;gap:10px;padding:12px 16px;cursor:pointer;user-select:none;}
.tc-header:hover{background:var(--surface0);}
.tc-status{font-size:1.1rem;}
.tc-name{flex:1;font-weight:600;font-size:0.95rem;}
.tc-meta{font-size:0.78rem;color:var(--overlay1);}
.tc-chevron{color:var(--overlay1);transition:transform .2s;font-size:0.9rem;}
.tc-card.expanded .tc-chevron{transform:rotate(90deg);}
.tc-body{padding:0 16px 16px;border-top:1px solid var(--surface0);}
.tc-desc{font-size:0.82rem;color:var(--overlay1);margin-bottom:8px;}
.tc-testdata{font-size:0.8rem;margin-bottom:10px;}
.td-chip{background:var(--surface0);padding:2px 8px;border-radius:4px;font-family:monospace;font-size:0.78rem;margin-right:4px;display:inline-block;margin-bottom:2px;}

/* Step table */
.step-table{width:100%;border-collapse:collapse;font-size:0.82rem;}
.step-table th{text-align:left;padding:6px 8px;border-bottom:2px solid var(--surface0);color:var(--overlay1);font-weight:600;white-space:nowrap;}
.step-table td{padding:6px 8px;border-bottom:1px solid var(--surface0);}
.row-pass td{color:var(--text);}
.row-fail td{color:var(--red);background:rgba(243,139,168,0.06);}
.cell-mono{font-family:'Cascadia Code',monospace;font-size:0.76rem;}
.cell-loc{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.dim{color:var(--overlay0);}
.ss-btn{background:none;border:none;cursor:pointer;font-size:1rem;padding:2px;border-radius:4px;}
.ss-btn:hover{background:var(--surface1);}

/* Error rows */
.error-row td{padding:0 8px 8px !important;border-bottom:1px solid var(--surface0);}
.error-box{background:rgba(243,139,168,0.08);border:1px solid rgba(243,139,168,0.2);border-radius:6px;padding:10px 12px;font-size:0.8rem;color:var(--red);}
.fallback-log{margin-top:6px;color:var(--overlay1);}
.fallback-log ul{margin:4px 0 0 16px;}

/* Failures summary */
.failures-section{margin:32px 0;}
.section-title-fail{color:var(--red);}
.failure-card{background:var(--mantle);border:1px solid rgba(243,139,168,0.3);border-radius:10px;padding:14px 18px;margin-bottom:10px;}
.failure-name{font-weight:600;font-size:0.95rem;color:var(--red);}
.failure-step{font-size:0.85rem;color:var(--overlay1);margin-top:4px;}
.failure-error{font-family:monospace;font-size:0.82rem;color:var(--flamingo);margin-top:6px;background:rgba(243,139,168,0.06);padding:8px;border-radius:6px;}
.failure-fallback{font-size:0.8rem;color:var(--overlay1);margin-top:6px;}
.failure-fallback ul{margin:4px 0 0 16px;}

/* Screenshot lightbox */
.lightbox{position:fixed;inset:0;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;z-index:1000;cursor:zoom-out;}
.lightbox img{max-width:90vw;max-height:90vh;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.5);}

/* Utility */
.hidden{display:none!important;}

/* Responsive */
@media(max-width:768px){
  #app{padding:12px 16px 32px;}
  .dashboard{gap:8px;}
  .dash-card{min-width:80px;padding:12px 14px;}
  .dash-value{font-size:1.4rem;}
  .step-table{font-size:0.75rem;}
}

/* Print */
@media print{
  body{background:#fff;color:#000;}
  .tc-body{display:block!important;}
  .filter-bar,.lightbox{display:none!important;}
}
</style>`;
  }

  // ─── Embedded JS ──────────────────────────────────────────
  _renderJs() {
    return `<script>
function toggleCase(header){
  const card=header.closest('.tc-card');
  const body=card.querySelector('.tc-body');
  card.classList.toggle('expanded');
  body.classList.toggle('hidden');
}

document.querySelectorAll('.filter-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    const f=btn.dataset.filter;
    document.querySelectorAll('.tc-card').forEach(card=>{
      card.style.display=(f==='all'||card.dataset.status===f)?'':'none';
    });
  });
});

function showScreenshot(src){
  const lb=document.createElement('div');
  lb.className='lightbox';
  lb.innerHTML='<img src="'+src+'">';
  lb.addEventListener('click',()=>lb.remove());
  document.addEventListener('keydown',function esc(e){if(e.key==='Escape'){lb.remove();document.removeEventListener('keydown',esc);}});
  document.body.appendChild(lb);
}

// Auto-expand failed cases
document.querySelectorAll('.tc-card.status-fail').forEach(c=>{
  c.classList.add('expanded');
  c.querySelector('.tc-body')?.classList.remove('hidden');
});
</script>`;
  }

  // ═══════════════════════════════════════════════════════════
  //  Helpers
  // ═══════════════════════════════════════════════════════════

  _defaultReportDir() {
    return path.join(
      app && app.getPath ? app.getPath('documents') : os.homedir(),
      'TestFlow Reports',
    );
  }

  _timestamp(epoch) {
    const d = new Date(epoch);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  }

  _formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const mins = Math.floor(ms / 60000);
    const secs = Math.round((ms % 60000) / 1000);
    return `${mins}m ${secs}s`;
  }

  _truncate(str, max) {
    if (!str) return '';
    return str.length > max ? str.substring(0, max - 1) + '…' : str;
  }

  _esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  _pruneOldReports(baseDir, retainN) {
    try {
      if (!fs.existsSync(baseDir)) return;
      const entries = fs.readdirSync(baseDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
        .sort()
        .reverse();
      const toDelete = entries.slice(retainN);
      for (const dir of toDelete) {
        const full = path.join(baseDir, dir);
        fs.rmSync(full, { recursive: true, force: true });
      }
    } catch (err) {
      console.warn('[ReportEngine] Failed to prune old reports:', err.message);
    }
  }
}

module.exports = { ReportEngine };
