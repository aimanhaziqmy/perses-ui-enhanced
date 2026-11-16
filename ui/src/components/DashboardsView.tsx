import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import type { DashboardResource, ProjectResource } from '@perses-dev/client';
import { ErrorAlert, ErrorBoundary, getResourceDisplayName } from '@perses-dev/components';
import { ViewDashboard } from '@perses-dev/dashboards';
import { PluginRegistry, ValidationProvider, remotePluginLoader } from '@perses-dev/plugin-system';
import ArrowLeft from 'mdi-material-ui/ArrowLeft';
import ChevronDown from 'mdi-material-ui/ChevronDown';
import ChevronRight from 'mdi-material-ui/ChevronRight';
import Check from 'mdi-material-ui/Check';
import ContentCopy from 'mdi-material-ui/ContentCopy';
import DeleteOutline from 'mdi-material-ui/DeleteOutline';
import DownloadOutline from 'mdi-material-ui/DownloadOutline';
import EyeOutline from 'mdi-material-ui/EyeOutline';
import FolderPlusOutline from 'mdi-material-ui/FolderPlusOutline';
import Fullscreen from 'mdi-material-ui/Fullscreen';
import FullscreenExit from 'mdi-material-ui/FullscreenExit';
import Magnify from 'mdi-material-ui/Magnify';
import PencilOutline from 'mdi-material-ui/PencilOutline';
import Plus from 'mdi-material-ui/Plus';
import Refresh from 'mdi-material-ui/Refresh';
import ShareVariantOutline from 'mdi-material-ui/ShareVariantOutline';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import {
  ForbiddenError,
  countUnsupportedMigratedQueries,
  createDashboard,
  createProject,
  datasourceTargetKey,
  deleteDashboard,
  deleteProject,
  fetchDashboard,
  fetchDashboards,
  fetchProjects,
  isGrafanaDashboardJson,
  migrateGrafanaDashboard,
  unwrapGrafanaDashboard,
  updateDashboard,
  useDatasourceTargets,
  usePersesDatasourceApi,
} from '../api/persesClient';
import { PALETTE_TOKENS } from '../theme/persesTheme';

export function DashboardsView({
  isEmbed = false,
  isFullscreen = false,
  onToggleFullscreen,
}: {
  isEmbed?: boolean;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}) {
  const muiTheme = useTheme();
  const tokens = PALETTE_TOKENS[muiTheme.palette.mode];
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();

  const embedMatch = location.pathname.match(/^\/embed\/projects\/([^/]+)\/dashboards\/([^/]+)/);
  const embedSearchParams = new URLSearchParams(location.search);
  const embedProject = embedMatch ? decodeURIComponent(embedMatch[1]) : embedSearchParams.get('project') || '';
  const embedDashboard = embedMatch ? decodeURIComponent(embedMatch[2]) : embedSearchParams.get('dashboard') || '';
  const embedPanelKey = isEmbed ? embedSearchParams.get('panel') || '' : '';

  const pluginLoader = useMemo(() => remotePluginLoader({ baseURL: '', apiPrefix: '' }), []);
  const [viewMode, setViewMode] = useState<'list' | 'detail'>(() => (isEmbed ? 'detail' : 'list'));
  const [searchText, setSearchText] = useState<string>('');
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [projectPage, setProjectPage] = useState<number>(0);
  const [projectsPerPage, setProjectsPerPage] = useState<number>(10);
  const [selectedProject, setSelectedProject] = useState<string>(() => embedProject);
  const [selectedDashboardName, setSelectedDashboardName] = useState<string>(() => embedDashboard);
  const [startInEditMode, setStartInEditMode] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'warning' | 'error'; text: string } | null>(null);

  // Share & Embed modal state
  const [shareTarget, setShareTarget] = useState<{ project: string; dashboard: DashboardResource } | null>(null);
  const [shareScope, setShareScope] = useState<'dashboard' | 'panel'>('dashboard');
  const [sharePanelKey, setSharePanelKey] = useState<string>('');
  const [shareVisibility, setShareVisibility] = useState<'private' | 'public'>('private');
  const [shareCopied, setShareCopied] = useState<'url' | 'iframe' | null>(null);

  // Project create/delete dialogs
  const [createProjOpen, setCreateProjOpen] = useState(false);
  const [projName, setProjName] = useState('');
  const [projDisplayName, setProjDisplayName] = useState('');
  const [projError, setProjError] = useState<string | null>(null);
  const [projSaving, setProjSaving] = useState(false);
  const [deleteProjOpen, setDeleteProjOpen] = useState(false);

  // Dashboard create/delete dialogs
  const [createDashOpen, setCreateDashOpen] = useState(false);
  const [createMode, setCreateMode] = useState<'blank' | 'clone' | 'import'>('blank');
  const [dashName, setDashName] = useState('');
  const [dashDisplayName, setDashDisplayName] = useState('');
  const [cloneSourceProject, setCloneSourceProject] = useState('');
  const [cloneSourceDashboard, setCloneSourceDashboard] = useState('');
  const [importJsonText, setImportJsonText] = useState('');
  const [useDefaultDatasource, setUseDefaultDatasource] = useState(true);
  const [migratingGrafana, setMigratingGrafana] = useState(false);
  const [dashError, setDashError] = useState<string | null>(null);
  const [dashSaving, setDashSaving] = useState(false);
  const [deleteDashOpen, setDeleteDashOpen] = useState(false);

  const detectedImportFormat = useMemo<'empty' | 'grafana' | 'perses' | 'invalid'>(() => {
    const trimmed = importJsonText.trim();
    if (!trimmed) return 'empty';
    try {
      const parsed = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'invalid';
      return isGrafanaDashboardJson(parsed as Record<string, unknown>) ? 'grafana' : 'perses';
    } catch {
      return 'invalid';
    }
  }, [importJsonText]);

  const {
    data: projects,
    isLoading: loadingProjects,
    error: projectsError,
  } = useQuery<ProjectResource[], Error>({
    queryKey: ['perses', 'projects'],
    queryFn: fetchProjects,
    enabled: !isEmbed,
  });

  const { targets: availableDatasources } = useDatasourceTargets();

  useEffect(() => {
    if (isEmbed) return;
    if (!projects || projects.length === 0) {
      setSelectedProject('');
      return;
    }
    if (!selectedProject || !projects.some((p) => p.metadata.name === selectedProject)) {
      setSelectedProject(projects[0].metadata.name);
    }
  }, [projects, selectedProject, isEmbed]);

  const projectNamesKey = (projects ?? []).map((p) => p.metadata.name).join(',');
  const {
    data: allDashboardsByProject = {},
    isInitialLoading: loadingAllDashboards,
    refetch: refetchAllDashboards,
  } = useQuery<Record<string, DashboardResource[]>, Error>({
    queryKey: ['perses', 'all-dashboards', projectNamesKey],
    queryFn: async () => {
      const list = projects ?? [];
      const entries = await Promise.all(
        list.map(async (p) => {
          try {
            const items = await fetchDashboards(p.metadata.name);
            return [p.metadata.name, items] as const;
          } catch {
            return [p.metadata.name, [] as DashboardResource[]] as const;
          }
        }),
      );
      return Object.fromEntries(entries);
    },
    enabled: Boolean(projects && projects.length > 0) && !isEmbed,
  });

  const {
    data: dashboards,
    isInitialLoading: loadingDashboards,
    error: dashboardsError,
  } = useQuery<DashboardResource[], Error>({
    queryKey: ['perses', 'dashboards', selectedProject],
    queryFn: () => fetchDashboards(selectedProject),
    enabled: Boolean(selectedProject) && !isEmbed,
  });

  const { data: cloneProjectDashboards = [] } = useQuery<DashboardResource[], Error>({
    queryKey: ['perses', 'dashboards', cloneSourceProject],
    queryFn: () => fetchDashboards(cloneSourceProject),
    enabled: createDashOpen && createMode === 'clone' && Boolean(cloneSourceProject),
  });

  useEffect(() => {
    if (isEmbed) return;
    if (!dashboards || dashboards.length === 0) {
      setSelectedDashboardName('');
      return;
    }
    if (!selectedDashboardName || !dashboards.some((d) => d.metadata.name === selectedDashboardName)) {
      setSelectedDashboardName(dashboards[0].metadata.name);
    }
  }, [dashboards, selectedDashboardName, isEmbed]);

  const {
    data: activeDashboard,
    isInitialLoading: loadingActiveDashboard,
    error: activeDashboardError,
  } = useQuery<DashboardResource, Error>({
    queryKey: ['perses', 'dashboard', selectedProject, selectedDashboardName],
    queryFn: () => fetchDashboard(selectedProject, selectedDashboardName),
    enabled: Boolean(selectedProject && selectedDashboardName),
  });

  const displayedDashboard = useMemo(() => {
    if (!activeDashboard) return undefined;
    if (!isEmbed || !embedPanelKey) return activeDashboard;
    const panel = activeDashboard.spec?.panels?.[embedPanelKey];
    if (!panel) return activeDashboard;
    return {
      ...activeDashboard,
      spec: {
        ...activeDashboard.spec,
        panels: { [embedPanelKey]: panel },
        layouts: [
          {
            kind: 'Grid' as const,
            spec: {
              display: { title: '' },
              items: [
                {
                  x: 0,
                  y: 0,
                  width: 24,
                  height: 12,
                  content: { $ref: `#/spec/panels/${embedPanelKey}` as `#/spec/panels/${string}` },
                },
              ],
            },
          },
        ],
      },
    };
  }, [activeDashboard, isEmbed, embedPanelKey]);

  const openShareModal = (projectName: string, dash: DashboardResource) => {
    setShareTarget({ project: projectName, dashboard: dash });
    setShareScope('dashboard');
    const firstPanel = Object.keys(dash.spec?.panels ?? {})[0] ?? '';
    setSharePanelKey(firstPanel);
    setShareVisibility('private');
    setShareCopied(null);
  };

  const datasourceApi = usePersesDatasourceApi(selectedProject || undefined);

  const scopedDatasourceChips = useMemo(() => {
    return availableDatasources
      .filter((t) => t.scope === 'global' || t.project === selectedProject)
      .slice(0, 4);
  }, [availableDatasources, selectedProject]);

  const handleSaveDashboard = async (updated: DashboardResource) => {
    setFeedback(null);
    const payload: DashboardResource = {
      ...updated,
      metadata: {
        ...updated.metadata,
        project: selectedProject,
      },
    };
    try {
      const saved = await updateDashboard(selectedProject, payload);
      queryClient.setQueryData(
        ['perses', 'dashboard', selectedProject, saved.metadata.name],
        saved,
      );
      await queryClient.invalidateQueries({ queryKey: ['perses', 'dashboards', selectedProject] });
      setStartInEditMode(false);
      setFeedback({
        kind: 'success',
        text: `Dashboard "${getResourceDisplayName(saved)}" saved to Perses.`,
      });
      return saved;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFeedback({ kind: 'error', text: msg });
      throw err;
    }
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    const slug = projName.trim();
    if (!slug) {
      setProjError('Project ID is required.');
      return;
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(slug)) {
      setProjError('Project ID can only contain letters, numbers, ".", "_", and "-".');
      return;
    }
    setProjSaving(true);
    setProjError(null);
    setFeedback(null);
    try {
      const created = await createProject({
        kind: 'Project',
        metadata: { name: slug },
        spec: {
          display: {
            name: projDisplayName.trim() || slug,
          },
        },
      });
      await queryClient.invalidateQueries({ queryKey: ['perses', 'projects'] });
      setSelectedProject(created.metadata.name);
      setSelectedDashboardName('');
      setCreateProjOpen(false);
      setProjName('');
      setProjDisplayName('');
      setFeedback({ kind: 'success', text: `Created project "${created.metadata.name}".` });
    } catch (err) {
      setProjError(err instanceof Error ? err.message : String(err));
    } finally {
      setProjSaving(false);
    }
  };

  const handleDeleteProject = async () => {
    if (!selectedProject) return;
    setProjSaving(true);
    setFeedback(null);
    try {
      const deleted = selectedProject;
      await deleteProject(deleted);
      await queryClient.invalidateQueries({ queryKey: ['perses', 'projects'] });
      await queryClient.invalidateQueries({ queryKey: ['perses', 'all-dashboards'] });
      setDeleteProjOpen(false);
      setSelectedProject('');
      setSelectedDashboardName('');
      setViewMode('list');
      setFeedback({ kind: 'success', text: `Deleted project "${deleted}".` });
    } catch (err) {
      setFeedback({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
      setDeleteProjOpen(false);
    } finally {
      setProjSaving(false);
    }
  };

  const openCreateDashboardModal = () => {
    setDashError(null);
    setCreateMode('blank');
    setDashName('');
    setDashDisplayName('');
    setCloneSourceProject(selectedProject);
    setCloneSourceDashboard(selectedDashboardName);
    setImportJsonText('');
    setCreateDashOpen(true);
  };

  const openDashboardDetail = (projectName: string, dashboardName: string, editMode = false) => {
    setSelectedProject(projectName);
    setSelectedDashboardName(dashboardName);
    setStartInEditMode(editMode);
    setViewMode('detail');
  };

  const openCreateInProject = (
    projectName: string,
    mode: 'blank' | 'clone' | 'import' = 'blank',
    sourceDashName = '',
  ) => {
    setSelectedProject(projectName);
    setDashError(null);
    setCreateMode(mode);
    setDashName(mode === 'clone' && sourceDashName ? `${sourceDashName}-copy` : '');
    setDashDisplayName('');
    setCloneSourceProject(projectName);
    setCloneSourceDashboard(sourceDashName);
    setImportJsonText('');
    setCreateDashOpen(true);
  };

  const handleExportDashboardJson = (dash: DashboardResource) => {
    const blob = new Blob([JSON.stringify(dash, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${dash.metadata.name}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setImportJsonText(reader.result);
      }
    };
    reader.readAsText(file);
  };

  const handlePreviewMigrateGrafana = async () => {
    setDashError(null);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(importJsonText) as Record<string, unknown>;
    } catch {
      setDashError('Invalid JSON payload.');
      return;
    }
    setMigratingGrafana(true);
    try {
      const migrated = await migrateGrafanaDashboard(parsed, useDefaultDatasource);
      const unwrapped = unwrapGrafanaDashboard(parsed);
      if (!dashName.trim()) {
        const candidateSlug = String(migrated.metadata?.name || unwrapped.uid || unwrapped.title || '')
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9._-]+/g, '-')
          .replace(/^-+|-+$/g, '');
        if (candidateSlug) setDashName(candidateSlug);
      }
      if (!dashDisplayName.trim() && migrated.spec?.display?.name) {
        setDashDisplayName(migrated.spec.display.name);
      }
      setImportJsonText(JSON.stringify(migrated, null, 2));
      const unsupported = countUnsupportedMigratedQueries(migrated);
      if (unsupported > 0) {
        setDashError(
          `Converted to Perses JSON, but ${unsupported} panel query slot(s) could not be auto-translated (marked "migration_from_grafana_not_supported"). You can still create the dashboard and adjust those queries in Edit mode.`,
        );
      }
    } catch (err) {
      setDashError(`Grafana migration failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setMigratingGrafana(false);
    }
  };

  const handleCreateDashboard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProject) return;
    setDashError(null);
    setFeedback(null);

    let payload: DashboardResource;

    if (createMode === 'blank') {
      const slug = dashName.trim();
      if (!slug) {
        setDashError('Dashboard ID is required.');
        return;
      }
      if (!/^[a-zA-Z0-9._-]+$/.test(slug)) {
        setDashError('Dashboard ID can only contain letters, numbers, ".", "_", and "-".');
        return;
      }
      payload = {
        kind: 'Dashboard',
        metadata: { name: slug, project: selectedProject },
        spec: {
          display: { name: dashDisplayName.trim() || slug },
          duration: '1h',
          refreshInterval: '0s',
          variables: [],
          panels: {},
          layouts: [],
        },
      };
    } else if (createMode === 'clone') {
      const slug = dashName.trim();
      if (!slug) {
        setDashError('New dashboard ID is required.');
        return;
      }
      if (!/^[a-zA-Z0-9._-]+$/.test(slug)) {
        setDashError('Dashboard ID can only contain letters, numbers, ".", "_", and "-".');
        return;
      }
      if (!cloneSourceProject || !cloneSourceDashboard) {
        setDashError('Select a source project and dashboard to clone.');
        return;
      }
      setDashSaving(true);
      try {
        const source = await fetchDashboard(cloneSourceProject, cloneSourceDashboard);
        payload = {
          kind: 'Dashboard',
          metadata: { name: slug, project: selectedProject },
          spec: {
            ...JSON.parse(JSON.stringify(source.spec)),
            display: {
              ...source.spec.display,
              name: dashDisplayName.trim() || `${getResourceDisplayName(source)} (Copy)`,
            },
          },
        };
      } catch (err) {
        setDashSaving(false);
        setDashError(err instanceof Error ? err.message : String(err));
        return;
      }
    } else {
      // Import Perses JSON or auto-migrate Grafana JSON
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(importJsonText) as Record<string, unknown>;
      } catch {
        setDashError('Invalid JSON payload. Paste a valid Perses or Grafana Dashboard JSON object.');
        return;
      }

      let sourceDashboard: DashboardResource | null = null;
      let unsupportedCount = 0;

      if (isGrafanaDashboardJson(parsed)) {
        setDashSaving(true);
        try {
          sourceDashboard = await migrateGrafanaDashboard(parsed, useDefaultDatasource);
          unsupportedCount = countUnsupportedMigratedQueries(sourceDashboard);
        } catch (err) {
          setDashSaving(false);
          setDashError(`Grafana migration failed: ${err instanceof Error ? err.message : String(err)}`);
          return;
        }
      }

      const rawMeta = (
        sourceDashboard?.metadata ??
        (parsed.metadata && typeof parsed.metadata === 'object' ? parsed.metadata : {})
      ) as Partial<DashboardResource['metadata']>;
      const rawSpec = (
        sourceDashboard?.spec ??
        (parsed.spec && typeof parsed.spec === 'object' ? parsed.spec : parsed)
      ) as DashboardResource['spec'];

      const unwrappedGrafana = unwrapGrafanaDashboard(parsed);
      const fallbackSlugSource = String(
        rawMeta.name || unwrappedGrafana.uid || unwrappedGrafana.title || '',
      )
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '');

      const slug = dashName.trim() || String(rawMeta.name ?? '').trim() || fallbackSlugSource;
      if (!slug) {
        setDashSaving(false);
        setDashError('Dashboard ID is required (enter an ID above or include metadata.name / uid in JSON).');
        return;
      }
      if (!/^[a-zA-Z0-9._-]+$/.test(slug)) {
        setDashSaving(false);
        setDashError('Dashboard ID can only contain letters, numbers, ".", "_", and "-".');
        return;
      }
      if (!rawSpec || typeof rawSpec !== 'object' || !rawSpec.panels || !rawSpec.layouts) {
        setDashSaving(false);
        setDashError('JSON must contain a Perses dashboard spec with "panels" and "layouts", or a Grafana dashboard JSON.');
        return;
      }
      payload = {
        kind: 'Dashboard',
        metadata: { name: slug, project: selectedProject },
        spec: {
          ...rawSpec,
          duration: rawSpec.duration || '1h',
          variables: Array.isArray(rawSpec.variables) ? rawSpec.variables : [],
          display: dashDisplayName.trim()
            ? { ...rawSpec.display, name: dashDisplayName.trim() }
            : rawSpec.display ?? { name: slug },
        },
      };

      unsupportedCount = unsupportedCount || countUnsupportedMigratedQueries(payload);
      setDashSaving(true);
      try {
        const created = await createDashboard(selectedProject, payload);
        await queryClient.invalidateQueries({ queryKey: ['perses', 'dashboards', selectedProject] });
        await queryClient.invalidateQueries({ queryKey: ['perses', 'all-dashboards'] });
        setSelectedDashboardName(created.metadata.name);
        setStartInEditMode(unsupportedCount > 0);
        setViewMode('detail');
        setCreateDashOpen(false);
        setFeedback(
          unsupportedCount > 0
            ? {
                kind: 'warning',
                text: `Imported dashboard "${getResourceDisplayName(created)}", but ${unsupportedCount} query slot(s) need manual update in Edit mode.`,
              }
            : {
                kind: 'success',
                text: `Created dashboard "${getResourceDisplayName(created)}" in project "${selectedProject}".`,
              },
        );
      } catch (err) {
        setDashError(err instanceof Error ? err.message : String(err));
      } finally {
        setDashSaving(false);
      }
      return;
    }

    setDashSaving(true);
    try {
      const created = await createDashboard(selectedProject, payload);
      await queryClient.invalidateQueries({ queryKey: ['perses', 'dashboards', selectedProject] });
      await queryClient.invalidateQueries({ queryKey: ['perses', 'all-dashboards'] });
      setSelectedDashboardName(created.metadata.name);
      setStartInEditMode(createMode === 'blank');
      setViewMode('detail');
      setCreateDashOpen(false);
      setFeedback({
        kind: 'success',
        text: `Created dashboard "${getResourceDisplayName(created)}" in project "${selectedProject}".`,
      });
    } catch (err) {
      setDashError(err instanceof Error ? err.message : String(err));
    } finally {
      setDashSaving(false);
    }
  };

  const handleDeleteDashboard = async () => {
    if (!selectedProject || !selectedDashboardName) return;
    setDashSaving(true);
    setFeedback(null);
    try {
      const deleted = selectedDashboardName;
      await deleteDashboard(selectedProject, deleted);
      await queryClient.invalidateQueries({ queryKey: ['perses', 'dashboards', selectedProject] });
      await queryClient.invalidateQueries({ queryKey: ['perses', 'all-dashboards'] });
      setSelectedDashboardName('');
      setDeleteDashOpen(false);
      setViewMode('list');
      setFeedback({ kind: 'success', text: `Deleted dashboard "${deleted}".` });
    } catch (err) {
      setFeedback({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
      setDeleteDashOpen(false);
    } finally {
      setDashSaving(false);
    }
  };

  const normalizedSearch = searchText.trim().toLowerCase();
  const filteredProjectRows = useMemo(() => {
    const list = projects ?? [];
    return list
      .map((proj) => {
        const projDashboards = allDashboardsByProject[proj.metadata.name] ?? [];
        const projMatches =
          !normalizedSearch ||
          proj.metadata.name.toLowerCase().includes(normalizedSearch) ||
          getResourceDisplayName(proj).toLowerCase().includes(normalizedSearch);
        const matchingDashboards = !normalizedSearch
          ? projDashboards
          : projDashboards.filter(
              (d) =>
                d.metadata.name.toLowerCase().includes(normalizedSearch) ||
                getResourceDisplayName(d).toLowerCase().includes(normalizedSearch) ||
                (d.spec?.display?.description ?? '').toLowerCase().includes(normalizedSearch),
            );
        if (normalizedSearch && !projMatches && matchingDashboards.length === 0) {
          return null;
        }
        return {
          project: proj,
          dashboards: projMatches && matchingDashboards.length === 0 ? projDashboards : matchingDashboards,
          autoExpand: Boolean(normalizedSearch && matchingDashboards.length > 0),
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);
  }, [projects, allDashboardsByProject, normalizedSearch]);

  const pagedProjectRows = useMemo(() => {
    const start = projectPage * projectsPerPage;
    return filteredProjectRows.slice(start, start + projectsPerPage);
  }, [filteredProjectRows, projectPage, projectsPerPage]);

  if (loadingProjects) {
    return (
      <Stack alignItems="center" justifyContent="center" sx={{ py: 8 }}>
        <CircularProgress />
      </Stack>
    );
  }

  if (projectsError) {
    return (
      <Alert severity={projectsError instanceof ForbiddenError ? 'warning' : 'error'}>
        {projectsError instanceof ForbiddenError
          ? projectsError.message
          : `Failed to load Perses projects: ${projectsError.message}`}
      </Alert>
    );
  }

  const toggleProjectExpand = (projName: string) => {
    setExpandedProjects((prev) => ({ ...prev, [projName]: !prev[projName] }));
  };

  const setAllExpanded = (expand: boolean) => {
    const next: Record<string, boolean> = {};
    for (const row of filteredProjectRows) {
      next[row.project.metadata.name] = expand;
    }
    setExpandedProjects(next);
  };

  const formatShortDate = (iso?: string) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toISOString().replace('T', ' ').slice(0, 19);
  };

  return (
    <Stack spacing={1.75} sx={{ height: '100%' }}>
      {feedback && (
        <Alert severity={feedback.kind} onClose={() => setFeedback(null)}>
          {feedback.text}
        </Alert>
      )}

      {viewMode === 'list' ? (
        <Card sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <Box
            sx={{
              px: 2,
              py: 1.5,
              borderBottom: `1px solid ${tokens.borderSubtle}`,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 1.25,
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Tooltip title="Refresh projects & dashboards">
                <IconButton
                  size="small"
                  onClick={() => {
                    void queryClient.invalidateQueries({ queryKey: ['perses', 'projects'] });
                    void refetchAllDashboards();
                  }}
                  sx={{ border: `1px solid ${tokens.borderSubtle}`, borderRadius: 1 }}
                >
                  <Refresh fontSize="small" />
                </IconButton>
              </Tooltip>
              <TextField
                size="small"
                placeholder="Search projects or dashboards..."
                value={searchText}
                onChange={(e) => {
                  setSearchText(e.target.value);
                  setProjectPage(0);
                }}
                sx={{ width: { xs: '100%', sm: 290 } }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <Magnify fontSize="small" />
                    </InputAdornment>
                  ),
                }}
              />
              <Button size="small" variant="text" onClick={() => setAllExpanded(true)}>
                Expand all
              </Button>
              <Button size="small" variant="text" onClick={() => setAllExpanded(false)}>
                Collapse all
              </Button>
            </Stack>

            <Stack direction="row" spacing={1} alignItems="center">
              <Button
                size="small"
                variant="outlined"
                startIcon={<FolderPlusOutline />}
                onClick={() => {
                  setProjError(null);
                  setCreateProjOpen(true);
                }}
              >
                New project
              </Button>
              <Button
                size="small"
                variant="contained"
                startIcon={<Plus />}
                disabled={!projects || projects.length === 0}
                onClick={() => openCreateInProject(selectedProject || projects?.[0]?.metadata.name || '')}
              >
                New dashboard
              </Button>
            </Stack>
          </Box>

          <TableContainer sx={{ flex: 1, overflowX: 'auto' }}>
            <Table size="small" stickyHeader sx={{ minWidth: 860 }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 42 }} />
                  <TableCell sx={{ minWidth: 260 }}>Project / Dashboard</TableCell>
                  <TableCell sx={{ minWidth: 180 }}>Details / Panels</TableCell>
                  <TableCell sx={{ minWidth: 165, whiteSpace: 'nowrap' }}>Updated</TableCell>
                  <TableCell align="right" sx={{ minWidth: 180, whiteSpace: 'nowrap' }}>
                    Operations
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {loadingAllDashboards && filteredProjectRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} align="center" sx={{ py: 6 }}>
                      <CircularProgress size={26} />
                    </TableCell>
                  </TableRow>
                ) : pagedProjectRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} align="center" sx={{ py: 6 }}>
                      <Typography variant="body2" color="text.secondary">
                        {projects && projects.length > 0
                          ? 'No projects or dashboards match your search.'
                          : 'No Perses projects exist yet. Click "New project" to create one.'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  pagedProjectRows.map(({ project, dashboards: projDashboards, autoExpand }) => {
                    const pName = project.metadata.name;
                    const isExpanded = Boolean(expandedProjects[pName] ?? autoExpand);
                    return (
                      <React.Fragment key={pName}>
                        <TableRow
                          hover
                          onClick={() => toggleProjectExpand(pName)}
                          sx={{
                            cursor: 'pointer',
                            bgcolor: tokens.bgSubtle,
                            '& td': { fontWeight: 600 },
                          }}
                        >
                          <TableCell>
                            <IconButton size="small" onClick={(e) => { e.stopPropagation(); toggleProjectExpand(pName); }}>
                              {isExpanded ? <ChevronDown fontSize="small" /> : <ChevronRight fontSize="small" />}
                            </IconButton>
                          </TableCell>
                          <TableCell>
                            <Stack direction="row" spacing={1} alignItems="center">
                              <Typography variant="body2" fontWeight={700}>
                                {getResourceDisplayName(project)}
                              </Typography>
                              <Chip
                                size="small"
                                label={pName}
                                variant="outlined"
                                sx={{ height: 20, fontSize: 11, fontFamily: 'monospace' }}
                              />
                            </Stack>
                          </TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              color={projDashboards.length > 0 ? 'primary' : 'default'}
                              variant="outlined"
                              label={`${projDashboards.length} dashboard${projDashboards.length === 1 ? '' : 's'}`}
                              sx={{ height: 22, fontSize: 11 }}
                            />
                          </TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>
                            <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                              {formatShortDate(project.metadata.updatedAt ?? project.metadata.createdAt)}
                            </Typography>
                          </TableCell>
                          <TableCell align="right" sx={{ whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                            <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                              <Tooltip title={`New dashboard in "${pName}"`}>
                                <IconButton size="small" color="primary" onClick={() => openCreateInProject(pName)}>
                                  <Plus fontSize="small" />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title={`Delete project "${pName}"`}>
                                <IconButton
                                  size="small"
                                  color="error"
                                  onClick={() => {
                                    setSelectedProject(pName);
                                    setDeleteProjOpen(true);
                                  }}
                                >
                                  <DeleteOutline fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            </Stack>
                          </TableCell>
                        </TableRow>

                        {isExpanded &&
                          (projDashboards.length === 0 ? (
                            <TableRow>
                              <TableCell />
                              <TableCell colSpan={4}>
                                <Typography variant="caption" color="text.secondary" sx={{ pl: 2 }}>
                                  No dashboards in this project yet. Click + on the right to create or import one.
                                </Typography>
                              </TableCell>
                            </TableRow>
                          ) : (
                            projDashboards.map((dash) => {
                              const dName = dash.metadata.name;
                              const panelCount = Object.keys(dash.spec?.panels ?? {}).length;
                              const dsCount = Object.keys(dash.spec?.datasources ?? {}).length;
                              return (
                                <TableRow key={`${pName}/${dName}`} hover>
                                  <TableCell />
                                  <TableCell sx={{ pl: 4 }}>
                                    <Typography
                                      variant="body2"
                                      fontWeight={600}
                                      color="primary.main"
                                      sx={{ cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
                                      onClick={() => openDashboardDetail(pName, dName, false)}
                                    >
                                      {getResourceDisplayName(dash)}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                                      {dName}
                                      {dash.spec?.display?.description ? ` · ${dash.spec.display.description}` : ''}
                                    </Typography>
                                  </TableCell>
                                  <TableCell>
                                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                                      <Chip
                                        size="small"
                                        variant="outlined"
                                        label={`${panelCount} panel${panelCount === 1 ? '' : 's'}`}
                                        sx={{ height: 20, fontSize: 11 }}
                                      />
                                      {dsCount > 0 && (
                                        <Chip
                                          size="small"
                                          variant="outlined"
                                          label={`${dsCount} ds`}
                                          sx={{ height: 20, fontSize: 11 }}
                                        />
                                      )}
                                    </Stack>
                                  </TableCell>
                                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                                    <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                                      {formatShortDate(dash.metadata.updatedAt ?? dash.metadata.createdAt)}
                                    </Typography>
                                  </TableCell>
                                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                                    <Stack direction="row" spacing={0.25} justifyContent="flex-end">
                                      <Tooltip title="View dashboard">
                                        <IconButton size="small" onClick={() => openDashboardDetail(pName, dName, false)}>
                                          <EyeOutline fontSize="small" />
                                        </IconButton>
                                      </Tooltip>
                                      <Tooltip title="Edit dashboard">
                                        <IconButton size="small" color="primary" onClick={() => openDashboardDetail(pName, dName, true)}>
                                          <PencilOutline fontSize="small" />
                                        </IconButton>
                                      </Tooltip>
                                      <Tooltip title="Clone dashboard">
                                        <IconButton size="small" onClick={() => openCreateInProject(pName, 'clone', dName)}>
                                          <ContentCopy fontSize="small" />
                                        </IconButton>
                                      </Tooltip>
                                      <Tooltip title="Share / Embed iframe">
                                        <IconButton size="small" onClick={() => openShareModal(pName, dash)}>
                                          <ShareVariantOutline fontSize="small" />
                                        </IconButton>
                                      </Tooltip>
                                      <Tooltip title="Export JSON">
                                        <IconButton size="small" onClick={() => handleExportDashboardJson(dash)}>
                                          <DownloadOutline fontSize="small" />
                                        </IconButton>
                                      </Tooltip>
                                      <Tooltip title="Delete dashboard">
                                        <IconButton
                                          size="small"
                                          color="error"
                                          onClick={() => {
                                            setSelectedProject(pName);
                                            setSelectedDashboardName(dName);
                                            setDeleteDashOpen(true);
                                          }}
                                        >
                                          <DeleteOutline fontSize="small" />
                                        </IconButton>
                                      </Tooltip>
                                    </Stack>
                                  </TableCell>
                                </TableRow>
                              );
                            })
                          ))}
                      </React.Fragment>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableContainer>

          <TablePagination
            component="div"
            count={filteredProjectRows.length}
            page={projectPage}
            onPageChange={(_, p) => setProjectPage(p)}
            rowsPerPage={projectsPerPage}
            onRowsPerPageChange={(e) => {
              setProjectsPerPage(parseInt(e.target.value, 10));
              setProjectPage(0);
            }}
            rowsPerPageOptions={[10, 25, 50]}
          />
        </Card>
      ) : (
        <>
          {/* Project & Dashboard Directory Bar (hidden in embed, minimal in fullscreen, compact in View mode) */}
          {!isEmbed && isFullscreen && (
            <Box
              sx={{
                px: 1.5,
                py: 0.75,
                borderRadius: 1.5,
                bgcolor: tokens.bgSurface,
                border: `1px solid ${tokens.borderSubtle}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 1,
              }}
            >
              <Typography variant="body2" fontWeight={700} noWrap>
                {activeDashboard ? getResourceDisplayName(activeDashboard) : selectedDashboardName}
              </Typography>
              {onToggleFullscreen && (
                <Button size="small" variant="outlined" startIcon={<FullscreenExit />} onClick={onToggleFullscreen}>
                  Exit Fullscreen (Esc)
                </Button>
              )}
            </Box>
          )}

          {!isEmbed && !isFullscreen && (
            <Box
              sx={{
                px: 1.5,
                py: startInEditMode ? 1.25 : 0.75,
                borderRadius: 1.5,
                bgcolor: tokens.bgSurface,
                border: `1px solid ${tokens.borderSubtle}`,
                display: 'flex',
                flexDirection: { xs: 'column', lg: 'row' },
                gap: 1,
                alignItems: { xs: 'stretch', lg: 'center' },
                justifyContent: 'space-between',
              }}
            >
              <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                <Button
                  size="small"
                  variant="text"
                  startIcon={<ArrowLeft />}
                  onClick={() => {
                    setStartInEditMode(false);
                    setViewMode('list');
                  }}
                >
                  All Dashboards
                </Button>
                <Typography variant="body2" color="text.secondary">
                  /
                </Typography>
                <FormControl size="small" sx={{ minWidth: startInEditMode ? 170 : 145 }} disabled={!projects || projects.length === 0}>
                  <InputLabel id="project-select-label">Project</InputLabel>
                  <Select
                    labelId="project-select-label"
                    label="Project"
                    value={selectedProject}
                    onChange={(e) => {
                      setSelectedProject(e.target.value);
                      setSelectedDashboardName('');
                      setStartInEditMode(false);
                    }}
                  >
                    {(projects ?? []).map((p) => (
                      <MenuItem key={p.metadata.name} value={p.metadata.name}>
                        {getResourceDisplayName(p)}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                {startInEditMode && (
                  <>
                    <Tooltip title="New project">
                      <IconButton
                        size="small"
                        color="primary"
                        onClick={() => {
                          setProjError(null);
                          setCreateProjOpen(true);
                        }}
                        sx={{ border: `1px solid ${tokens.borderSubtle}`, borderRadius: 1 }}
                      >
                        <FolderPlusOutline fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    {selectedProject && (
                      <Tooltip title={`Delete project "${selectedProject}"`}>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => setDeleteProjOpen(true)}
                          sx={{ border: `1px solid ${tokens.borderSubtle}`, borderRadius: 1 }}
                        >
                          <DeleteOutline fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </>
                )}

                <Typography variant="body2" color="text.secondary">
                  /
                </Typography>
                <FormControl size="small" sx={{ minWidth: startInEditMode ? 220 : 190 }} disabled={!dashboards || dashboards.length === 0}>
                  <InputLabel id="dashboard-select-label">Dashboard</InputLabel>
                  <Select
                    labelId="dashboard-select-label"
                    label="Dashboard"
                    value={selectedDashboardName}
                    onChange={(e) => {
                      setSelectedDashboardName(e.target.value);
                      setStartInEditMode(false);
                    }}
                  >
                    {(dashboards ?? []).map((d) => (
                      <MenuItem key={d.metadata.name} value={d.metadata.name}>
                        {getResourceDisplayName(d)}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                {startInEditMode && (
                  <>
                    <Button
                      size="small"
                      variant="contained"
                      startIcon={<Plus />}
                      disabled={!selectedProject}
                      onClick={openCreateDashboardModal}
                    >
                      New dashboard
                    </Button>
                    {selectedDashboardName && (
                      <Tooltip title={`Delete dashboard "${selectedDashboardName}"`}>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => setDeleteDashOpen(true)}
                          sx={{ border: `1px solid ${tokens.borderSubtle}`, borderRadius: 1 }}
                        >
                          <DeleteOutline fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </>
                )}
              </Stack>

              <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                {startInEditMode &&
                  (scopedDatasourceChips.length === 0 ? (
                    <Chip
                      size="small"
                      variant="outlined"
                      color="warning"
                      label="No data sources · Add one"
                      onClick={() => navigate('/datasources')}
                      sx={{ fontSize: 11.5, cursor: 'pointer' }}
                    />
                  ) : (
                    scopedDatasourceChips.map((ds) => (
                      <Chip
                        key={datasourceTargetKey(ds)}
                        size="small"
                        variant="outlined"
                        label={`${ds.pluginKind.replace('Datasource', '')} | ${ds.name}`}
                        sx={{ fontFamily: 'monospace', fontSize: 11.5 }}
                      />
                    ))
                  ))}
                {activeDashboard && (
                  <Tooltip title="Share / Embed iframe">
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<ShareVariantOutline fontSize="small" />}
                      onClick={() => openShareModal(selectedProject, activeDashboard)}
                    >
                      Share
                    </Button>
                  </Tooltip>
                )}
                {onToggleFullscreen && (
                  <Tooltip title="Fullscreen dashboard">
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<Fullscreen fontSize="small" />}
                      onClick={onToggleFullscreen}
                    >
                      Fullscreen
                    </Button>
                  </Tooltip>
                )}
                <Button
                  size="small"
                  variant={startInEditMode ? 'contained' : 'outlined'}
                  startIcon={<PencilOutline fontSize="small" />}
                  onClick={() => setStartInEditMode((prev) => !prev)}
                >
                  {startInEditMode ? 'Done Managing' : 'Manage'}
                </Button>
              </Stack>
            </Box>
          )}

      {!isEmbed && (!projects || projects.length === 0) && (
        <Card>
          <CardContent sx={{ py: 6, textAlign: 'center' }}>
            <Stack spacing={1.5} alignItems="center">
              <Typography variant="subtitle1" fontWeight={700}>
                No Perses projects exist yet
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Create a project to organize dashboards, project datasources, and project-scoped RBAC roles.
              </Typography>
              <Button
                variant="contained"
                startIcon={<FolderPlusOutline />}
                onClick={() => {
                  setProjError(null);
                  setCreateProjOpen(true);
                }}
              >
                Create first project
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}

      {dashboardsError && (
        <Alert severity={dashboardsError instanceof ForbiddenError ? 'warning' : 'error'}>
          {dashboardsError instanceof ForbiddenError
            ? dashboardsError.message
            : `Failed to load dashboards: ${dashboardsError.message}`}
        </Alert>
      )}
      {activeDashboardError && (
        <Alert severity="error">Failed to load dashboard payload: {activeDashboardError.message}</Alert>
      )}

      {(loadingDashboards || loadingActiveDashboard) && selectedProject && (
        <Stack alignItems="center" justifyContent="center" sx={{ py: 8 }}>
          <CircularProgress />
        </Stack>
      )}

      {selectedProject && !loadingDashboards && dashboards && dashboards.length === 0 && (
        <Card>
          <CardContent sx={{ py: 6, textAlign: 'center' }}>
            <Stack spacing={1.5} alignItems="center">
              <Typography variant="subtitle1" fontWeight={700}>
                Project &ldquo;{selectedProject}&rdquo; has no dashboards yet
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Create a blank dashboard, clone an existing one, or import Perses dashboard JSON.
              </Typography>
              <Button variant="contained" startIcon={<Plus />} onClick={openCreateDashboardModal}>
                Create dashboard
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}

      {displayedDashboard && (
        <Box sx={{ flex: 1, minHeight: 0 }}>
          <ErrorBoundary FallbackComponent={ErrorAlert}>
            <PluginRegistry
              pluginLoader={pluginLoader}
              defaultPluginKinds={{
                Panel: 'TimeSeriesChart',
                TimeSeriesQuery: 'PrometheusTimeSeriesQuery',
              }}
            >
              <ValidationProvider>
                <ErrorBoundary FallbackComponent={ErrorAlert}>
                  <ViewDashboard
                    key={`${displayedDashboard.metadata.project}/${displayedDashboard.metadata.name}/${embedPanelKey}`}
                    dashboardResource={displayedDashboard}
                    datasourceApi={datasourceApi}
                    isInitialVariableSticky={!isEmbed}
                    isAnnotationEnabled={!isEmbed}
                    isReadonly={isEmbed}
                    isEditing={isEmbed ? false : startInEditMode}
                    isVariableEnabled={!isEmbed || !embedPanelKey}
                    isDatasourceEnabled={!isEmbed}
                    onSave={handleSaveDashboard}
                  />
                </ErrorBoundary>
              </ValidationProvider>
            </PluginRegistry>
          </ErrorBoundary>
        </Box>
      )}
        </>
      )}

      {/* Create Project Dialog */}
      <Dialog open={createProjOpen} onClose={() => setCreateProjOpen(false)} maxWidth="xs" fullWidth>
        <Box component="form" onSubmit={handleCreateProject}>
          <DialogTitle>Create Project</DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2}>
              {projError && <Alert severity="error">{projError}</Alert>}
              <TextField
                label="Project ID (metadata.name)"
                placeholder="e.g. platform-team"
                value={projName}
                onChange={(e) => setProjName(e.target.value)}
                required
                fullWidth
                size="small"
              />
              <TextField
                label="Display Name (optional)"
                placeholder="e.g. Platform Engineering"
                value={projDisplayName}
                onChange={(e) => setProjDisplayName(e.target.value)}
                fullWidth
                size="small"
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCreateProjOpen(false)} disabled={projSaving}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={projSaving}>
              {projSaving ? 'Creating...' : 'Create Project'}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      {/* Delete Project Confirmation */}
      <Dialog open={deleteProjOpen} onClose={() => setDeleteProjOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete Project</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2">
            Are you sure you want to delete project <strong>{selectedProject}</strong> and all dashboards inside it?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteProjOpen(false)} disabled={projSaving}>
            Cancel
          </Button>
          <Button color="error" variant="contained" onClick={handleDeleteProject} disabled={projSaving}>
            {projSaving ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Create Dashboard Dialog (Blank / Clone / Import JSON) */}
      <Dialog open={createDashOpen} onClose={() => setCreateDashOpen(false)} maxWidth="sm" fullWidth>
        <Box component="form" onSubmit={handleCreateDashboard}>
          <DialogTitle>New Dashboard in &ldquo;{selectedProject}&rdquo;</DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2}>
              <Tabs
                value={createMode}
                onChange={(_, v: 'blank' | 'clone' | 'import') => {
                  setCreateMode(v);
                  setDashError(null);
                }}
                sx={{ borderBottom: `1px solid ${tokens.borderSubtle}` }}
              >
                <Tab value="blank" label="Blank" />
                <Tab value="clone" label="Clone Existing" />
                <Tab value="import" label="Import JSON" />
              </Tabs>

              {dashError && <Alert severity="error">{dashError}</Alert>}

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Dashboard ID (metadata.name)"
                  placeholder="e.g. service-latency"
                  value={dashName}
                  onChange={(e) => setDashName(e.target.value)}
                  required={createMode !== 'import'}
                  fullWidth
                  size="small"
                  helperText={createMode === 'import' ? 'Optional if metadata.name is inside JSON' : undefined}
                />
                <TextField
                  label="Display Name"
                  placeholder="e.g. Service Latency & Errors"
                  value={dashDisplayName}
                  onChange={(e) => setDashDisplayName(e.target.value)}
                  fullWidth
                  size="small"
                />
              </Stack>

              {createMode === 'clone' && (
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <FormControl size="small" fullWidth>
                    <InputLabel>Source Project</InputLabel>
                    <Select
                      label="Source Project"
                      value={cloneSourceProject}
                      onChange={(e) => {
                        setCloneSourceProject(e.target.value);
                        setCloneSourceDashboard('');
                      }}
                    >
                      {(projects ?? []).map((p) => (
                        <MenuItem key={p.metadata.name} value={p.metadata.name}>
                          {getResourceDisplayName(p)}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <FormControl size="small" fullWidth>
                    <InputLabel>Source Dashboard</InputLabel>
                    <Select
                      label="Source Dashboard"
                      value={cloneSourceDashboard}
                      onChange={(e) => setCloneSourceDashboard(e.target.value)}
                    >
                      {cloneProjectDashboards.map((d) => (
                        <MenuItem key={d.metadata.name} value={d.metadata.name}>
                          {getResourceDisplayName(d)}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Stack>
              )}

              {createMode === 'import' && (
                <Stack spacing={1.25}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
                    <Typography variant="caption" color="text.secondary">
                      Paste a <strong>Perses</strong> or <strong>Grafana</strong> Dashboard JSON document, or upload a{' '}
                      <code>.json</code> file.
                    </Typography>
                    <Stack direction="row" spacing={1} alignItems="center">
                      {detectedImportFormat === 'grafana' && (
                        <Chip size="small" color="info" variant="outlined" label="Grafana JSON detected" />
                      )}
                      {detectedImportFormat === 'perses' && (
                        <Chip size="small" color="success" variant="outlined" label="Perses JSON detected" />
                      )}
                      <Button size="small" variant="outlined" component="label">
                        Upload .json
                        <input type="file" hidden accept="application/json,.json" onChange={handleImportFile} />
                      </Button>
                    </Stack>
                  </Stack>

                  {detectedImportFormat === 'grafana' && (
                    <Alert
                      severity="info"
                      action={
                        <Button
                          size="small"
                          color="inherit"
                          disabled={migratingGrafana || dashSaving}
                          onClick={() => void handlePreviewMigrateGrafana()}
                        >
                          {migratingGrafana ? 'Converting...' : 'Convert & Preview'}
                        </Button>
                      }
                    >
                      Grafana JSON will be auto-converted via Perses <code>/api/migrate</code>.
                    </Alert>
                  )}

                  <TextField
                    multiline
                    minRows={6}
                    maxRows={12}
                    placeholder='Paste Perses JSON ({"kind": "Dashboard", ...}) or Grafana JSON ({"title": "...", "panels": [...]})'
                    value={importJsonText}
                    onChange={(e) => setImportJsonText(e.target.value)}
                    fullWidth
                    InputProps={{ sx: { fontFamily: 'monospace', fontSize: 12 } }}
                  />

                  <FormControlLabel
                    control={
                      <Checkbox
                        size="small"
                        checked={useDefaultDatasource}
                        onChange={(e) => setUseDefaultDatasource(e.target.checked)}
                      />
                    }
                    label={
                      <Typography variant="caption" color="text.secondary">
                        Map Grafana panel targets to cluster default Perses datasources when migrating
                      </Typography>
                    }
                  />
                </Stack>
              )}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCreateDashOpen(false)} disabled={dashSaving}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={dashSaving}>
              {dashSaving ? 'Creating...' : 'Create Dashboard'}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      {/* Delete Dashboard Confirmation */}
      <Dialog open={deleteDashOpen} onClose={() => setDeleteDashOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete Dashboard</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2">
            Are you sure you want to delete dashboard <strong>{selectedDashboardName}</strong> from project{' '}
            <strong>{selectedProject}</strong>?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDashOpen(false)} disabled={dashSaving}>
            Cancel
          </Button>
          <Button color="error" variant="contained" onClick={handleDeleteDashboard} disabled={dashSaving}>
            {dashSaving ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
      {/* Share & Embed Modal */}
      <Dialog open={Boolean(shareTarget)} onClose={() => setShareTarget(null)} maxWidth="sm" fullWidth>
        <DialogTitle>
          Share &amp; Embed: {shareTarget ? getResourceDisplayName(shareTarget.dashboard) : ''}
        </DialogTitle>
        <DialogContent dividers>
          {shareTarget && (() => {
            const panelEntries = Object.entries(shareTarget.dashboard.spec?.panels ?? {});
            const origin = typeof window !== 'undefined' ? window.location.origin : '';
            const params = new URLSearchParams();
            if (shareScope === 'panel' && sharePanelKey) {
              params.set('panel', sharePanelKey);
            }
            if (shareVisibility === 'public') {
              params.set('public', '1');
            }
            const queryStr = params.toString();
            const embedUrl = `${origin}/embed/projects/${encodeURIComponent(shareTarget.project)}/dashboards/${encodeURIComponent(shareTarget.dashboard.metadata.name)}${queryStr ? `?${queryStr}` : ''}`;
            const iframeHtml = `<iframe src="${embedUrl}" width="100%" height="${shareScope === 'panel' ? 420 : 680}" frameborder="0" allowfullscreen></iframe>`;

            const copyShare = async (kind: 'url' | 'iframe', text: string) => {
              try {
                await navigator.clipboard.writeText(text);
                setShareCopied(kind);
                setTimeout(() => setShareCopied((prev) => (prev === kind ? null : prev)), 2000);
              } catch {
                // Ignore clipboard errors
              }
            };

            return (
              <Stack spacing={2}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <FormControl size="small" fullWidth>
                    <InputLabel id="share-scope-label">Share Scope</InputLabel>
                    <Select
                      labelId="share-scope-label"
                      label="Share Scope"
                      value={shareScope}
                      onChange={(e) => setShareScope(e.target.value as 'dashboard' | 'panel')}
                    >
                      <MenuItem value="dashboard">Full Dashboard</MenuItem>
                      <MenuItem value="panel" disabled={panelEntries.length === 0}>
                        Single Panel {panelEntries.length === 0 ? '(none)' : ''}
                      </MenuItem>
                    </Select>
                  </FormControl>

                  <FormControl size="small" fullWidth>
                    <InputLabel id="share-vis-label">Access Mode</InputLabel>
                    <Select
                      labelId="share-vis-label"
                      label="Access Mode"
                      value={shareVisibility}
                      onChange={(e) => setShareVisibility(e.target.value as 'private' | 'public')}
                    >
                      <MenuItem value="private">Private (Requires Login Session)</MenuItem>
                      <MenuItem value="public">Public (Unauthenticated / Guest Read)</MenuItem>
                    </Select>
                  </FormControl>
                </Stack>

                {shareScope === 'panel' && panelEntries.length > 0 && (
                  <FormControl size="small" fullWidth>
                    <InputLabel id="share-panel-label">Select Panel</InputLabel>
                    <Select
                      labelId="share-panel-label"
                      label="Select Panel"
                      value={sharePanelKey}
                      onChange={(e) => setSharePanelKey(e.target.value)}
                    >
                      {panelEntries.map(([key, panel]) => (
                        <MenuItem key={key} value={key}>
                          {panel.spec?.display?.name || key} ({key})
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}

                {shareVisibility === 'public' ? (
                  <Alert severity="info">
                    Public embeds bypass the login screen. Make sure Perses <code>guest_permissions</code> in Helm{' '}
                    <code>values.yaml</code> grants <code>read</code> on <code>Dashboard</code>, <code>Datasource</code>,
                    and <code>GlobalDatasource</code> for unauthenticated visitors.
                  </Alert>
                ) : (
                  <Alert severity="info">
                    Private embeds reuse the viewer&apos;s Perses/Keycloak browser session. For cross-domain{' '}
                    <code>&lt;iframe&gt;</code> embeds, set <code>perses.config.security.cookie.same_site: none</code>{' '}
                    (with HTTPS).
                  </Alert>
                )}

                <TextField
                  label="Embed URL"
                  size="small"
                  value={embedUrl}
                  fullWidth
                  InputProps={{
                    readOnly: true,
                    sx: { fontFamily: 'monospace', fontSize: 12 },
                    endAdornment: (
                      <Button
                        size="small"
                        startIcon={shareCopied === 'url' ? <Check fontSize="small" /> : <ContentCopy fontSize="small" />}
                        onClick={() => void copyShare('url', embedUrl)}
                      >
                        {shareCopied === 'url' ? 'Copied' : 'Copy'}
                      </Button>
                    ),
                  }}
                />

                <TextField
                  label="HTML <iframe> Snippet"
                  size="small"
                  value={iframeHtml}
                  fullWidth
                  multiline
                  minRows={2}
                  InputProps={{
                    readOnly: true,
                    sx: { fontFamily: 'monospace', fontSize: 12 },
                    endAdornment: (
                      <Button
                        size="small"
                        startIcon={shareCopied === 'iframe' ? <Check fontSize="small" /> : <ContentCopy fontSize="small" />}
                        onClick={() => void copyShare('iframe', iframeHtml)}
                      >
                        {shareCopied === 'iframe' ? 'Copied' : 'Copy'}
                      </Button>
                    ),
                  }}
                />
              </Stack>
            );
          })()}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShareTarget(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
