/**
 * TestFlow — Screenshot Service
 * 
 * Captures screenshots from the embedded browser (full page or element).
 * Links them to steps and generates references for Markdown.
 */

const path = require('path');

class ScreenshotService {
  constructor(projectManager) {
    this.projectManager = projectManager;
  }

  /**
   * Capture a full-page screenshot
   */
  async capture(browserEngine, options = {}) {
    const buffer = await browserEngine.captureScreenshot();
    const name = options.name || this._generateName(browserEngine.getCurrentUrl());
    const absolutePath = this.projectManager.saveScreenshot(buffer, name);

    return {
      path: absolutePath,
      absolutePath,
      name,
      timestamp: Date.now(),
      url: browserEngine.getCurrentUrl(),
      stepId: options.stepId || null,
    };
  }

  /**
   * Capture a screenshot of a specific element
   */
  async captureElement(browserEngine, selector, options = {}) {
    // Execute script to get element bounds, then crop
    const bounds = await browserEngine.executeScript(`
      (() => {
        const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        };
      })()
    `);

    if (!bounds) throw new Error('Element not found for screenshot');

    // For now, capture full page (element cropping can be added with sharp/jimp)
    return this.capture(browserEngine, options);
  }

  /**
   * Generate a screenshot name from URL
   */
  _generateName(url) {
    try {
      const parsed = new URL(url);
      const pathname = parsed.pathname.replace(/\//g, '_').replace(/^_/, '') || 'index';
      return `${parsed.hostname}_${pathname}`.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 60);
    } catch {
      return `screenshot_${Date.now()}`;
    }
  }
}

module.exports = { ScreenshotService };
