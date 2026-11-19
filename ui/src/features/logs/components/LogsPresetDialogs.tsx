import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
} from '@mui/material';
import DeleteOutline from 'mdi-material-ui/DeleteOutline';
import PencilOutline from 'mdi-material-ui/PencilOutline';
import Plus from 'mdi-material-ui/Plus';
import React from 'react';

import type { LogPresetItem } from '@/lib/api/logs';

export interface LogsPresetDialogsProps {
  presetDialogOpen: boolean;
  onClosePresetDialog: () => void;
  presetMode: 'create' | 'edit';
  presetLabel: string;
  onChangePresetLabel: (v: string) => void;
  presetQuery: string;
  onChangePresetQuery: (v: string) => void;
  presetDesc: string;
  onChangePresetDesc: (v: string) => void;
  presetSaving: boolean;
  presetError: string | null;
  onSavePreset: (e: React.FormEvent) => void;
  managePresetsOpen: boolean;
  onCloseManagePresets: () => void;
  presets: LogPresetItem[];
  onEditPreset: (preset: LogPresetItem) => void;
  onDeletePreset: (preset: LogPresetItem) => void;
  onAddPreset: () => void;
}

export function LogsPresetDialogs({
  presetDialogOpen,
  onClosePresetDialog,
  presetMode,
  presetLabel,
  onChangePresetLabel,
  presetQuery,
  onChangePresetQuery,
  presetDesc,
  onChangePresetDesc,
  presetSaving,
  presetError,
  onSavePreset,
  managePresetsOpen,
  onCloseManagePresets,
  presets,
  onEditPreset,
  onDeletePreset,
  onAddPreset,
}: LogsPresetDialogsProps) {
  return (
    <>
      {/* Create / Edit Log Preset Dialog */}
      <Dialog open={presetDialogOpen} onClose={onClosePresetDialog} maxWidth="sm" fullWidth>
        <Box component="form" onSubmit={onSavePreset}>
          <DialogTitle>{presetMode === 'create' ? 'Save Shared Log Preset' : 'Edit Log Preset'}</DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2}>
              {presetError && <Alert severity="error">{presetError}</Alert>}
              <TextField
                label="Preset Name"
                placeholder="e.g. Ingress 5xx Errors"
                value={presetLabel}
                onChange={(e) => onChangePresetLabel(e.target.value)}
                required
                fullWidth
                size="small"
              />
              <TextField
                label="LogsQL Query"
                value={presetQuery}
                onChange={(e) => onChangePresetQuery(e.target.value)}
                required
                fullWidth
                multiline
                minRows={2}
                size="small"
                InputProps={{ sx: { fontFamily: 'monospace', fontSize: 12.5 } }}
              />
              <TextField
                label="Description (optional)"
                value={presetDesc}
                onChange={(e) => onChangePresetDesc(e.target.value)}
                fullWidth
                size="small"
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={onClosePresetDialog} disabled={presetSaving}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={presetSaving}>
              {presetSaving ? 'Saving...' : 'Save Preset'}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      {/* Manage Presets Dialog */}
      <Dialog open={managePresetsOpen} onClose={onCloseManagePresets} maxWidth="sm" fullWidth>
        <DialogTitle>Manage Shared Log Presets</DialogTitle>
        <DialogContent dividers>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Label</TableCell>
                <TableCell>LogsQL Query</TableCell>
                <TableCell align="right" width={96}>
                  Actions
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {presets.map((preset) => (
                <TableRow key={preset.id} hover>
                  <TableCell sx={{ fontWeight: 600 }}>{preset.label}</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: 11.5 }}>{preset.query}</TableCell>
                  <TableCell align="right">
                    <IconButton
                      size="small"
                      onClick={() => {
                        onCloseManagePresets();
                        onEditPreset(preset);
                      }}
                    >
                      <PencilOutline fontSize="small" />
                    </IconButton>
                    <Tooltip title={presets.length <= 1 ? 'At least one preset is required' : 'Delete preset'}>
                      <span>
                        <IconButton
                          size="small"
                          color="error"
                          disabled={presets.length <= 1}
                          onClick={() => onDeletePreset(preset)}
                        >
                          <DeleteOutline fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DialogContent>
        <DialogActions>
          <Button
            variant="outlined"
            startIcon={<Plus />}
            onClick={() => {
              onCloseManagePresets();
              onAddPreset();
            }}
          >
            Add Preset
          </Button>
          <Button onClick={onCloseManagePresets}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
