/**
 * TestFlow — Share Service
 * 
 * Handles project sharing via signed packages (.tfpkg).
 * Supports View (read-only) and Edit (collaborative) modes.
 */

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const extractZip = require('extract-zip');
const crypto = require('crypto');

class ShareService {
  constructor() {
    this.PACKAGE_EXTENSION = '.tfpkg';
  }

  /**
   * Create a shareable package from a project directory
   * @param {string} projectPath - Path to the project directory
   * @param {string} outputPath - Path to save the package
   * @param {string} mode - 'view' or 'edit'
   */
  async createPackage(projectPath, outputPath, mode = 'view') {
    if (!projectPath || !fs.existsSync(projectPath)) {
      throw new Error('Project path does not exist');
    }

    // Build sharing manifest
    const shareManifest = {
      packageVersion: '1.0',
      mode,
      created: new Date().toISOString(),
      permissions: this._getPermissions(mode),
      signature: null, // Will be set after packaging
    };

    // Write temporary share manifest
    const shareManifestPath = path.join(projectPath, '.testflow-share');
    fs.writeFileSync(shareManifestPath, JSON.stringify(shareManifest, null, 2), 'utf-8');

    // Create ZIP archive
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(outputPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => {
        // Sign the package
        const hash = this._signPackage(outputPath);
        shareManifest.signature = hash;
        fs.writeFileSync(shareManifestPath, JSON.stringify(shareManifest, null, 2), 'utf-8');

        resolve({
          path: outputPath,
          size: archive.pointer(),
          mode,
          signature: hash,
        });
      });

      archive.on('error', reject);
      archive.pipe(output);

      // Add project files
      archive.directory(path.join(projectPath, 'flows'), 'flows');
      archive.directory(path.join(projectPath, 'screenshots'), 'screenshots');
      archive.directory(path.join(projectPath, 'data'), 'data');
      archive.file(path.join(projectPath, '.testflow'), { name: '.testflow' });
      archive.file(shareManifestPath, { name: '.testflow-share' });

      archive.finalize();
    });
  }

  /**
   * Import a shared package
   */
  async importPackage(packagePath) {
    if (!fs.existsSync(packagePath)) {
      throw new Error('Package file does not exist');
    }

    // Extract to a temporary directory first
    const tempDir = path.join(path.dirname(packagePath), `.testflow_import_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    try {
      await extractZip(packagePath, { dir: tempDir });

      // Read share manifest
      const shareManifestPath = path.join(tempDir, '.testflow-share');
      const shareManifest = fs.existsSync(shareManifestPath)
        ? JSON.parse(fs.readFileSync(shareManifestPath, 'utf-8'))
        : { mode: 'view', permissions: this._getPermissions('view') };

      // Read project manifest
      const projectManifestPath = path.join(tempDir, '.testflow');
      if (!fs.existsSync(projectManifestPath)) {
        throw new Error('Invalid TestFlow package: missing .testflow manifest');
      }

      const projectManifest = JSON.parse(fs.readFileSync(projectManifestPath, 'utf-8'));

      // Apply sharing permissions to the project manifest
      projectManifest.sharing = {
        mode: shareManifest.mode,
        role: shareManifest.mode === 'edit' ? 'recorder' : 'viewer',
        permissions: shareManifest.permissions,
        imported: true,
        importedAt: new Date().toISOString(),
        originalPackage: path.basename(packagePath),
      };

      fs.writeFileSync(projectManifestPath, JSON.stringify(projectManifest, null, 2), 'utf-8');

      return {
        path: tempDir,
        project: projectManifest,
        mode: shareManifest.mode,
        permissions: shareManifest.permissions,
      };
    } catch (error) {
      // Cleanup on failure
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
      throw error;
    }
  }

  /**
   * Get permissions for a sharing mode
   */
  _getPermissions(mode) {
    switch (mode) {
      case 'view':
        return {
          canRecord: false,
          canEdit: false,
          canExport: false,
          canReplay: true,
          canViewFlows: true,
          canViewScreenshots: true,
          canViewLocators: true,
          canViewConsole: true,
          canViewNetwork: true,
        };
      case 'edit':
        return {
          canRecord: true,
          canEdit: true,
          canExport: false, // Only owner can export
          canReplay: true,
          canViewFlows: true,
          canViewScreenshots: true,
          canViewLocators: true,
          canViewConsole: true,
          canViewNetwork: true,
        };
      default:
        return this._getPermissions('view');
    }
  }

  /**
   * Generate a signature hash for a package file
   */
  _signPackage(filePath) {
    const data = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Verify a package signature
   */
  verifyPackage(filePath, expectedSignature) {
    const hash = this._signPackage(filePath);
    return hash === expectedSignature;
  }
}

module.exports = { ShareService };
