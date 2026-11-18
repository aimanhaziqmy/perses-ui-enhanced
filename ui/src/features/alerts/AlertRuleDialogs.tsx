import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import React from 'react';

import type {
  AlertRuleConditionOp,
  AlertRuleDefinition,
  DatasourceTarget,
  LiveAlertRuleEvaluation,
} from '@/api/persesClient';
import { datasourceTargetKey } from '@/api/persesClient';
import { JsonViewer } from '@/components/ui/JsonViewer';

export interface RuleFormState {
  mode: 'create' | 'edit';
  id: string;
  name: string;
  group: string;
  datasourceType: 'prometheus' | 'victorialogs';
  datasourceName: string;
  query: string;
  conditionOp: AlertRuleConditionOp;
  threshold: string;
  thresholdLabel: string;
  severity: 'critical' | 'warning' | 'info';
  lookbackMinutes: string;
  enabled: boolean;
}

export interface AlertRuleDialogsProps {
  suggestedGroups: string[];
  targetOptionsForForm: DatasourceTarget[];
  formOpen: boolean;
  form: RuleFormState;
  formError: string | null;
  saving: boolean;
  onCloseForm: () => void;
  onChangeForm: React.Dispatch<React.SetStateAction<RuleFormState>>;
  onSaveRule: (e: React.FormEvent) => void;
  deleteTarget: AlertRuleDefinition | null;
  onCloseDelete: () => void;
  onConfirmDelete: () => void;
  selectedRule: LiveAlertRuleEvaluation | null;
  onCloseInspect: () => void;
}

export function AlertRuleDialogs({
  suggestedGroups,
  targetOptionsForForm,
  formOpen,
  form,
  formError,
  saving,
  onCloseForm,
  onChangeForm,
  onSaveRule,
  deleteTarget,
  onCloseDelete,
  onConfirmDelete,
  selectedRule,
  onCloseInspect,
}: AlertRuleDialogsProps) {
  return (
    <>
      {/* Create / Edit Rule Dialog */}
      <Dialog open={formOpen} onClose={onCloseForm} maxWidth="sm" fullWidth>
        <Box component="form" onSubmit={onSaveRule}>
          <DialogTitle>{form.mode === 'create' ? 'Create Alert Rule' : `Edit Alert Rule: ${form.name}`}</DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2}>
              {formError && <Alert severity="error">{formError}</Alert>}

              <TextField
                label="Rule Name"
                placeholder="e.g. High CPU Load > 90%"
                value={form.name}
                onChange={(e) => onChangeForm((prev) => ({ ...prev, name: e.target.value }))}
                required
                fullWidth
                size="small"
              />

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Group"
                  value={form.group}
                  onChange={(e) => onChangeForm((prev) => ({ ...prev, group: e.target.value }))}
                  fullWidth
                  size="small"
                  helperText={`Suggested: ${suggestedGroups.slice(0, 4).join(', ')}`}
                />

                <FormControl size="small" fullWidth>
                  <InputLabel>Severity</InputLabel>
                  <Select
                    label="Severity"
                    value={form.severity}
                    onChange={(e) =>
                      onChangeForm((prev) => ({ ...prev, severity: e.target.value as RuleFormState['severity'] }))
                    }
                  >
                    <MenuItem value="critical">Critical</MenuItem>
                    <MenuItem value="warning">Warning</MenuItem>
                    <MenuItem value="info">Info</MenuItem>
                  </Select>
                </FormControl>
              </Stack>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <FormControl size="small" fullWidth>
                  <InputLabel>Query Engine</InputLabel>
                  <Select
                    label="Query Engine"
                    value={form.datasourceType}
                    onChange={(e) =>
                      onChangeForm((prev) => ({
                        ...prev,
                        datasourceType: e.target.value as 'prometheus' | 'victorialogs',
                        datasourceName: '',
                      }))
                    }
                  >
                    <MenuItem value="prometheus">Prometheus / Metrics (PromQL)</MenuItem>
                    <MenuItem value="victorialogs">VictoriaLogs (LogsQL)</MenuItem>
                  </Select>
                </FormControl>

                <FormControl size="small" fullWidth>
                  <InputLabel>Target Datasource</InputLabel>
                  <Select
                    label="Target Datasource"
                    value={form.datasourceName}
                    onChange={(e) => onChangeForm((prev) => ({ ...prev, datasourceName: e.target.value }))}
                  >
                    <MenuItem value="">Auto (Default datasource)</MenuItem>
                    {targetOptionsForForm.map((t) => (
                      <MenuItem key={datasourceTargetKey(t)} value={t.name}>
                        {t.name} ({t.scope === 'global' ? 'Global' : t.project})
                      </MenuItem>
                    ))}
                    {form.datasourceName &&
                      !targetOptionsForForm.some(
                        (t) => t.name === form.datasourceName || datasourceTargetKey(t) === form.datasourceName,
                      ) && <MenuItem value={form.datasourceName}>{form.datasourceName} (missing)</MenuItem>}
                  </Select>
                </FormControl>
              </Stack>

              <TextField
                label={form.datasourceType === 'prometheus' ? 'PromQL Query' : 'LogsQL Query'}
                placeholder={
                  form.datasourceType === 'prometheus'
                    ? 'e.g. 100 - (avg by (node) (rate(node_cpu_seconds_total{mode="idle"}[2m])) * 100)'
                    : 'e.g. level:="error" OR OOMKilled'
                }
                value={form.query}
                onChange={(e) => onChangeForm((prev) => ({ ...prev, query: e.target.value }))}
                required
                fullWidth
                multiline
                minRows={2}
                size="small"
                InputProps={{ sx: { fontFamily: 'monospace', fontSize: 12.5 } }}
              />

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <FormControl size="small" fullWidth>
                  <InputLabel>Fire Condition</InputLabel>
                  <Select
                    label="Fire Condition"
                    value={form.conditionOp}
                    onChange={(e) =>
                      onChangeForm((prev) => ({ ...prev, conditionOp: e.target.value as AlertRuleConditionOp }))
                    }
                  >
                    <MenuItem value=">">Value &gt; Threshold</MenuItem>
                    <MenuItem value=">=">Value &gt;= Threshold</MenuItem>
                    <MenuItem value="<">Value &lt; Threshold</MenuItem>
                    <MenuItem value="<=">Value &lt;= Threshold</MenuItem>
                    <MenuItem value="==">Value == Threshold</MenuItem>
                    <MenuItem value="!=">Value != Threshold</MenuItem>
                    <MenuItem value="nonempty">Result non-empty (&gt; 0 series/logs)</MenuItem>
                    <MenuItem value="empty">Result empty (0 series/logs)</MenuItem>
                  </Select>
                </FormControl>

                {!['nonempty', 'empty'].includes(form.conditionOp) && (
                  <TextField
                    label="Threshold Value"
                    type="number"
                    value={form.threshold}
                    onChange={(e) => onChangeForm((prev) => ({ ...prev, threshold: e.target.value }))}
                    fullWidth
                    size="small"
                  />
                )}
              </Stack>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Display Threshold Label (optional)"
                  placeholder="e.g. < 85% or == 0"
                  value={form.thresholdLabel}
                  onChange={(e) => onChangeForm((prev) => ({ ...prev, thresholdLabel: e.target.value }))}
                  fullWidth
                  size="small"
                />

                {form.datasourceType === 'victorialogs' && (
                  <TextField
                    label="Lookback Window (minutes)"
                    type="number"
                    value={form.lookbackMinutes}
                    onChange={(e) => onChangeForm((prev) => ({ ...prev, lookbackMinutes: e.target.value }))}
                    fullWidth
                    size="small"
                  />
                )}
              </Stack>

              <FormControlLabel
                control={
                  <Switch
                    checked={form.enabled}
                    onChange={(e) => onChangeForm((prev) => ({ ...prev, enabled: e.target.checked }))}
                  />
                }
                label="Enable live rule evaluation"
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={onCloseForm} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={saving}>
              {saving ? 'Saving...' : form.mode === 'create' ? 'Create Rule' : 'Save Changes'}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      {/* Delete Rule Confirmation Dialog */}
      <Dialog open={Boolean(deleteTarget)} onClose={onCloseDelete} maxWidth="xs" fullWidth>
        <DialogTitle>Delete Alert Rule</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2">
            Are you sure you want to delete alert rule <strong>{deleteTarget?.name}</strong>?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={onCloseDelete} disabled={saving}>
            Cancel
          </Button>
          <Button color="error" variant="contained" onClick={onConfirmDelete} disabled={saving}>
            {saving ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Inspect Evaluation Dialog */}
      <Dialog open={Boolean(selectedRule)} onClose={onCloseInspect} maxWidth="sm" fullWidth>
        <DialogTitle>{selectedRule?.name}</DialogTitle>
        <DialogContent dividers>
          {selectedRule && (
            <Stack spacing={1.5}>
              <Typography variant="body2">
                <strong>Group:</strong> {selectedRule.group}
              </Typography>
              <Typography variant="body2">
                <strong>Datasource:</strong> {selectedRule.resolvedDatasource} ({selectedRule.datasourceType})
              </Typography>
              <Typography variant="body2">
                <strong>Measured Value:</strong> {selectedRule.measuredValue} (Threshold: {selectedRule.thresholdLabel})
              </Typography>
              <Typography variant="body2">
                <strong>Detail:</strong> {selectedRule.detail}
              </Typography>
              <JsonViewer value={selectedRule.query} title="Query Expression" maxHeight={140} />
              <JsonViewer value={selectedRule} title="Rule & Evaluation Snapshot" maxHeight={280} />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onCloseInspect}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
