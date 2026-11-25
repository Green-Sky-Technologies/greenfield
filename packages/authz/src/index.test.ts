import { describe, expect, it } from 'vitest';
import {
  ARCHIVED_PROJECT_BLOCKED,
  assertCan,
  assertCanInWorkspace,
  DESIGN_SYSTEM_DELEGABLE,
  can,
  ForbiddenError,
  PERMISSIONS,
  permissionsFor,
  permissionsForProject,
  permissionsInWorkspace,
  roleFromClerk,
} from './index';

describe('role matrix', () => {
  it('viewers are strictly view-only but can run deterministic exports', () => {
    expect(can('viewer', 'project:read')).toBe(true);
    expect(can('viewer', 'export:deterministic')).toBe(true);
    for (const p of [
      'design:edit',
      'design:comment',
      'agent:run',
      'export:llm',
      'project:create',
      'share:manage',
    ] as const) {
      expect(can('viewer', p), p).toBe(false);
    }
  });

  it('editors cannot manage members or credentials', () => {
    expect(can('editor', 'agent:run')).toBe(true);
    expect(can('editor', 'workspace:manage_credentials')).toBe(false);
    expect(can('editor', 'workspace:manage_members')).toBe(false);
  });

  it('admins have every permission', () => {
    for (const p of PERMISSIONS) expect(can('admin', p), p).toBe(true);
  });

  it('maps Clerk roles, defaulting unknown roles to viewer', () => {
    expect(roleFromClerk('org:admin')).toBe('admin');
    expect(roleFromClerk('org:member')).toBe('editor');
    expect(roleFromClerk('org:editor')).toBe('editor');
    expect(roleFromClerk('org:viewer')).toBe('viewer');
    expect(roleFromClerk('org:billing')).toBe('viewer');
    expect(roleFromClerk(undefined)).toBe('viewer');
  });

  it('archived projects are read-only for every role until restored', () => {
    for (const role of ['admin', 'editor', 'viewer'] as const) {
      const archived = permissionsForProject(role, { archived: true });
      for (const p of ARCHIVED_PROJECT_BLOCKED) expect(archived, `${role} ${p}`).not.toContain(p);
      expect(archived).toContain('project:read');
      expect(archived).toContain('export:deterministic');
      expect(permissionsForProject(role, { archived: false })).toEqual(permissionsFor(role));
    }
    expect(permissionsForProject('editor', { archived: true })).toContain('share:manage');
    expect(permissionsForProject('editor', { archived: true })).toContain('project:update');
  });

  it('design systems: everyone reads, editors draft, admins publish and set the default', () => {
    expect(can('viewer', 'design_system:read')).toBe(true);
    expect(can('viewer', 'design_system:edit')).toBe(false);
    expect(can('editor', 'design_system:edit')).toBe(true);
    for (const p of [...DESIGN_SYSTEM_DELEGABLE, 'design_system:manage_policy'] as const) {
      expect(can('editor', p), p).toBe(false);
      expect(can('admin', p), p).toBe(true);
    }
  });

  it('an admin can let editors publish and set the default, never viewers or the policy', () => {
    const admins = { designSystemManagers: 'admins' } as const;
    const both = { designSystemManagers: 'admins_and_editors' } as const;
    expect(permissionsInWorkspace('editor', admins)).toEqual(permissionsFor('editor'));
    for (const p of DESIGN_SYSTEM_DELEGABLE) {
      expect(permissionsInWorkspace('editor', both), p).toContain(p);
      expect(permissionsInWorkspace('viewer', both), p).not.toContain(p);
      expect(() => assertCanInWorkspace('editor', p, admins)).toThrow(ForbiddenError);
      expect(() => assertCanInWorkspace('editor', p, both)).not.toThrow();
    }
    expect(permissionsInWorkspace('editor', both)).not.toContain('design_system:manage_policy');
    expect(permissionsInWorkspace('admin', admins)).toEqual(permissionsFor('admin'));
  });

  it('assertCan throws ForbiddenError', () => {
    expect(() => assertCan('viewer', 'design:edit')).toThrow(ForbiddenError);
  });
});
