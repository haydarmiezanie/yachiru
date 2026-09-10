import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { generateFirestoreRules } from '../scripts/generateRules.js';

describe('P0-1, P0-2, P0-4: Firestore Rules Privilege Escalation & Templating Tests', () => {
  const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
  const templatePath = path.resolve(process.cwd(), 'firestore.rules.template');

  it('verifies firestore.rules and template exist', () => {
    expect(fs.existsSync(rulesPath)).toBe(true);
    expect(fs.existsSync(templatePath)).toBe(true);
  });

  describe('Static Rule Audit (P0-1 & P0-2 Prevention)', () => {
    const rulesContent = fs.readFileSync(rulesPath, 'utf8');

    it('does NOT contain vulnerable self-elevation or self-approval branches on users/{userId}', () => {
      // Must NOT contain the branch allowing role in ['viewer','auditor'] and status in ['pending','approved']
      expect(rulesContent).not.toContain("request.resource.data.role in ['viewer', 'auditor']");
      expect(rulesContent).not.toContain("request.resource.data.status in ['pending', 'approved']");
      expect(rulesContent).not.toContain("request.resource.data.role in ['viewer','auditor']");
      expect(rulesContent).not.toContain("request.resource.data.status in ['pending','approved']");
    });

    it('strictly enforces role == "viewer" && status == "pending" for user self-registration', () => {
      expect(rulesContent).toContain("(request.resource.data.role == 'viewer' && request.resource.data.status == 'pending')");
    });

    it('strictly prevents non-admin users from changing role or status during updates', () => {
      expect(rulesContent).toContain("request.resource.data.role == resource.data.role");
      expect(rulesContent).toContain("request.resource.data.status == resource.data.status");
    });

    it('strictly prevents self-approval in access_requests by requiring status == "pending" on create (P0-2)', () => {
      // Must enforce status == 'pending' on create
      expect(rulesContent).toContain("request.resource.data.status == 'pending'");
      // Update must remain admin only
      expect(rulesContent).toMatch(/allow update.*if isAdmin\(\)/);
    });
  });

  describe('Rule Logic Semantic Evaluation (Simulating Firestore Engine)', () => {
    // Evaluator helper representing firestore.rules logic
    function evaluateUsersCreate(params: {
      auth: { uid: string; email?: string } | null;
      targetUserId: string;
      docData: { role: string; status: string };
      superAdminEmail: string;
      userIsAdmin: boolean;
    }): boolean {
      const { auth, targetUserId, docData, superAdminEmail, userIsAdmin } = params;
      if (!auth) return false;

      const isSuperAdmin = auth.email === superAdminEmail;
      const isAdmin = isSuperAdmin || userIsAdmin;
      if (isAdmin) return true;

      const isOwner = auth.uid === targetUserId;
      if (isOwner) {
        if (isSuperAdmin) return true;
        if (docData.role === 'viewer' && docData.status === 'pending') {
          return true;
        }
      }
      return false;
    }

    function evaluateUsersUpdate(params: {
      auth: { uid: string; email?: string } | null;
      targetUserId: string;
      existingDoc: { role: string; status: string };
      newDoc: { role: string; status: string };
      superAdminEmail: string;
      userIsAdmin: boolean;
    }): boolean {
      const { auth, targetUserId, existingDoc, newDoc, superAdminEmail, userIsAdmin } = params;
      if (!auth) return false;

      const isSuperAdmin = auth.email === superAdminEmail;
      const isAdmin = isSuperAdmin || userIsAdmin;
      if (isAdmin) return true;

      const isOwner = auth.uid === targetUserId;
      if (isOwner) {
        if (newDoc.role === existingDoc.role && newDoc.status === existingDoc.status) {
          return true;
        }
      }
      return false;
    }

    function evaluateAccessRequestsCreate(params: {
      auth: { uid: string; email?: string } | null;
      requestId: string;
      docData: { uid: string; email?: string; status: string };
      userIsAdmin: boolean;
    }): boolean {
      const { auth, requestId, docData, userIsAdmin } = params;
      if (!auth) return false;
      if (userIsAdmin) return true;

      const isOwner =
        requestId === auth.uid ||
        docData.uid === auth.uid ||
        Boolean(auth.email && docData.email === auth.email);

      // P0-2 Fix: MUST be pending!
      return isOwner && docData.status === 'pending';
    }

    it('DENIES non-admin user creating users/{uid} with role: auditor and status: approved (P0-1)', () => {
      const allowed = evaluateUsersCreate({
        auth: { uid: 'attacker-123', email: 'attacker@evil.com' },
        targetUserId: 'attacker-123',
        docData: { role: 'auditor', status: 'approved' },
        superAdminEmail: 'idarstore24@gmail.com',
        userIsAdmin: false,
      });
      expect(allowed).toBe(false);
    });

    it('DENIES non-admin user creating users/{uid} with role: admin and status: approved (P0-1)', () => {
      const allowed = evaluateUsersCreate({
        auth: { uid: 'attacker-123', email: 'attacker@evil.com' },
        targetUserId: 'attacker-123',
        docData: { role: 'admin', status: 'approved' },
        superAdminEmail: 'idarstore24@gmail.com',
        userIsAdmin: false,
      });
      expect(allowed).toBe(false);
    });

    it('ALLOWS non-admin user creating users/{uid} with role: viewer and status: pending', () => {
      const allowed = evaluateUsersCreate({
        auth: { uid: 'newuser-456', email: 'alice@company.com' },
        targetUserId: 'newuser-456',
        docData: { role: 'viewer', status: 'pending' },
        superAdminEmail: 'idarstore24@gmail.com',
        userIsAdmin: false,
      });
      expect(allowed).toBe(true);
    });

    it('DENIES non-admin user updating own users/{uid} to self-approve or elevate role (P0-1)', () => {
      const allowed = evaluateUsersUpdate({
        auth: { uid: 'user-789', email: 'bob@company.com' },
        targetUserId: 'user-789',
        existingDoc: { role: 'viewer', status: 'pending' },
        newDoc: { role: 'auditor', status: 'approved' }, // attempted elevation
        superAdminEmail: 'idarstore24@gmail.com',
        userIsAdmin: false,
      });
      expect(allowed).toBe(false);
    });

    it('ALLOWS non-admin user updating own users/{uid} while keeping identical role and status', () => {
      const allowed = evaluateUsersUpdate({
        auth: { uid: 'user-789', email: 'bob@company.com' },
        targetUserId: 'user-789',
        existingDoc: { role: 'viewer', status: 'pending' },
        newDoc: { role: 'viewer', status: 'pending' }, // preserves role & status
        superAdminEmail: 'idarstore24@gmail.com',
        userIsAdmin: false,
      });
      expect(allowed).toBe(true);
    });

    it('DENIES non-admin user creating access_requests/{uid} with status: approved (P0-2)', () => {
      const allowed = evaluateAccessRequestsCreate({
        auth: { uid: 'attacker-123', email: 'attacker@evil.com' },
        requestId: 'attacker-123',
        docData: { uid: 'attacker-123', email: 'attacker@evil.com', status: 'approved' }, // bypass attempt
        userIsAdmin: false,
      });
      expect(allowed).toBe(false);
    });

    it('ALLOWS user creating access_requests/{uid} with status: pending', () => {
      const allowed = evaluateAccessRequestsCreate({
        auth: { uid: 'user-789', email: 'bob@company.com' },
        requestId: 'user-789',
        docData: { uid: 'user-789', email: 'bob@company.com', status: 'pending' },
        userIsAdmin: false,
      });
      expect(allowed).toBe(true);
    });

    it('ALLOWS super admin full bypass on user creation and updates', () => {
      const allowed = evaluateUsersCreate({
        auth: { uid: 'superadmin-001', email: 'idarstore24@gmail.com' },
        targetUserId: 'superadmin-001',
        docData: { role: 'admin', status: 'approved' },
        superAdminEmail: 'idarstore24@gmail.com',
        userIsAdmin: false,
      });
      expect(allowed).toBe(true);
    });
  });

  describe('Templating and Dynamic Super Admin (P0-4)', () => {
    it('generates rules substituting custom SUPER_ADMIN_EMAIL from environment', () => {
      const customEmail = 'sec-ops-lead@enterprise.org';
      const output = generateFirestoreRules(customEmail);

      expect(output).toContain(`request.auth.token.email == '${customEmail}'`);
      expect(output).not.toContain('{{SUPER_ADMIN_EMAIL}}');
    });

    it('throws error if an invalid email string is provided', () => {
      expect(() => generateFirestoreRules('invalid-no-at-sign')).toThrow(/Invalid SUPER_ADMIN_EMAIL/);
    });
  });
});
