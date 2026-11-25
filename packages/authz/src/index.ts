/**
 * Greenfield roles and permissions. The only source of truth for what each role may do.
 *
 * Roles come from the Clerk organization role in the session:
 *   org:admin  -> admin
 *   org:editor -> editor   (custom Clerk role)
 *   org:viewer -> viewer   (custom Clerk role)
 *   org:member -> editor   (Clerk's built-in default; treated as editor)
 * Unknown roles map to viewer, the least privileged.
 */

export const ROLES = ['admin', 'editor', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  // workspace
  'workspace:read',
  'workspace:manage_members',
  'workspace:manage_credentials',
  // projects & designs
  'project:read',
  'project:create',
  'project:update',
  'project:archive',
  'design:edit', // saving the design file
  'design:comment',
  // agent (spends the workspace key)
  'agent:run',
  // exports
  'export:deterministic', // built-in exports, no model use (Epic 7)
  'export:llm', // code generation jobs (Epic 7)
  'share:manage', // create/revoke share links
  // design systems (Epic 10)
  'design_system:read',
  'design_system:edit', // create drafts from a library file, review, write the guide
  'design_system:publish', // publish, unpublish and delete (see designSystemPermissions)
  'design_system:set_default',
  'design_system:manage_policy', // choose who may publish and set the default
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const VIEWER: readonly Permission[] = [
  'workspace:read',
  'project:read',
  'export:deterministic',
  'design_system:read',
];

const EDITOR: readonly Permission[] = [
  ...VIEWER,
  'project:create',
  'project:update',
  'project:archive',
  'design:edit',
  'design:comment',
  'agent:run',
  'export:llm',
  'share:manage',
  'design_system:edit',
];

const ADMIN: readonly Permission[] = [
  ...EDITOR,
  'workspace:manage_members',
  'workspace:manage_credentials',
  'design_system:publish',
  'design_system:set_default',
  'design_system:manage_policy',
];

const MATRIX: Record<Role, ReadonlySet<Permission>> = {
  viewer: new Set(VIEWER),
  editor: new Set(EDITOR),
  admin: new Set(ADMIN),
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role].has(permission);
}

export function permissionsFor(role: Role): Permission[] {
  return [...MATRIX[role]];
}

/**
 * What an archived project refuses until it's restored (the services check `archivedAt` too):
 * no design edits (so no agent runs or LLM exports, which edit or read through the agent) and no
 * comments. Reading, deterministic exports and share links still work.
 */
export const ARCHIVED_PROJECT_BLOCKED: readonly Permission[] = [
  'design:edit',
  'design:comment',
  'agent:run',
  'export:llm',
];

/** The permissions a role has on one project, taking its archived state into account. */
export function permissionsForProject(role: Role, project: { archived: boolean }): Permission[] {
  const all = permissionsFor(role);
  return project.archived ? all.filter((p) => !ARCHIVED_PROJECT_BLOCKED.includes(p)) : all;
}

/**
 * Who may publish design systems and set the default, chosen per workspace by an admin (Story
 * 10.4): admins only (the role matrix above), or admins and editors.
 */
export type DesignSystemManagers = 'admins' | 'admins_and_editors';

/** What `DesignSystemManagers = 'admins_and_editors'` adds for editors. */
export const DESIGN_SYSTEM_DELEGABLE: readonly Permission[] = [
  'design_system:publish',
  'design_system:set_default',
];

/** The permissions a role has in a workspace, taking its design system policy into account. */
export function permissionsInWorkspace(
  role: Role,
  workspace: { designSystemManagers: DesignSystemManagers },
): Permission[] {
  const all = permissionsFor(role);
  if (role !== 'editor' || workspace.designSystemManagers !== 'admins_and_editors') return all;
  return [...all, ...DESIGN_SYSTEM_DELEGABLE];
}

/** `assertCan` for a permission an admin may delegate (see `permissionsInWorkspace`). */
export function assertCanInWorkspace(
  role: Role,
  permission: Permission,
  workspace: { designSystemManagers: DesignSystemManagers },
): void {
  if (!permissionsInWorkspace(role, workspace).includes(permission))
    throw new ForbiddenError(permission);
}

export function roleFromClerk(orgRole: string | null | undefined): Role {
  switch (orgRole) {
    case 'org:admin':
      return 'admin';
    case 'org:editor':
    case 'org:member':
      return 'editor';
    case 'org:viewer':
      return 'viewer';
    default:
      return 'viewer';
  }
}

export class ForbiddenError extends Error {
  override name = 'ForbiddenError';
  constructor(public readonly permission: Permission) {
    super(`Missing permission: ${permission}`);
  }
}

export function assertCan(role: Role, permission: Permission): void {
  if (!can(role, permission)) throw new ForbiddenError(permission);
}
