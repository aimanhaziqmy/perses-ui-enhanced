import { Alert, AlertTitle, Box, Button, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import React from 'react';

export interface ViewLoadingStateProps {
  message?: string;
  minHeight?: number | string;
}

export function ViewLoadingState({ message = 'Loading...', minHeight = 200 }: ViewLoadingStateProps) {
  return (
    <Stack
      alignItems="center"
      justifyContent="center"
      spacing={1.5}
      sx={{ minHeight, py: 4, px: 2 }}
    >
      <CircularProgress size={28} />
      <Typography variant="body2" color="text.secondary">
        {message}
      </Typography>
    </Stack>
  );
}

export interface ViewEmptyStateProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  minHeight?: number | string;
}

export function ViewEmptyState({
  title,
  description,
  icon,
  action,
  minHeight = 180,
}: ViewEmptyStateProps) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 4,
        minHeight,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        bgcolor: 'background.paper',
      }}
    >
      {icon && (
        <Box sx={{ color: 'text.secondary', mb: 1.5, display: 'flex', alignItems: 'center' }}>
          {icon}
        </Box>
      )}
      <Typography variant="subtitle1" fontWeight={700} color="text.primary">
        {title}
      </Typography>
      {description && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75, maxWidth: 460 }}>
          {description}
        </Typography>
      )}
      {action && <Box sx={{ mt: 2 }}>{action}</Box>}
    </Paper>
  );
}

export interface ViewErrorStateProps {
  title?: string;
  error: unknown;
  onRetry?: () => void;
  retryLabel?: string;
}

export function ViewErrorState({
  title = 'Failed to load data',
  error,
  onRetry,
  retryLabel = 'Retry',
}: ViewErrorStateProps) {
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
  return (
    <Alert
      severity="error"
      action={
        onRetry ? (
          <Button color="inherit" size="small" onClick={onRetry}>
            {retryLabel}
          </Button>
        ) : undefined
      }
      sx={{ alignItems: 'flex-start' }}
    >
      <AlertTitle>{title}</AlertTitle>
      {message}
    </Alert>
  );
}

export interface ViewForbiddenStateProps {
  title?: string;
  description?: string;
  onBack?: () => void;
  backLabel?: string;
}

export function ViewForbiddenState({
  title = '403 — Forbidden',
  description = 'You do not have administrator permissions to access this page.',
  onBack,
  backLabel = 'Back to Dashboards',
}: ViewForbiddenStateProps) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 360, px: 2 }}>
      <Paper
        variant="outlined"
        sx={{
          p: 4,
          maxWidth: 480,
          width: '100%',
          textAlign: 'center',
          bgcolor: 'background.paper',
        }}
      >
        <Typography variant="h5" fontWeight={700} color="error.main" gutterBottom>
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: onBack ? 2.5 : 0 }}>
          {description}
        </Typography>
        {onBack && (
          <Button variant="contained" size="small" onClick={onBack}>
            {backLabel}
          </Button>
        )}
      </Paper>
    </Box>
  );
}
