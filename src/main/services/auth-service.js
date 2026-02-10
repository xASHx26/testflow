/**
 * TestFlow — Auth Service (Stub — Post-MVP)
 * 
 * Placeholder for offline authorization and access control.
 * Architecture is in place for token-based authorization without login.
 */

class AuthService {
  constructor() {
    this.enabled = false; // Disabled in MVP
    this.currentToken = null;
  }

  /**
   * Check if auth is enabled
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * Validate an authorization token (future)
   */
  validateToken(token) {
    if (!this.enabled) return { valid: true, role: 'owner' };

    // Future implementation:
    // - Verify JWT/signed token
    // - Check expiration
    // - Extract role and permissions
    // - Validate machine/user binding

    return { valid: true, role: 'owner' };
  }

  /**
   * Get current user role
   */
  getCurrentRole() {
    if (!this.enabled) return 'owner';
    return this.currentToken?.role || 'viewer';
  }

  /**
   * Check if current role has a specific permission
   */
  hasPermission(permission) {
    if (!this.enabled) return true;

    const rolePermissions = {
      owner: ['record', 'edit', 'export', 'replay', 'share', 'manage'],
      recorder: ['record', 'edit', 'replay'],
      viewer: ['replay', 'view'],
    };

    const role = this.getCurrentRole();
    return rolePermissions[role]?.includes(permission) || false;
  }

  /**
   * Generate an authorization token (future — owner only)
   */
  generateToken(options = {}) {
    // Future implementation
    return {
      token: 'placeholder',
      role: options.role || 'viewer',
      expires: options.expires || null,
      machine: options.machine || null,
    };
  }

  /**
   * Revoke a token (future)
   */
  revokeToken(tokenId) {
    // Future implementation
    return true;
  }
}

module.exports = { AuthService };
