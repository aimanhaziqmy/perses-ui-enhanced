import { Box, Button, Chip, Stack, Tooltip, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import Check from 'mdi-material-ui/Check';
import ContentCopy from 'mdi-material-ui/ContentCopy';
import { useMemo, useState } from 'react';

import { PALETTE_TOKENS } from '../theme/persesTheme';

type TokenKind = 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punct' | 'plain';

interface JsonToken {
  kind: TokenKind;
  text: string;
}

const SYNTAX_COLORS: Record<'light' | 'dark', Record<TokenKind, string>> = {
  light: {
    key: '#4338CA',
    string: '#047857',
    number: '#B45309',
    boolean: '#BE185D',
    null: '#64748B',
    punct: '#334155',
    plain: '#0F172A',
  },
  dark: {
    key: '#7DD3FC',
    string: '#86EFAC',
    number: '#FCD34D',
    boolean: '#F472B6',
    null: '#94A3B8',
    punct: '#94A3B8',
    plain: '#E2E8F0',
  },
};

function parseFormattedContent(value: unknown): {
  formatted: string;
  formatLabel: 'JSON' | 'NDJSON' | 'TEXT';
  isJson: boolean;
} {
  if (value === null || value === undefined) {
    return { formatted: 'null', formatLabel: 'JSON', isJson: true };
  }

  if (typeof value !== 'string') {
    try {
      return { formatted: JSON.stringify(value, null, 2), formatLabel: 'JSON', isJson: true };
    } catch {
      return { formatted: String(value), formatLabel: 'TEXT', isJson: false };
    }
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { formatted: '', formatLabel: 'TEXT', isJson: false };
  }

  try {
    const parsed = JSON.parse(trimmed);
    return { formatted: JSON.stringify(parsed, null, 2), formatLabel: 'JSON', isJson: true };
  } catch {
    // Support newline-delimited JSON (VictoriaLogs stream responses)
    const lines = trimmed
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length > 1) {
      const parsedLines: unknown[] = [];
      let allJson = true;
      for (const line of lines) {
        try {
          parsedLines.push(JSON.parse(line));
        } catch {
          allJson = false;
          break;
        }
      }
      if (allJson && parsedLines.length > 0) {
        return {
          formatted: JSON.stringify(parsedLines, null, 2),
          formatLabel: 'NDJSON',
          isJson: true,
        };
      }
    }
    return { formatted: value, formatLabel: 'TEXT', isJson: false };
  }
}

const JSON_TOKEN_RE =
  /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(?:\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?|[{}\[\],:])/g;

function tokenizeJson(formatted: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let lastIndex = 0;

  JSON_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = JSON_TOKEN_RE.exec(formatted)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ kind: 'plain', text: formatted.slice(lastIndex, match.index) });
    }
    const raw = match[0];
    let kind: TokenKind = 'punct';
    if (raw.startsWith('"')) {
      if (raw.endsWith(':')) {
        // Keep trailing colon uncolored as punctuation if desired, or split key vs colon
        const colonIdx = raw.lastIndexOf(':');
        tokens.push({ kind: 'key', text: raw.slice(0, colonIdx) });
        tokens.push({ kind: 'punct', text: raw.slice(colonIdx) });
        lastIndex = JSON_TOKEN_RE.lastIndex;
        continue;
      }
      kind = 'string';
    } else if (raw === 'true' || raw === 'false') {
      kind = 'boolean';
    } else if (raw === 'null') {
      kind = 'null';
    } else if (/^-?\d/.test(raw)) {
      kind = 'number';
    } else {
      kind = 'punct';
    }
    tokens.push({ kind, text: raw });
    lastIndex = JSON_TOKEN_RE.lastIndex;
  }

  if (lastIndex < formatted.length) {
    tokens.push({ kind: 'plain', text: formatted.slice(lastIndex) });
  }
  return tokens;
}

export interface JsonViewerProps {
  value: unknown;
  title?: string;
  maxHeight?: number | string;
  defaultWrap?: boolean;
}

/**
 * Theme-aware syntax-highlighted JSON/NDJSON viewer with Light/Dark contrast palettes,
 * line-wrap toggle, and one-click copy.
 */
export function JsonViewer({
  value,
  title,
  maxHeight = 380,
  defaultWrap = true,
}: JsonViewerProps) {
  const muiTheme = useTheme();
  const mode = muiTheme.palette.mode;
  const tokens = PALETTE_TOKENS[mode];
  const colors = SYNTAX_COLORS[mode];

  const [wrapLines, setWrapLines] = useState<boolean>(defaultWrap);
  const [copied, setCopied] = useState<boolean>(false);

  const { formatted, formatLabel, isJson } = useMemo(() => parseFormattedContent(value), [value]);
  const highlighted = useMemo(
    () => (isJson ? tokenizeJson(formatted) : [{ kind: 'plain' as const, text: formatted }]),
    [formatted, isJson],
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formatted);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard write may fail on non-HTTPS origins; no-op safely
    }
  };

  const containerBg = mode === 'light' ? '#F8FAFC' : '#0B1220';
  const headerBg = mode === 'light' ? '#F1F5F9' : '#111827';
  const containerBorder = mode === 'light' ? '#CBD5E1' : 'rgba(148, 163, 184, 0.24)';

  return (
    <Box
      sx={{
        borderRadius: 1.5,
        border: `1px solid ${containerBorder}`,
        bgcolor: containerBg,
        overflow: 'hidden',
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={1}
        sx={{
          px: 1.5,
          py: 0.75,
          bgcolor: headerBg,
          borderBottom: `1px solid ${containerBorder}`,
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <Chip
            size="small"
            label={formatLabel}
            color={isJson ? 'primary' : 'default'}
            variant="outlined"
            sx={{ height: 20, fontSize: 10.5, fontFamily: 'monospace', fontWeight: 700 }}
          />
          {title && (
            <Typography variant="caption" fontWeight={600} color="text.secondary">
              {title}
            </Typography>
          )}
        </Stack>
        <Stack direction="row" spacing={0.5} alignItems="center">
          <Tooltip title="Toggle soft word wrapping">
            <Button
              size="small"
              variant="text"
              onClick={() => setWrapLines((w) => !w)}
              sx={{
                minWidth: 0,
                px: 1,
                py: 0.25,
                fontSize: 11,
                color: wrapLines ? tokens.primary : tokens.textSecondary,
                bgcolor: wrapLines ? tokens.bgActiveNav : 'transparent',
              }}
            >
              {wrapLines ? 'Wrap: On' : 'Wrap: Off'}
            </Button>
          </Tooltip>
          <Button
            size="small"
            variant="text"
            startIcon={copied ? <Check fontSize="small" /> : <ContentCopy fontSize="small" />}
            onClick={() => void handleCopy()}
            sx={{ minWidth: 0, px: 1, py: 0.25, fontSize: 11 }}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </Stack>
      </Stack>

      <Box
        component="pre"
        sx={{
          m: 0,
          p: 1.5,
          maxHeight,
          overflow: 'auto',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          fontSize: 12.25,
          lineHeight: 1.55,
          whiteSpace: wrapLines ? 'pre-wrap' : 'pre',
          wordBreak: wrapLines ? 'break-word' : 'normal',
          color: colors.plain,
        }}
      >
        {highlighted.map((tok, idx) => (
          <Box
            key={idx}
            component="span"
            sx={{
              color: colors[tok.kind],
              fontWeight: tok.kind === 'key' ? 600 : 400,
            }}
          >
            {tok.text}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
