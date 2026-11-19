import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';

import { getCurrentPersesUsername, logoutPerses } from '@/lib/api/auth';
import { fetchClusterSiteBranding, type SiteBrandingConfig } from '@/lib/api/branding';
import { ForbiddenError, UnauthorizedError } from '@/lib/api/http';
import { fetchProjects } from '@/lib/api/projects';

export type SessionState = 'checking' | 'authenticated' | 'unauthenticated';

export function useSession(onBrandingLoaded: (branding: SiteBrandingConfig) => void) {
  const queryClient = useQueryClient();
  const [sessionState, setSessionState] = useState<SessionState>('checking');
  const [authError, setAuthError] = useState<string | undefined>(undefined);
  const [currentUsername, setCurrentUsername] = useState<string>(() => getCurrentPersesUsername());

  const verifySession = useCallback(async () => {
    setSessionState('checking');
    setAuthError(undefined);
    try {
      await fetchProjects();
      setCurrentUsername(getCurrentPersesUsername());
      setSessionState('authenticated');
      void fetchClusterSiteBranding().then((remote) => {
        onBrandingLoaded(remote);
      });
    } catch (err) {
      if (err instanceof ForbiddenError) {
        setCurrentUsername(getCurrentPersesUsername());
        setSessionState('authenticated');
        void fetchClusterSiteBranding().then((remote) => {
          onBrandingLoaded(remote);
        });
        return;
      }
      if (err instanceof UnauthorizedError) {
        setSessionState('unauthenticated');
        return;
      }
      setAuthError(err instanceof Error ? err.message : String(err));
      setSessionState('unauthenticated');
    }
  }, [onBrandingLoaded]);

  useEffect(() => {
    void verifySession();
  }, [verifySession]);

  const handleLogout = useCallback(async () => {
    await logoutPerses();
    queryClient.clear();
    setCurrentUsername('guest');
    setSessionState('unauthenticated');
  }, [queryClient]);

  const handleAuthenticated = useCallback(() => {
    queryClient.clear();
    void verifySession();
  }, [queryClient, verifySession]);

  return {
    sessionState,
    authError,
    currentUsername,
    verifySession,
    handleLogout,
    handleAuthenticated,
  };
}
