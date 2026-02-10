/**
 * TestFlow — IPC Handlers
 * 
 * Central IPC bridge between renderer process and main process services.
 * All renderer→main communication flows through here.
 */

const { ipcMain, dialog } = require('electron');
const path = require('path');

function registerIpcHandlers(context) {
  const {
    windowManager,
    projectManager,
    browserEngine,
    recorderEngine,
    replayEngine,
    locatorEngine,
    flowEngine,
    screenshotService,
    freezeService,
    exportEngine,
    shareService,
    authService,
  } = context;

  // ─── Project Management ──────────────────────────────────────
  ipcMain.handle('project:new', async (event, name) => {
    const defaultName = name || 'My Project';
    const result = await dialog.showSaveDialog(windowManager.getMainWindow(), {
      title: 'Create New TestFlow Project',
      defaultPath: `${defaultName}.taf`,
      filters: [
        { name: 'TestFlow Project', extensions: ['taf'] },
      ],
    });
    if (result.canceled || !result.filePath) return null;

    // Derive project name from chosen filename
    const projectName = path.basename(result.filePath, '.taf');
    const project = projectManager.createProject(projectName, result.filePath);

    // Persist any in-memory flows (recorded before project was created)
    const persisted = flowEngine.persistAllFlows();
    if (persisted > 0) {
      console.log(`[TestFlow] Persisted ${persisted} in-memory flow(s) to new project`);
    }

    return project;
  });

  ipcMain.handle('project:open', async () => {
    const result = await dialog.showOpenDialog(windowManager.getMainWindow(), {
      title: 'Open TestFlow Project',
      filters: [
        { name: 'TestFlow Project', extensions: ['taf'] },
      ],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths.length) return null;
    const project = projectManager.openProject(result.filePaths[0]);

    // Persist any in-memory flows
    const persisted = flowEngine.persistAllFlows();
    if (persisted > 0) {
      console.log(`[TestFlow] Persisted ${persisted} in-memory flow(s) to opened project`);
    }

    return project;
  });

  ipcMain.handle('project:save', async () => {
    return projectManager.saveProject();
  });

  ipcMain.handle('project:getInfo', async () => {
    return projectManager.getProjectInfo();
  });

  // ─── Browser Engine ──────────────────────────────────────────
  ipcMain.handle('browser:navigate', async (event, url) => {
    return browserEngine.navigate(url);
  });

  ipcMain.handle('browser:back', async () => {
    return browserEngine.goBack();
  });

  ipcMain.handle('browser:forward', async () => {
    return browserEngine.goForward();
  });

  ipcMain.handle('browser:reload', async () => {
    return browserEngine.reload();
  });

  ipcMain.handle('browser:getUrl', async () => {
    return browserEngine.getCurrentUrl();
  });

  ipcMain.handle('browser:attachView', async (event, bounds) => {
    return browserEngine.attachView(bounds);
  });

  ipcMain.handle('browser:updateBounds', async (event, bounds) => {
    browserEngine.updateBounds(bounds);
    return true;
  });

  // ─── Test Session Tracking (gates network capture) ──────────
  let testSessionActive = false;

  // ─── Recorder Engine ─────────────────────────────────────────
  ipcMain.handle('recorder:start', async (event, flowId) => {
    return recorderEngine.startRecording(flowId);
  });

  ipcMain.handle('recorder:stop', async () => {
    const result = await recorderEngine.stopRecording();
    // Forward the generated test case to the renderer
    if (result.testCase) {
      windowManager.sendToRenderer('testcase:generated', result.testCase);
    }
    return result;
  });

  ipcMain.handle('recorder:pause', async () => {
    return recorderEngine.pauseRecording();
  });

  ipcMain.handle('recorder:resume', async () => {
    return recorderEngine.resumeRecording();
  });

  ipcMain.handle('recorder:getState', async () => {
    return recorderEngine.getState();
  });

  // Forward recorded actions to renderer
  ipcMain.on('recorder:action', (event, action) => {
    windowManager.sendToRenderer('recorder:action-recorded', action);
  });

  // ─── Replay Engine ───────────────────────────────────────────
  ipcMain.handle('replay:start', async (event, flowId) => {
    const id = flowId || flowEngine.getActiveFlowId();
    if (!id) {
      return { success: false, message: 'No flow selected for replay' };
    }
    const flow = flowEngine.getFlow(id);
    if (!flow) {
      return { success: false, message: `Flow not found: ${id}` };
    }
    testSessionActive = true;
    windowManager.sendToRenderer('network:clear');
    return replayEngine.startReplay(flow);
  });

  ipcMain.handle('replay:stop', async () => {
    testSessionActive = false;
    const result = replayEngine.stopReplay();
    windowManager.sendToRenderer('network:clear');
    return result;
  });

  ipcMain.handle('replay:stepOver', async () => {
    return replayEngine.stepOver();
  });

  ipcMain.handle('replay:getState', async () => {
    return replayEngine.getState();
  });

  // Replay a specific test case (edited JSON)
  ipcMain.handle('replay:testcase', async (event, testCase) => {
    testSessionActive = true;
    windowManager.sendToRenderer('network:clear');
    return replayEngine.replayTestCase(testCase);
  });

  // Forward replay progress to renderer
  replayEngine?.on?.('step-started', (data) => {
    windowManager.sendToRenderer('replay:step-started', data);
  });

  replayEngine?.on?.('step-completed', (data) => {
    windowManager.sendToRenderer('replay:step-completed', data);
  });

  replayEngine?.on?.('step-complete', (result) => {
    windowManager.sendToRenderer('replay:step-complete', result);
  });

  replayEngine?.on?.('replay-started', (data) => {
    windowManager.sendToRenderer('replay:started', data);
  });

  replayEngine?.on?.('replay-finished', (data) => {
    testSessionActive = false;
    windowManager.sendToRenderer('replay:finished', data);
    // Clear network after test completes — next test starts fresh
    windowManager.sendToRenderer('network:clear');
  });

  replayEngine?.on?.('replay-error', (data) => {
    testSessionActive = false;
    windowManager.sendToRenderer('replay:error', data);
    windowManager.sendToRenderer('network:clear');
  });

  // ─── Locator Engine ──────────────────────────────────────────
  ipcMain.handle('locator:generate', async (event, elementData) => {
    return locatorEngine.generateLocators(elementData);
  });

  ipcMain.handle('locator:rank', async (event, locators) => {
    return locatorEngine.rankLocators(locators);
  });

  ipcMain.handle('locator:validate', async (event, locator) => {
    return browserEngine.validateLocator(locator);
  });

  // ─── Flow Engine ─────────────────────────────────────────────
  ipcMain.handle('flow:create', async (event, name) => {
    return flowEngine.createFlow(name);
  });

  ipcMain.handle('flow:getAll', async () => {
    return flowEngine.getAllFlows();
  });

  ipcMain.handle('flow:get', async (event, flowId) => {
    return flowEngine.getFlow(flowId);
  });

  ipcMain.handle('flow:addStep', async (event, flowId, step) => {
    return flowEngine.addStep(flowId, step);
  });

  ipcMain.handle('flow:updateStep', async (event, flowId, stepId, updates) => {
    return flowEngine.updateStep(flowId, stepId, updates);
  });

  ipcMain.handle('flow:removeStep', async (event, flowId, stepId) => {
    return flowEngine.removeStep(flowId, stepId);
  });

  ipcMain.handle('flow:reorderSteps', async (event, flowId, orderedStepIds) => {
    return flowEngine.reorderSteps(flowId, orderedStepIds);
  });

  ipcMain.handle('flow:toggleStep', async (event, flowId, stepId, enabled) => {
    return flowEngine.toggleStep(flowId, stepId, enabled);
  });

  ipcMain.handle('flow:delete', async (event, flowId) => {
    return flowEngine.deleteFlow(flowId);
  });

  ipcMain.handle('flow:rename', async (event, flowId, newName) => {
    return flowEngine.renameFlow(flowId, newName);
  });

  ipcMain.handle('flow:setActive', async (event, flowId) => {
    flowEngine.setActiveFlow(flowId);
    return true;
  });

  // ─── Screenshot Service ──────────────────────────────────────
  ipcMain.handle('screenshot:capture', async (event, options) => {
    return screenshotService.capture(browserEngine, options);
  });

  ipcMain.handle('screenshot:captureElement', async (event, selector, options) => {
    return screenshotService.captureElement(browserEngine, selector, options);
  });

  // ─── Freeze Mode ─────────────────────────────────────────────
  ipcMain.handle('freeze:toggle', async () => {
    return freezeService.toggle(browserEngine);
  });

  ipcMain.handle('freeze:getState', async () => {
    return freezeService.isFrozen();
  });

  // ─── Element Inspector ───────────────────────────────────────
  ipcMain.handle('inspector:enable', async () => {
    return browserEngine.enableInspector();
  });

  ipcMain.handle('inspector:disable', async () => {
    return browserEngine.disableInspector();
  });

  ipcMain.handle('inspector:getElementInfo', async (event, point) => {
    return browserEngine.getElementAt(point);
  });

  // Forward inspector hover/select events to renderer
  ipcMain.on('inspector:element-hovered', (event, data) => {
    windowManager.sendToRenderer('inspector:element-hovered', data);
  });

  ipcMain.on('inspector:element-selected', (event, data) => {
    windowManager.sendToRenderer('inspector:element-selected', data);
  });

  // ─── Mini Inspector ──────────────────────────────────────────
  ipcMain.handle('mini-inspector:toggle', async () => {
    if (windowManager.miniInspectorWindow) {
      windowManager.closeMiniInspectorWindow();
      return false;
    } else {
      windowManager.createMiniInspectorWindow();
      return true;
    }
  });

  // ─── Export Engine ───────────────────────────────────────────

  /**
   * Safely resolve a flow by ID, returning null if not found or no project open.
   */
  function _resolveFlow(flowId) {
    try {
      if (!flowId) return null;
      if (!projectManager.getProjectPath()) return null;
      return flowEngine.getFlow(flowId) || null;
    } catch (_) {
      return null;
    }
  }

  ipcMain.handle('export:validate', async (event, flowId) => {
    const flow = _resolveFlow(flowId);
    if (!flow) return { valid: false, errors: ['No flow selected or no project open.'], warnings: [] };
    return exportEngine.validate(flow);
  });

  ipcMain.handle('export:selenium-python', async (event, flowId, options) => {
    const flow = _resolveFlow(flowId);
    if (!flow) return null;

    // Selenium export produces multiple files — pick a directory
    const result = await dialog.showOpenDialog(windowManager.getMainWindow(), {
      title: 'Choose Export Directory for Selenium Python',
      properties: ['openDirectory', 'createDirectory'],
    });

    if (result.canceled || !result.filePaths.length) return null;
    return exportEngine.exportSeleniumPython(flow, result.filePaths[0], options || {});
  });

  ipcMain.handle('export:markdown', async (event, flowId) => {
    const flow = _resolveFlow(flowId);
    if (!flow) return null;

    const result = await dialog.showSaveDialog(windowManager.getMainWindow(), {
      title: 'Export Markdown Report',
      defaultPath: `${flow.name.toLowerCase().replace(/\s+/g, '_')}_report.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });

    if (result.canceled) return null;
    return exportEngine.exportMarkdown(flow, result.filePath);
  });

  ipcMain.handle('export:json', async (event, flowId) => {
    const flow = _resolveFlow(flowId);
    if (!flow) return null;

    const result = await dialog.showSaveDialog(windowManager.getMainWindow(), {
      title: 'Export Flow as JSON',
      defaultPath: `${flow.name.toLowerCase().replace(/\s+/g, '_')}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });

    if (result.canceled) return null;
    return exportEngine.exportJSON(flow, result.filePath);
  });

  // ─── Share Service ───────────────────────────────────────────
  ipcMain.handle('share:package', async (event, mode) => {
    const result = await dialog.showSaveDialog(windowManager.getMainWindow(), {
      title: 'Save TestFlow Package',
      defaultPath: `project.tfpkg`,
      filters: [{ name: 'TestFlow Package', extensions: ['tfpkg'] }],
    });

    if (result.canceled) return null;
    return shareService.createPackage(
      projectManager.getProjectDir(),
      result.filePath,
      mode
    );
  });

  ipcMain.handle('share:import', async () => {
    const result = await dialog.showOpenDialog(windowManager.getMainWindow(), {
      title: 'Import TestFlow Package',
      filters: [{ name: 'TestFlow Package', extensions: ['tfpkg'] }],
      properties: ['openFile'],
    });

    if (result.canceled) return null;
    return shareService.importPackage(result.filePaths[0]);
  });

  // ─── Browser navigation tracking ───────────────────────────
  browserEngine.on('navigated', (url) => {
    windowManager.sendToRenderer('browser:navigated', url);
  });

  // ─── Console Logs ────────────────────────────────────────────
  ipcMain.on('console:log', (event, data) => {
    windowManager.sendToRenderer('console:log', data);
  });

  // ─── Network Logs ────────────────────────────────────────────
  // Only forward network traffic during recording or replay sessions
  browserEngine.on('network-response', (data) => {
    if (testSessionActive) {
      windowManager.sendToRenderer('network:request', data);
    }
  });

  // ─── Workspace Presets ───────────────────────────────────────
  ipcMain.handle('workspace:setPreset', async (event, preset) => {
    windowManager.sendToRenderer('workspace:preset-changed', preset);
    return true;
  });
}

module.exports = { registerIpcHandlers };
