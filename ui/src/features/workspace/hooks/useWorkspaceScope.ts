import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { queryKeys } from '@/lib/api/queryKeys';
import { fetchPersesUser } from '@/lib/api/rbac';
import {
  NO_WORKSPACE_SENTINEL,
  fetchWorkspaceMap,
  resolveUserWorkspaces,
  setEnforcedNamespaces,
} from '@/lib/api/workspace';

export function useWorkspaceScope({
  sessionAuthenticated,
  authEnabled,
  isSiteAdmin,
  currentUsername,
  userSub,
  searchParams,
}: {
  sessionAuthenticated: boolean;
  authEnabled: boolean;
  isSiteAdmin: boolean;
  currentUsername: string;
  userSub: string;
  searchParams: URLSearchParams;
}) {
  const queryClient = useQueryClient();
  const [selectedWorkspaceNs, setSelectedWorkspaceNs] = useState<string>('');

  const { data: workspaceMap, isLoading: loadingWorkspaceMap } = useQuery({
    queryKey: queryKeys.workspaceMap,
    queryFn: fetchWorkspaceMap,
    enabled: sessionAuthenticated,
    refetchInterval: 30000,
    retry: false,
  });

  const { data: currentUserResource } = useQuery({
    queryKey: queryKeys.persesUser(currentUsername),
    queryFn: () => fetchPersesUser(currentUsername),
    enabled:
      sessionAuthenticated &&
      authEnabled &&
      Boolean(workspaceMap?.enabled) &&
      !isSiteAdmin &&
      Boolean(currentUsername) &&
      currentUsername !== 'guest',
    retry: false,
  });

  const workspaceSubjects = useMemo(() => {
    const out: string[] = [];
    if (userSub) out.push(userSub);
    const oauthList = currentUserResource?.spec?.oauthProviders ?? [];
    for (const p of oauthList) {
      if (p.subject) out.push(p.subject);
      if (p.email) out.push(p.email);
    }
    const fullName = [currentUserResource?.spec?.firstName, currentUserResource?.spec?.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();
    if (fullName) out.push(fullName);
    return out;
  }, [userSub, currentUserResource]);

  const userWorkspaces = useMemo(
    () => resolveUserWorkspaces(workspaceMap, currentUsername, workspaceSubjects),
    [workspaceMap, currentUsername, workspaceSubjects],
  );

  const isNamespaceScoped = Boolean(workspaceMap?.enabled && authEnabled && !isSiteAdmin);

  const activeScopedNamespaces = useMemo<string[] | null>(() => {
    if (!isNamespaceScoped) return null;
    if (userWorkspaces.length === 0) return [NO_WORKSPACE_SENTINEL];
    const allowedSet = new Set(userWorkspaces.map((w) => w.namespace));
    if (selectedWorkspaceNs === '__all__') {
      return userWorkspaces.map((w) => w.namespace);
    }
    if (selectedWorkspaceNs && allowedSet.has(selectedWorkspaceNs)) {
      return [selectedWorkspaceNs];
    }
    return [userWorkspaces[0].namespace];
  }, [isNamespaceScoped, userWorkspaces, selectedWorkspaceNs]);

  useEffect(() => {
    setEnforcedNamespaces(activeScopedNamespaces);
    void queryClient.removeQueries({ queryKey: queryKeys.proxyPrefix });
  }, [activeScopedNamespaces, queryClient]);

  const workspaceContext = useMemo(() => {
    const urlProject = searchParams.get('project')?.trim() || '';
    const urlNamespace = searchParams.get('namespace')?.trim() || '';
    if (urlProject || urlNamespace) {
      const next = { project: urlProject, namespace: urlNamespace };
      try {
        sessionStorage.setItem('perses_workspace_context', JSON.stringify(next));
      } catch {
        // Ignore storage errors
      }
      return next;
    }
    try {
      const raw = sessionStorage.getItem('perses_workspace_context');
      if (raw) {
        const parsed = JSON.parse(raw) as { project?: string; namespace?: string };
        return { project: parsed.project ?? '', namespace: parsed.namespace ?? '' };
      }
    } catch {
      // Ignore storage errors
    }
    return { project: '', namespace: '' };
  }, [searchParams]);

  return {
    workspaceMap,
    loadingWorkspaceMap,
    userWorkspaces,
    isNamespaceScoped,
    selectedWorkspaceNs,
    setSelectedWorkspaceNs,
    activeScopedNamespaces,
    workspaceContext,
  };
}
