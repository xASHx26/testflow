/**
 * TestFlow — Project Manager
 * 
 * Handles project creation, opening, saving, and file management.
 * Projects are stored as a directory with a `.testflow` manifest.
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const PROJECT_MANIFEST = '.testflow';
const FLOWS_DIR = 'flows';
const SCREENSHOTS_DIR = 'screenshots';
const EXPORTS_DIR = 'exports';
const DATA_DIR = 'data';

class ProjectManager {
  constructor() {
    this.currentProject = null;
    this.projectPath = null;
  }

  /**
   * Create a new TestFlow project at the given directory
   */
  createProject(name, basePath) {
    const projectDir = path.join(basePath, name);

    // Create directory structure
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(path.join(projectDir, FLOWS_DIR), { recursive: true });
    fs.mkdirSync(path.join(projectDir, SCREENSHOTS_DIR), { recursive: true });
    fs.mkdirSync(path.join(projectDir, EXPORTS_DIR), { recursive: true });
    fs.mkdirSync(path.join(projectDir, DATA_DIR), { recursive: true });

    const manifest = {
      id: uuidv4(),
      name,
      version: '1.0.0',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      testflowVersion: '1.0.0-alpha',
      settings: {
        defaultBrowserWidth: 1280,
        defaultBrowserHeight: 720,
        screenshotFormat: 'png',
        locatorStrategy: 'auto',
        replayTimeout: 10000,
        replaySlowMo: 0,
      },
      flows: [],
      metadata: {
        author: '',
        description: '',
        tags: [],
      },
      sharing: {
        mode: null,
        role: 'owner',
        permissions: {
          canRecord: true,
          canEdit: true,
          canExport: true,
          canReplay: true,
        },
      },
    };

    fs.writeFileSync(
      path.join(projectDir, PROJECT_MANIFEST),
      JSON.stringify(manifest, null, 2),
      'utf-8'
    );

    this.currentProject = manifest;
    this.projectPath = projectDir;

    return { project: manifest, path: projectDir };
  }

  /**
   * Open an existing TestFlow project
   */
  openProject(projectDir) {
    const manifestPath = path.join(projectDir, PROJECT_MANIFEST);

    if (!fs.existsSync(manifestPath)) {
      throw new Error('Not a valid TestFlow project: missing .testflow manifest');
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    this.currentProject = manifest;
    this.projectPath = projectDir;

    return { project: manifest, path: projectDir };
  }

  /**
   * Save the current project manifest and all dirty data
   */
  saveProject() {
    if (!this.currentProject || !this.projectPath) {
      throw new Error('No project is currently open');
    }

    this.currentProject.modified = new Date().toISOString();

    fs.writeFileSync(
      path.join(this.projectPath, PROJECT_MANIFEST),
      JSON.stringify(this.currentProject, null, 2),
      'utf-8'
    );

    return true;
  }

  /**
   * Get the project info
   */
  getProjectInfo() {
    return this.currentProject
      ? { project: this.currentProject, path: this.projectPath }
      : null;
  }

  /**
   * Get project directory path
   */
  getProjectPath() {
    return this.projectPath;
  }

  /**
   * Get a subdirectory path within the project
   */
  getSubDir(subdir) {
    if (!this.projectPath) return null;
    return path.join(this.projectPath, subdir);
  }

  /**
   * Save a flow JSON to the project
   */
  saveFlow(flow) {
    if (!this.projectPath) throw new Error('No project open');
    const flowPath = path.join(this.projectPath, FLOWS_DIR, `${flow.id}.json`);
    fs.writeFileSync(flowPath, JSON.stringify(flow, null, 2), 'utf-8');

    // Update manifest flow references
    const idx = this.currentProject.flows.findIndex(f => f.id === flow.id);
    const flowRef = { id: flow.id, name: flow.name, modified: new Date().toISOString() };
    if (idx >= 0) {
      this.currentProject.flows[idx] = flowRef;
    } else {
      this.currentProject.flows.push(flowRef);
    }

    this.saveProject();
    return flowPath;
  }

  /**
   * Load a flow by ID
   */
  loadFlow(flowId) {
    if (!this.projectPath) throw new Error('No project open');
    const flowPath = path.join(this.projectPath, FLOWS_DIR, `${flowId}.json`);
    if (!fs.existsSync(flowPath)) return null;
    return JSON.parse(fs.readFileSync(flowPath, 'utf-8'));
  }

  /**
   * Delete a flow by ID
   */
  deleteFlow(flowId) {
    if (!this.projectPath) throw new Error('No project open');
    const flowPath = path.join(this.projectPath, FLOWS_DIR, `${flowId}.json`);
    if (fs.existsSync(flowPath)) {
      fs.unlinkSync(flowPath);
    }
    this.currentProject.flows = this.currentProject.flows.filter(f => f.id !== flowId);
    this.saveProject();
    return true;
  }

  /**
   * List all flow files in the project
   */
  listFlows() {
    if (!this.projectPath) return [];
    const flowsDir = path.join(this.projectPath, FLOWS_DIR);
    if (!fs.existsSync(flowsDir)) return [];

    return fs.readdirSync(flowsDir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const data = JSON.parse(fs.readFileSync(path.join(flowsDir, f), 'utf-8'));
        return { id: data.id, name: data.name, stepCount: data.steps?.length || 0 };
      });
  }

  /**
   * Save screenshot binary and return relative path
   */
  saveScreenshot(buffer, name) {
    if (!this.projectPath) throw new Error('No project open');
    const screenshotDir = path.join(this.projectPath, SCREENSHOTS_DIR);
    const filename = `${name}_${Date.now()}.png`;
    const filepath = path.join(screenshotDir, filename);
    fs.writeFileSync(filepath, buffer);
    return path.join(SCREENSHOTS_DIR, filename);
  }

  /**
   * Save test data file
   */
  saveTestData(flowId, testData) {
    if (!this.projectPath) throw new Error('No project open');
    const dataPath = path.join(this.projectPath, DATA_DIR, `${flowId}_data.json`);
    fs.writeFileSync(dataPath, JSON.stringify(testData, null, 2), 'utf-8');
    return dataPath;
  }
}

module.exports = { ProjectManager };
