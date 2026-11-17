import type {
  GlobalRoleBindingResource,
  GlobalRoleResource,
  Permission,
  RoleBindingResource,
  RoleResource,
  UserResource,
} from '@perses-dev/client';

import { apiDelete, apiGetJson, apiSendJson } from './http';

export type PersesUserResource = UserResource;
export type PersesPermission = Permission;
export type PersesGlobalRoleResource = GlobalRoleResource;
export type PersesGlobalRoleBindingResource = GlobalRoleBindingResource;
export type PersesUserPermissionsMap = Record<string, Permission[]>;

export function fetchPersesUsers(): Promise<UserResource[]> {
  return apiGetJson<UserResource[]>('/api/v1/users');
}

export function createPersesUser(user: UserResource): Promise<UserResource> {
  return apiSendJson<UserResource>('/api/v1/users', 'POST', user);
}

export function updatePersesUser(user: UserResource): Promise<UserResource> {
  return apiSendJson<UserResource>(
    `/api/v1/users/${encodeURIComponent(user.metadata.name)}`,
    'PUT',
    user,
  );
}

export function deletePersesUser(name: string): Promise<void> {
  return apiDelete(`/api/v1/users/${encodeURIComponent(name)}`);
}

export function fetchPersesGlobalRoles(): Promise<GlobalRoleResource[]> {
  return apiGetJson<GlobalRoleResource[]>('/api/v1/globalroles');
}

export function createPersesGlobalRole(role: GlobalRoleResource): Promise<GlobalRoleResource> {
  return apiSendJson<GlobalRoleResource>('/api/v1/globalroles', 'POST', role);
}

export function updatePersesGlobalRole(role: GlobalRoleResource): Promise<GlobalRoleResource> {
  return apiSendJson<GlobalRoleResource>(
    `/api/v1/globalroles/${encodeURIComponent(role.metadata.name)}`,
    'PUT',
    role,
  );
}

export function deletePersesGlobalRole(name: string): Promise<void> {
  return apiDelete(`/api/v1/globalroles/${encodeURIComponent(name)}`);
}

export function fetchPersesGlobalRoleBindings(): Promise<GlobalRoleBindingResource[]> {
  return apiGetJson<GlobalRoleBindingResource[]>('/api/v1/globalrolebindings');
}

export function createPersesGlobalRoleBinding(
  binding: GlobalRoleBindingResource,
): Promise<GlobalRoleBindingResource> {
  return apiSendJson<GlobalRoleBindingResource>('/api/v1/globalrolebindings', 'POST', binding);
}

export function updatePersesGlobalRoleBinding(
  binding: GlobalRoleBindingResource,
): Promise<GlobalRoleBindingResource> {
  return apiSendJson<GlobalRoleBindingResource>(
    `/api/v1/globalrolebindings/${encodeURIComponent(binding.metadata.name)}`,
    'PUT',
    binding,
  );
}

export function deletePersesGlobalRoleBinding(name: string): Promise<void> {
  return apiDelete(`/api/v1/globalrolebindings/${encodeURIComponent(name)}`);
}

export function fetchProjectRoles(project: string): Promise<RoleResource[]> {
  return apiGetJson<RoleResource[]>(`/api/v1/projects/${encodeURIComponent(project)}/roles`);
}

export function createProjectRole(project: string, role: RoleResource): Promise<RoleResource> {
  return apiSendJson<RoleResource>(`/api/v1/projects/${encodeURIComponent(project)}/roles`, 'POST', role);
}

export function updateProjectRole(project: string, role: RoleResource): Promise<RoleResource> {
  return apiSendJson<RoleResource>(
    `/api/v1/projects/${encodeURIComponent(project)}/roles/${encodeURIComponent(role.metadata.name)}`,
    'PUT',
    role,
  );
}

export function deleteProjectRole(project: string, name: string): Promise<void> {
  return apiDelete(
    `/api/v1/projects/${encodeURIComponent(project)}/roles/${encodeURIComponent(name)}`,
  );
}

export function fetchProjectRoleBindings(project: string): Promise<RoleBindingResource[]> {
  return apiGetJson<RoleBindingResource[]>(`/api/v1/projects/${encodeURIComponent(project)}/rolebindings`);
}

export function createProjectRoleBinding(
  project: string,
  binding: RoleBindingResource,
): Promise<RoleBindingResource> {
  return apiSendJson<RoleBindingResource>(
    `/api/v1/projects/${encodeURIComponent(project)}/rolebindings`,
    'POST',
    binding,
  );
}

export function updateProjectRoleBinding(
  project: string,
  binding: RoleBindingResource,
): Promise<RoleBindingResource> {
  return apiSendJson<RoleBindingResource>(
    `/api/v1/projects/${encodeURIComponent(project)}/rolebindings/${encodeURIComponent(binding.metadata.name)}`,
    'PUT',
    binding,
  );
}

export function deleteProjectRoleBinding(project: string, name: string): Promise<void> {
  return apiDelete(
    `/api/v1/projects/${encodeURIComponent(project)}/rolebindings/${encodeURIComponent(name)}`,
  );
}

export async function assignUserGlobalRoles(
  username: string,
  desiredRoles: string[],
  existingBindings?: GlobalRoleBindingResource[],
): Promise<void> {
  const bindings = existingBindings ?? (await fetchPersesGlobalRoleBindings());
  const desiredSet = new Set(desiredRoles);

  for (const b of bindings) {
    const hasUser = (b.spec.subjects ?? []).some((s) => s.kind === 'User' && s.name === username);
    if (hasUser && !desiredSet.has(b.spec.role)) {
      const nextSubjects = (b.spec.subjects ?? []).filter((s) => !(s.kind === 'User' && s.name === username));
      if (nextSubjects.length === 0) {
        await deletePersesGlobalRoleBinding(b.metadata.name);
      } else {
        await updatePersesGlobalRoleBinding({
          ...b,
          spec: { ...b.spec, subjects: nextSubjects },
        });
      }
    }
  }

  for (const roleName of desiredSet) {
    const matching = bindings.filter((b) => b.spec.role === roleName);
    const alreadyAssigned = matching.some((b) =>
      (b.spec.subjects ?? []).some((s) => s.kind === 'User' && s.name === username),
    );
    if (alreadyAssigned) continue;

    if (matching.length > 0) {
      const target = matching[0];
      await updatePersesGlobalRoleBinding({
        ...target,
        spec: {
          ...target.spec,
          subjects: [...(target.spec.subjects ?? []), { kind: 'User', name: username }],
        },
      });
    } else {
      const baseName = roleName.toLowerCase().replace(/[^a-z0-9-_]/g, '-') || 'role';
      const candidateName = bindings.some((b) => b.metadata.name === baseName)
        ? `${baseName}-${Date.now()}`
        : baseName;
      await createPersesGlobalRoleBinding({
        kind: 'GlobalRoleBinding',
        metadata: { name: candidateName },
        spec: {
          role: roleName,
          subjects: [{ kind: 'User', name: username }],
        },
      });
    }
  }
}

export async function assignUserProjectRoles(
  project: string,
  username: string,
  desiredRoles: string[],
  existingBindings?: RoleBindingResource[],
): Promise<void> {
  const bindings = existingBindings ?? (await fetchProjectRoleBindings(project));
  const desiredSet = new Set(desiredRoles);

  for (const b of bindings) {
    const hasUser = (b.spec.subjects ?? []).some((s) => s.kind === 'User' && s.name === username);
    if (hasUser && !desiredSet.has(b.spec.role)) {
      const nextSubjects = (b.spec.subjects ?? []).filter((s) => !(s.kind === 'User' && s.name === username));
      if (nextSubjects.length === 0) {
        await deleteProjectRoleBinding(project, b.metadata.name);
      } else {
        await updateProjectRoleBinding(project, {
          ...b,
          spec: { ...b.spec, subjects: nextSubjects },
        });
      }
    }
  }

  for (const roleName of desiredSet) {
    const matching = bindings.filter((b) => b.spec.role === roleName);
    const alreadyAssigned = matching.some((b) =>
      (b.spec.subjects ?? []).some((s) => s.kind === 'User' && s.name === username),
    );
    if (alreadyAssigned) continue;

    if (matching.length > 0) {
      const target = matching[0];
      await updateProjectRoleBinding(project, {
        ...target,
        spec: {
          ...target.spec,
          subjects: [...(target.spec.subjects ?? []), { kind: 'User', name: username }],
        },
      });
    } else {
      const baseName = roleName.toLowerCase().replace(/[^a-z0-9-_]/g, '-') || 'role';
      const candidateName = bindings.some((b) => b.metadata.name === baseName)
        ? `${baseName}-${Date.now()}`
        : baseName;
      await createProjectRoleBinding(project, {
        kind: 'RoleBinding',
        metadata: { name: candidateName, project },
        spec: {
          role: roleName,
          subjects: [{ kind: 'User', name: username }],
        },
      });
    }
  }
}

export async function fetchUserPermissions(username: string): Promise<PersesUserPermissionsMap> {
  if (!username || username === 'guest') return {};
  return apiGetJson<PersesUserPermissionsMap>(`/api/v1/users/${encodeURIComponent(username)}/permissions`);
}

export function canManageSiteSettings(perms: PersesUserPermissionsMap | undefined): boolean {
  const globalPerms = perms?.['*'] ?? [];
  return globalPerms.some((p) => {
    const canWrite = p.actions.includes('*') || p.actions.includes('update') || p.actions.includes('create');
    const coversGlobalVar = p.scopes.includes('*') || p.scopes.includes('GlobalVariable');
    return canWrite && coversGlobalVar;
  });
}
