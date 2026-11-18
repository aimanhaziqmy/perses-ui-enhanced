import { describe, expect, it } from 'vitest';
import * as fmt from '../unitFormatter';

describe('unitFormatter', () => {
  it('formatBytesIEC uses Base-2 1024 with IEC labels', () => {
    expect(fmt.formatBytesIEC(0)).toBe('0 B');
    expect(fmt.formatBytesIEC(1024)).toBe('1.0 KiB');
    expect(fmt.formatBytesIEC(1024 ** 2)).toBe('1.0 MiB');
    expect(fmt.formatBytesIEC(16 * 1024 ** 3)).toBe('16.0 GiB');
    expect(fmt.formatBytesIEC(2 * 1024 ** 4)).toBe('2.0 TiB');
  });

  it('formatBytesSI uses Base-10 1000 with SI labels', () => {
    expect(fmt.formatBytesSI(1000)).toBe('1.0 KB');
    expect(fmt.formatBytesSI(1_500_000)).toBe('1.5 MB');
    expect(fmt.formatBytesSI(1_000_000_000)).toBe('1.0 GB');
  });

  it('formatThroughput and formatNetworkBits distinguish bytes/s vs bits/s', () => {
    expect(fmt.formatThroughput(1024 ** 2)).toBe('1.0 MiB/s');
    expect(fmt.formatNetworkBits(125_000)).toBe('1.0 Mbps');
    expect(fmt.formatNetworkBits(125_000_000)).toBe('1.0 Gbps');
  });

  it('formatPower and formatEnergy distinguish W vs Wh', () => {
    expect(fmt.formatPower(350)).toBe('350.0 W');
    expect(fmt.formatPower(2500)).toBe('2.5 kW');
    expect(fmt.formatEnergy(1500)).toBe('1.50 kWh');
  });

  it('formatDuration scales ns, us, ms, s cleanly with µs symbol', () => {
    expect(fmt.formatDuration(450, 'ns')).toBe('450 ns');
    expect(fmt.formatDuration(450, 'us')).toBe('450 µs');
    expect(fmt.formatDuration(1500, 'us')).toBe('1.50 ms');
    expect(fmt.formatDuration(125, 's')).toBe('2m 5s');
    expect(fmt.formatDuration(90061, 's')).toBe('1d 1h');
  });

  it('formatCores, formatPercent, and formatTemperatureC', () => {
    expect(fmt.formatCores(0.25)).toBe('250m');
    expect(fmt.formatCores(4)).toBe('4 cores');
    expect(fmt.formatPercent(0.85, true)).toBe('85.0%');
    expect(fmt.formatPercent(112, false)).toBe('100.0%');
    expect(fmt.formatPercent(-3, false)).toBe('0.0%');
    expect(fmt.formatTemperatureC(45000, true)).toBe('45.0 °C');
  });
});
