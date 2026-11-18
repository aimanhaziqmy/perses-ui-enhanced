import { describe, expect, it } from 'vitest';
import { escapeCsvCell } from '../exportRecords';

describe('exportRecords CSV formula injection protection', () => {
  it('neutralizes leading =, +, -, @, tab, and CR characters', () => {
    expect(escapeCsvCell('=CMD|"/C calc"!A0')).toBe('"\'=CMD|""/C calc""!A0"');
    expect(escapeCsvCell('+1+1')).toBe("'+1+1");
    expect(escapeCsvCell('-2+3')).toBe("'-2+3");
    expect(escapeCsvCell('@SUM(1,2)')).toBe('"\'@SUM(1,2)"');
    expect(escapeCsvCell('\t123')).toBe("'\t123");
    expect(escapeCsvCell('\r123')).toBe('"\'\r123"');
  });

  it('preserves normal strings, numbers, and standard CSV quoting', () => {
    expect(escapeCsvCell('normal log line')).toBe('normal log line');
    expect(escapeCsvCell('hello, "world"')).toBe('"hello, ""world"""');
    expect(escapeCsvCell(42)).toBe('42');
    expect(escapeCsvCell(null)).toBe('');
  });
});
