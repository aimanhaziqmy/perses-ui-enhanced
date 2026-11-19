import { useEffect, useState } from 'react';

import type { QueryTabState } from '../logsExplorerHelpers';

const LOGS_TABS_STORAGE_KEY = 'perses_logs_query_tabs_v1';

export function useLogTabs(initialQuery: string, onTabSwitched: () => void) {
  const [tabs, setTabs] = useState<QueryTabState[]>(() => {
    try {
      const raw = window.localStorage.getItem(LOGS_TABS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { tabs?: QueryTabState[] };
        if (Array.isArray(parsed.tabs) && parsed.tabs.length > 0) {
          const valid = parsed.tabs.filter(
            (t) => t && typeof t.id === 'string' && typeof t.label === 'string' && typeof t.query === 'string',
          );
          if (valid.length > 0) {
            if (initialQuery && initialQuery !== '*') {
              return [{ ...valid[0], query: initialQuery }, ...valid.slice(1)];
            }
            return valid;
          }
        }
      }
    } catch {
      // Ignore malformed localStorage state and fall back to default tab
    }
    return [{ id: 'q1', label: 'Query 1', query: initialQuery, rangeMinutes: 60, selectedLevels: [] }];
  });

  const [activeTabId, setActiveTabId] = useState<string>(() => {
    try {
      const raw = window.localStorage.getItem(LOGS_TABS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { activeTabId?: string; tabs?: QueryTabState[] };
        if (
          typeof parsed.activeTabId === 'string' &&
          Array.isArray(parsed.tabs) &&
          parsed.tabs.some((t) => t?.id === parsed.activeTabId) &&
          (!initialQuery || initialQuery === '*')
        ) {
          return parsed.activeTabId;
        }
      }
    } catch {
      // Fallback to first tab
    }
    return 'q1';
  });

  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingTabLabel, setEditingTabLabel] = useState<string>('');

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
  const [debouncedQuery, setDebouncedQuery] = useState<string>(activeTab.query);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(activeTab.query);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [activeTab.query, activeTab.id]);

  const updateActiveTab = (patch: Partial<QueryTabState>) => {
    setTabs((prev) => prev.map((t) => (t.id === activeTab.id ? { ...t, ...patch } : t)));
  };

  const addTab = () => {
    const num = tabs.length + 1;
    const id = `q${Date.now()}`;
    setTabs((prev) => [...prev, { id, label: `Query ${num}`, query: '*', rangeMinutes: 60, selectedLevels: [] }]);
    setActiveTabId(id);
    setDebouncedQuery('*');
    onTabSwitched();
  };

  const closeTab = (tabId: string) => {
    if (tabs.length <= 1) return;
    const idx = tabs.findIndex((t) => t.id === tabId);
    const nextTabs = tabs.filter((t) => t.id !== tabId);
    setTabs(nextTabs);
    if (activeTabId === tabId) {
      const fallback = nextTabs[Math.max(0, idx - 1)] ?? nextTabs[0];
      setActiveTabId(fallback.id);
      setDebouncedQuery(fallback.query);
      onTabSwitched();
    }
    if (editingTabId === tabId) {
      setEditingTabId(null);
    }
  };

  const commitTabRename = (tabId: string) => {
    const trimmed = editingTabLabel.trim();
    if (trimmed) {
      setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, label: trimmed } : t)));
    }
    setEditingTabId(null);
  };

  useEffect(() => {
    try {
      window.localStorage.setItem(LOGS_TABS_STORAGE_KEY, JSON.stringify({ tabs, activeTabId }));
    } catch {
      // Ignore storage quota errors
    }
  }, [tabs, activeTabId]);

  return {
    tabs,
    activeTabId,
    setActiveTabId,
    activeTab,
    editingTabId,
    setEditingTabId,
    editingTabLabel,
    setEditingTabLabel,
    debouncedQuery,
    setDebouncedQuery,
    updateActiveTab,
    addTab,
    closeTab,
    commitTabRename,
  };
}
