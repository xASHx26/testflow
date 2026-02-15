/**
 * TestFlow — Visual Cursor Overlay
 *
 * Injects a fake mouse pointer + click ripple + element highlight into the
 * target page so the user can SEE every replay action happening, like watching
 * a real Selenium session.
 *
 * API exposed on `window.__testflow_cursor`:
 *   init()                — create DOM elements (idempotent)
 *   moveTo(x, y, ms)     — smoothly move cursor to (x, y) over `ms` ms
 *   moveToElement(sel, ms) — move to center of element found by locator
 *   click()               — play a click ripple at current position
 *   highlight(sel)        — briefly highlight an element
 *   type(sel, text, ms)   — show typing caret effect
 *   hide()                — hide cursor
 *   show()                — show cursor
 *   destroy()             — tear down
 */

(function () {
  'use strict';

  // Prevent double-injection
  if (window.__testflow_cursor) return;

  // ─── State ──────────────────────────────────────────────────
  let cursorEl, rippleEl, highlightEl, tooltipEl, styleEl;
  let curX = -40, curY = -40;
  let visible = false;

  // ─── CSS ────────────────────────────────────────────────────
  const CSS = `
    /* ── Cursor ─────────────────────────────── */
    #__tf-cursor {
      position: fixed;
      top: 0; left: 0;
      width: 24px; height: 24px;
      pointer-events: none;
      z-index: 2147483647;
      transition: none;
      transform: translate(-2px, -2px);
      filter: drop-shadow(0 1px 2px rgba(0,0,0,.45));
      will-change: left, top;
    }
    #__tf-cursor.--moving {
      transition: left cubic-bezier(.4,0,.2,1), top cubic-bezier(.4,0,.2,1);
    }
    #__tf-cursor svg {
      width: 24px; height: 24px;
    }

    /* ── Click ripple ────────────────────────── */
    #__tf-ripple {
      position: fixed;
      width: 30px; height: 30px;
      border-radius: 50%;
      pointer-events: none;
      z-index: 2147483646;
      background: radial-gradient(circle, rgba(239,80,80,.55) 0%, transparent 70%);
      transform: translate(-50%, -50%) scale(0);
      opacity: 0;
      will-change: transform, opacity;
    }
    #__tf-ripple.--active {
      animation: __tf-ripple-anim .45s ease-out forwards;
    }
    @keyframes __tf-ripple-anim {
      0%   { transform: translate(-50%,-50%) scale(0); opacity: .85; }
      60%  { transform: translate(-50%,-50%) scale(2.8); opacity: .35; }
      100% { transform: translate(-50%,-50%) scale(3.6); opacity: 0; }
    }

    /* ── Element highlight ───────────────────── */
    #__tf-highlight {
      position: fixed;
      pointer-events: none;
      z-index: 2147483645;
      border: 2px solid rgba(137, 180, 250, .75);
      background: rgba(137, 180, 250, .10);
      border-radius: 4px;
      box-shadow: 0 0 8px rgba(137, 180, 250, .25);
      opacity: 0;
      transition: opacity .18s ease, top .15s ease, left .15s ease, width .15s ease, height .15s ease;
      will-change: opacity, top, left, width, height;
    }
    #__tf-highlight.--visible {
      opacity: 1;
    }

    /* ── Tooltip (action label) ──────────────── */
    #__tf-tooltip {
      position: fixed;
      pointer-events: none;
      z-index: 2147483647;
      background: rgba(30,30,46,.92);
      color: #cdd6f4;
      font: 600 11px/1.3 'Segoe UI', system-ui, sans-serif;
      padding: 4px 10px;
      border-radius: 6px;
      border: 1px solid rgba(137,180,250,.35);
      box-shadow: 0 2px 8px rgba(0,0,0,.35);
      white-space: nowrap;
      opacity: 0;
      transition: opacity .15s ease;
      will-change: opacity;
    }
    #__tf-tooltip.--visible {
      opacity: 1;
    }

    /* ── Typing caret flash ──────────────────── */
    @keyframes __tf-caret-blink {
      0%, 100% { border-right-color: rgba(239,80,80,.8); }
      50%      { border-right-color: transparent; }
    }
    .__tf-typing-caret {
      border-right: 2px solid rgba(239,80,80,.8);
      animation: __tf-caret-blink .55s step-end infinite;
    }
  `;

  // ─── SVG cursor (classic pointer arrow, red tinted) ─────────
  const CURSOR_SVG = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
      <path d="M5.4 1.2 L5.4 19.5 L10.2 14.4 L16 18.6 L18 15.6 L12.3 11.4 L19.2 10.8 Z"
            fill="#ef5050" stroke="#1e1e2e" stroke-width="1.2" stroke-linejoin="round"/>
    </svg>`;

  // ─── Helpers ────────────────────────────────────────────────
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function lerp(a, b, t) { return a + (b - a) * t; }

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function getElCenter(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function findEl(locatorJs) {
    try { return (new Function('return ' + locatorJs))(); } catch (e) { return null; }
  }

  // ─── Init ───────────────────────────────────────────────────
  function init() {
    if (document.getElementById('__tf-cursor')) return;

    styleEl = document.createElement('style');
    styleEl.textContent = CSS;
    document.head.appendChild(styleEl);

    cursorEl = document.createElement('div');
    cursorEl.id = '__tf-cursor';
    cursorEl.innerHTML = CURSOR_SVG;
    cursorEl.style.left = curX + 'px';
    cursorEl.style.top  = curY + 'px';
    cursorEl.style.display = 'none';
    document.body.appendChild(cursorEl);

    rippleEl = document.createElement('div');
    rippleEl.id = '__tf-ripple';
    document.body.appendChild(rippleEl);

    highlightEl = document.createElement('div');
    highlightEl.id = '__tf-highlight';
    document.body.appendChild(highlightEl);

    tooltipEl = document.createElement('div');
    tooltipEl.id = '__tf-tooltip';
    document.body.appendChild(tooltipEl);
  }

  // ─── Show / Hide ───────────────────────────────────────────
  function show() {
    init();
    cursorEl.style.display = 'block';
    visible = true;
  }

  function hide() {
    if (cursorEl) cursorEl.style.display = 'none';
    hideHighlight();
    hideTooltip();
    visible = false;
  }

  // ─── Move To (x, y) with eased animation ───────────────────
  async function moveTo(x, y, duration) {
    init(); show();
    duration = duration || 400;
    const startX = curX, startY = curY;
    const frames = Math.max(Math.round(duration / 16), 1);

    for (let i = 1; i <= frames; i++) {
      const t = easeInOutCubic(i / frames);
      curX = lerp(startX, x, t);
      curY = lerp(startY, y, t);
      cursorEl.style.left = curX + 'px';
      cursorEl.style.top  = curY + 'px';
      await new Promise(r => requestAnimationFrame(r));
    }
    curX = x; curY = y;
    cursorEl.style.left = curX + 'px';
    cursorEl.style.top  = curY + 'px';
  }

  // ─── Move to center of element (by locator JS expression) ──
  async function moveToElement(locatorJs, duration) {
    const el = findEl(locatorJs);
    if (!el) return false;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    await sleep(250);
    const c = getElCenter(el);
    await moveTo(c.x, c.y, duration || 400);
    return true;
  }

  // ─── Click ripple ──────────────────────────────────────────
  async function click() {
    if (!rippleEl) init();
    rippleEl.style.left = curX + 'px';
    rippleEl.style.top  = curY + 'px';
    rippleEl.classList.remove('--active');
    // force reflow
    void rippleEl.offsetWidth;
    rippleEl.classList.add('--active');

    // Brief cursor press animation
    if (cursorEl) {
      cursorEl.style.transform = 'translate(-2px,-2px) scale(.82)';
      await sleep(90);
      cursorEl.style.transform = 'translate(-2px,-2px) scale(1)';
    }

    await sleep(360);
    rippleEl.classList.remove('--active');
  }

  // ─── Highlight element ─────────────────────────────────────
  function highlightElement(locatorJs) {
    const el = findEl(locatorJs);
    if (!el || !highlightEl) return;
    const r = el.getBoundingClientRect();
    highlightEl.style.left   = (r.left - 3) + 'px';
    highlightEl.style.top    = (r.top - 3)  + 'px';
    highlightEl.style.width  = (r.width + 6) + 'px';
    highlightEl.style.height = (r.height + 6) + 'px';
    highlightEl.classList.add('--visible');
  }

  function hideHighlight() {
    if (highlightEl) highlightEl.classList.remove('--visible');
  }

  // ─── Tooltip (action label) ────────────────────────────────
  function showTooltip(text) {
    if (!tooltipEl) init();
    tooltipEl.textContent = text;
    // Position below & right of cursor
    tooltipEl.style.left = (curX + 22) + 'px';
    tooltipEl.style.top  = (curY + 22) + 'px';
    tooltipEl.classList.add('--visible');
  }

  function hideTooltip() {
    if (tooltipEl) tooltipEl.classList.remove('--visible');
  }

  // ─── Typing effect ─────────────────────────────────────────
  async function typeEffect(locatorJs, text, duration) {
    const el = findEl(locatorJs);
    if (!el) return;
    duration = duration || Math.min(text.length * 55, 1500);
    el.classList.add('__tf-typing-caret');
    el.focus();

    // Use the correct prototype setter based on element type.
    // HTMLInputElement.prototype.value setter ONLY works on <input>,
    // HTMLTextAreaElement.prototype.value setter ONLY works on <textarea>.
    // Using the wrong one throws or silently fails on React-controlled elements.
    const tag = (el.tagName || '').toLowerCase();
    const nativeSetter = tag === 'textarea'
      ? Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
      : Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;

    const perChar = duration / text.length;
    for (let i = 1; i <= text.length; i++) {
      const partial = text.substring(0, i);
      if (nativeSetter) nativeSetter.call(el, partial);
      else el.value = partial;
      // Reset React's _valueTracker so it detects the change
      const tracker = el._valueTracker;
      if (tracker) tracker.setValue(i > 1 ? text.substring(0, i - 1) : '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(perChar);
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.classList.remove('__tf-typing-caret');
  }

  // ─── Select effect — show the dropdown changing ────────────
  async function selectEffect(locatorJs, value) {
    const el = findEl(locatorJs);
    if (!el) return;
    el.focus();
    await sleep(120);

    if (el.tagName && el.tagName.toLowerCase() === 'select' && el.options) {
      // 1. Try exact value-attribute match (e.g. "1", "2")
      const byVal = Array.from(el.options).find(o => o.value === value);
      if (byVal) {
        el.value = byVal.value;
      } else {
        // 2. Try display-text match (backward compat with old recordings)
        const byText = Array.from(el.options).find(
          o => o.text.trim() === value || o.textContent.trim() === value
        );
        if (byText) el.value = byText.value;
        else el.value = value; // last resort
      }
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ─── Destroy ───────────────────────────────────────────────
  function destroy() {
    cursorEl?.remove();
    rippleEl?.remove();
    highlightEl?.remove();
    tooltipEl?.remove();
    styleEl?.remove();
    cursorEl = rippleEl = highlightEl = tooltipEl = styleEl = null;
    visible = false;
  }

  // ─── Public API ─────────────────────────────────────────────
  window.__testflow_cursor = {
    init,
    show,
    hide,
    moveTo,
    moveToElement,
    click,
    highlightElement,
    hideHighlight,
    showTooltip,
    hideTooltip,
    typeEffect,
    selectEffect,
    destroy,
  };
})();
