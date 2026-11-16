export type ExportFormat = 'csv' | 'json' | 'jsonl';

const PRIORITY_COLUMNS = [
  '_time',
  'level',
  'severity',
  'type',
  'reason',
  'namespace',
  'involvedObject.kind',
  'involvedObject.name',
  'host',
  'service',
  '_msg',
  '_stream',
  '_stream_id',
];

function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function collectOrderedColumns(records: Record<string, unknown>[]): string[] {
  const keySet = new Set<string>();
  for (const rec of records) {
    if (!rec || typeof rec !== 'object') continue;
    for (const key of Object.keys(rec)) {
      keySet.add(key);
    }
  }
  const ordered: string[] = [];
  for (const col of PRIORITY_COLUMNS) {
    if (keySet.has(col)) {
      ordered.push(col);
      keySet.delete(col);
    }
  }
  const remaining = Array.from(keySet).sort((a, b) => a.localeCompare(b));
  return [...ordered, ...remaining];
}

export function serializeRecords(
  records: Record<string, unknown>[],
  format: ExportFormat,
): { content: string; mimeType: string; extension: string } {
  if (format === 'json') {
    return {
      content: JSON.stringify(records, null, 2),
      mimeType: 'application/json;charset=utf-8',
      extension: 'json',
    };
  }
  if (format === 'jsonl') {
    return {
      content: records.map((r) => JSON.stringify(r)).join('\n'),
      mimeType: 'application/x-ndjson;charset=utf-8',
      extension: 'jsonl',
    };
  }

  const columns = collectOrderedColumns(records);
  if (columns.length === 0) {
    return { content: '', mimeType: 'text/csv;charset=utf-8', extension: 'csv' };
  }
  const header = columns.map((c) => escapeCsvCell(c)).join(',');
  const rows = records.map((rec) =>
    columns.map((col) => escapeCsvCell(rec?.[col])).join(','),
  );
  return {
    content: [header, ...rows].join('\r\n'),
    mimeType: 'text/csv;charset=utf-8',
    extension: 'csv',
  };
}

export function exportRawJsonlLinesToFile(rawLines: string[], filenamePrefix: string): number {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `${filenamePrefix}-${stamp}.jsonl`;
  const parts: BlobPart[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    parts.push(i === 0 ? rawLines[i] : `\n${rawLines[i]}`);
  }
  const blob = new Blob(parts, { type: 'application/x-ndjson;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
  return rawLines.length;
}

export function exportRecordsToFile(
  records: Record<string, unknown>[],
  format: ExportFormat,
  filenamePrefix: string,
): number {
  const { content, mimeType, extension } = serializeRecords(records, format);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `${filenamePrefix}-${stamp}.${extension}`;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
  return records.length;
}

