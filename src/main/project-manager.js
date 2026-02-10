/**
 * TestFlow — Project Manager
 * 
 * Handles project creation, opening, saving, and file management.
 * Projects use the .taf (TestFlow Automation File) format:
 *   - project.taf           — JSON manifest with project metadata
 *   - project_data/         — companion directory (sibling)
 *       ├── flows/           — recorded flow JSON files
 *       ├── screenshots/     — captured screenshots
 *       ├── exports/         — exported test scripts
 *       └── data/            — test data files
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const FLOWS_DIR = 'flows';
const SCREENSHOTS_DIR = 'screenshots';
const EXPORTS_DIR = 'exports';
const DATA_DIR = 'data';

class ProjectManager {
  constructor() {
    this.currentProject = null;
    this.projectPath = null;   // path to the .taf file
    this.projectDir = null;    // path to the companion _data directory
  }

  /**
   * Create a new TestFlow project.
   * @param {string} name - Project name
   * @param {string} tafFilePath - Full path to the .taf file chosen by Save dialog
   */
  createProject(name, tafFilePath) {
    // Ensure the file ends with .taf
    if (!tafFilePath.endsWith('.taf')) {
      tafFilePath += '.taf';
    }

    // Companion data directory sits beside the .taf file
    const baseName = path.basename(tafFilePath, '.taf');
    const parentDir = path.dirname(tafFilePath);
    const dataDir = path.join(parentDir, `${baseName}_data`);

    // Create companion directory structure
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(path.join(dataDir, FLOWS_DIR), { recursive: true });
    fs.mkdirSync(path.join(dataDir, SCREENSHOTS_DIR), { recursive: true });
    fs.mkdirSync(path.join(dataDir, EXPORTS_DIR), { recursive: true });
    fs.mkdirSync(path.join(dataDir, DATA_DIR), { recursive: true });

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

    // Write the .taf manifest
    fs.writeFileSync(tafFilePath, JSON.stringify(manifest, null, 2), 'utf-8');

    this.currentProject = manifest;
    this.projectPath = tafFilePath;
    this.projectDir = dataDir;

    return { project: manifest, path: tafFilePath };
  }

  /**
   * Open an existing TestFlow project from a .taf file
   * @param {string} tafFilePath - Full path to the .taf file
   */
  openProject(tafFilePath) {
    if (!fs.existsSync(tafFilePath)) {
      throw new Error(`Project file not found: ${tafFilePath}`);
    }

    const manifest = JSON.parse(fs.readFileSync(tafFilePath, 'utf-8'));

    // Resolve companion data directory
    const baseName = path.basename(tafFilePath, '.taf');
    const parentDir = path.dirname(tafFilePath);
    const dataDir = path.join(parentDir, `${baseName}_data`);

    // Create companion directories if they don't exist (e.g. migrating old project)
    fs.mkdirSync(path.join(dataDir, FLOWS_DIR), { recursive: true });
    fs.mkdirSync(path.join(dataDir, SCREENSHOTS_DIR), { recursive: true });
    fs.mkdirSync(path.join(dataDir, EXPORTS_DIR), { recursive: true });
    fs.mkdirSync(path.join(dataDir, DATA_DIR), { recursive: true });

    this.currentProject = manifest;
    this.projectPath = tafFilePath;
    this.projectDir = dataDir;

    return { project: manifest, path: tafFilePath };
  }

  /**
   * Save the current project manifest
   */
  saveProject() {
    if (!this.currentProject || !this.projectPath) {
      throw new Error('No project is currently open');
    }

    this.currentProject.modified = new Date().toISOString();

    fs.writeFileSync(
      this.projectPath,
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
   * Get project file path (.taf file)
   */
  getProjectPath() {
    return this.projectPath;
  }

  /**
   * Get the companion data directory path
   */
  getProjectDir() {
    return this.projectDir;
  }

  /**
   * Get a subdirectory path within the project data directory
   */
  getSubDir(subdir) {
    if (!this.projectDir) return null;
    return path.join(this.projectDir, subdir);
  }

  /**
   * Save a flow JSON to the project
   */
  saveFlow(flow) {
    if (!this.projectDir) throw new Error('No project open');
    const flowPath = path.join(this.projectDir, FLOWS_DIR, `${flow.id}.json`);
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
    if (!this.projectDir) throw new Error('No project open');
    const flowPath = path.join(this.projectDir, FLOWS_DIR, `${flowId}.json`);
    if (!fs.existsSync(flowPath)) return null;
    return JSON.parse(fs.readFileSync(flowPath, 'utf-8'));
  }

  /**
   * Delete a flow by ID
   */
  deleteFlow(flowId) {
    if (!this.projectDir) throw new Error('No project open');
    const flowPath = path.join(this.projectDir, FLOWS_DIR, `${flowId}.json`);
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
    if (!this.projectDir) return [];
    const flowsDir = path.join(this.projectDir, FLOWS_DIR);
    if (!fs.existsSync(flowsDir)) return [];

    return fs.readdirSync(flowsDir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(flowsDir, f), 'utf-8'));
          return { id: data.id, name: data.name, stepCount: data.steps?.length || 0 };
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean);
  }

  /**
   * Save screenshot binary and return relative path
   */
  saveScreenshot(buffer, name) {
    if (!this.projectDir) throw new Error('No project open');
    const screenshotDir = path.join(this.projectDir, SCREENSHOTS_DIR);
    const filename = `${name}_${Date.now()}.png`;
    const filepath = path.join(screenshotDir, filename);
    fs.writeFileSync(filepath, buffer);
    return filepath;
  }

  /**
   * Save test data file
   */
  saveTestData(flowId, testData) {
    if (!this.projectDir) throw new Error('No project open');
    const dataPath = path.join(this.projectDir, DATA_DIR, `${flowId}_data.json`);
    fs.writeFileSync(dataPath, JSON.stringify(testData, null, 2), 'utf-8');
    return dataPath;
  }
}

module.exports = { ProjectManager };
