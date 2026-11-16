import { createTheme } from '@mui/material';
import type { Theme } from '@mui/material';
import type { PersesChartsTheme } from '@perses-dev/components';
import { generateChartsTheme, getTheme } from '@perses-dev/components';

export type ThemeMode = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'perses-theme-mode';

export interface ThemeTokenSet {
  bgCanvas: string;
  bgSurface: string;
  bgSidebar: string;
  bgHeader: string;
  bgSubtle: string;
  bgHover: string;
  bgActiveNav: string;
  borderSubtle: string;
  primary: string;
  primaryLight: string;
  primaryDark: string;
  secondary: string;
  textPrimary: string;
  textSecondary: string;
  success: string;
  warning: string;
  error: string;
  chartBarPurple: string;
  tableHeaderBg: string;
}

export const PALETTE_TOKENS: Record<ThemeMode, ThemeTokenSet> = {
  light: {
    bgCanvas: '#F5F6FA',
    bgSurface: '#FFFFFF',
    bgSidebar: '#FFFFFF',
    bgHeader: '#FFFFFF',
    bgSubtle: '#F8FAFC',
    bgHover: '#F1F5F9',
    bgActiveNav: '#F0EEFF',
    borderSubtle: '#E5E7EB',
    primary: '#5B4FE9',
    primaryLight: '#7C72F2',
    primaryDark: '#4338CA',
    secondary: '#0EA5E9',
    textPrimary: '#1E293B',
    textSecondary: '#64748B',
    success: '#16A34A',
    warning: '#F59E0B',
    error: '#EF4444',
    chartBarPurple: '#6B5CE7',
    tableHeaderBg: '#F9FAFB',
  },
  dark: {
    bgCanvas: '#0B0F19',
    bgSurface: '#111827',
    bgSidebar: '#0F172A',
    bgHeader: '#111827',
    bgSubtle: '#1A2234',
    bgHover: '#1E293B',
    bgActiveNav: 'rgba(129, 140, 248, 0.16)',
    borderSubtle: 'rgba(148, 163, 184, 0.16)',
    primary: '#818CF8',
    primaryLight: '#A5B4FC',
    primaryDark: '#4F46E5',
    secondary: '#38BDF8',
    textPrimary: '#F1F5F9',
    textSecondary: '#94A3B8',
    success: '#34D399',
    warning: '#FBBF24',
    error: '#F87171',
    chartBarPurple: '#818CF8',
    tableHeaderBg: '#161F30',
  },
};

export const PERSES_COLORS = {
  bgDeep: PALETTE_TOKENS.dark.bgCanvas,
  bgSurface: PALETTE_TOKENS.dark.bgSurface,
  bgElevated: PALETTE_TOKENS.dark.bgSubtle,
  borderSubtle: PALETTE_TOKENS.dark.borderSubtle,
  accentCyan: '#38BDF8',
  accentIndigo: '#818CF8',
  accentEmerald: '#34D399',
  accentAmber: '#FBBF24',
  accentRose: '#F87171',
  textPrimary: PALETTE_TOKENS.dark.textPrimary,
  textSecondary: PALETTE_TOKENS.dark.textSecondary,
};

export function readStoredThemeMode(): ThemeMode {
  try {
    const val = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (val === 'dark' || val === 'light') {
      return val;
    }
  } catch {
    // Ignore storage access errors in restricted frames
  }
  return 'light';
}

export function createPersesTheme(mode: ThemeMode): Theme {
  const tokens = PALETTE_TOKENS[mode];
  const base = getTheme(mode);

  return createTheme(base, {
    palette: {
      ...base.palette,
      mode,
      designSystem: base.palette.designSystem,
      primary: {
        main: tokens.primary,
        light: tokens.primaryLight,
        dark: tokens.primaryDark,
      },
      secondary: {
        main: tokens.secondary,
      },
      success: {
        main: tokens.success,
      },
      warning: {
        main: tokens.warning,
      },
      error: {
        main: tokens.error,
      },
      background: {
        default: tokens.bgCanvas,
        paper: tokens.bgSurface,
      },
      divider: tokens.borderSubtle,
      text: {
        primary: tokens.textPrimary,
        secondary: tokens.textSecondary,
      },
    },
    typography: {
      fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    },
    shape: {
      borderRadius: 8,
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            backgroundColor: tokens.bgCanvas,
            color: tokens.textPrimary,
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            border: `1px solid ${tokens.borderSubtle}`,
            boxShadow: mode === 'light' ? '0 1px 2px rgba(15, 23, 42, 0.04)' : 'none',
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundColor: tokens.bgSurface,
            backgroundImage: 'none',
            border: `1px solid ${tokens.borderSubtle}`,
            boxShadow: mode === 'light' ? '0 1px 2px rgba(15, 23, 42, 0.04)' : 'none',
          },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          head: {
            backgroundColor: tokens.tableHeaderBg,
            color: tokens.textSecondary,
            fontWeight: 600,
            fontSize: '0.75rem',
            borderBottom: `1px solid ${tokens.borderSubtle}`,
            paddingTop: 10,
            paddingBottom: 10,
          },
          body: {
            borderBottom: `1px solid ${tokens.borderSubtle}`,
            fontSize: '0.8125rem',
            paddingTop: 10,
            paddingBottom: 10,
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            fontWeight: 600,
            borderRadius: 6,
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            fontWeight: 500,
          },
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            backgroundColor: mode === 'light' ? '#0F172A' : '#0B1220',
            color: '#F8FAFC',
            border: '1px solid rgba(148, 163, 184, 0.28)',
            borderRadius: 8,
            fontSize: '0.75rem',
            lineHeight: 1.45,
            padding: '6px 10px',
            boxShadow:
              mode === 'light'
                ? '0 10px 25px -5px rgba(15, 23, 42, 0.22)'
                : '0 12px 28px -4px rgba(0, 0, 0, 0.65)',
          },
          arrow: {
            color: mode === 'light' ? '#0F172A' : '#0B1220',
          },
        },
      },
    },
  });
}

export function createPersesChartsTheme(muiTheme: Theme, mode: ThemeMode): PersesChartsTheme {
  const tokens = PALETTE_TOKENS[mode];
  return generateChartsTheme(muiTheme, {
    echartsTheme: {
      color:
        mode === 'light'
          ? ['#16A34A', '#0EA5E9', '#5B4FE9', '#F59E0B', '#EC4899', '#14B8A6', '#F97316', '#8B5CF6']
          : ['#34D399', '#38BDF8', '#818CF8', '#FBBF24', '#F472B6', '#2DD4BF', '#FB923C', '#A78BFA'],
      backgroundColor: 'transparent',
      textStyle: {
        color: tokens.textSecondary,
      },
      title: {
        textStyle: {
          color: tokens.textPrimary,
        },
      },
      legend: {
        textStyle: {
          color: tokens.textSecondary,
        },
      },
      tooltip: {
        backgroundColor: mode === 'light' ? '#FFFFFF' : '#0F172A',
        borderColor: tokens.borderSubtle,
        textStyle: {
          color: tokens.textPrimary,
        },
      },
      categoryAxis: {
        axisLine: { lineStyle: { color: tokens.borderSubtle } },
        splitLine: {
          lineStyle: {
            color: mode === 'light' ? 'rgba(15, 23, 42, 0.06)' : 'rgba(148, 163, 184, 0.08)',
          },
        },
      },
      valueAxis: {
        axisLine: { lineStyle: { color: tokens.borderSubtle } },
        splitLine: {
          lineStyle: {
            color: mode === 'light' ? 'rgba(15, 23, 42, 0.06)' : 'rgba(148, 163, 184, 0.08)',
          },
        },
      },
    },
  });
}

export const persesTheme = createPersesTheme('dark');
export const persesChartsTheme = createPersesChartsTheme(persesTheme, 'dark');

