import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSync } from 'esbuild';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const outFile = path.resolve('dist-test-unit-formatter.mjs');
buildSync({
  entryPoints: [path.resolve('src/utils/unitFormatter.ts')],
  outfile: outFile,
  bundle: true,
  format: 'esm',
  platform: 'neutral',
});

const fmt = await import(pathToFileURL(outFile).href);
fs.unlinkSync(outFile);

test('formatBytesIEC uses Base-2 1024 with IEC labels', () => {
  assert.equal(fmt.formatBytesIEC(0), '0 B');
  assert.equal(fmt.formatBytesIEC(1024), '1.0 KiB');
  assert.equal(fmt.formatBytesIEC(1024 ** 2), '1.0 MiB');
  assert.equal(fmt.formatBytesIEC(16 * 1024 ** 3), '16.0 GiB');
  assert.equal(fmt.formatBytesIEC(2 * 1024 ** 4), '2.0 TiB');
});

test('formatBytesSI uses Base-10 1000 with SI labels', () => {
  assert.equal(fmt.formatBytesSI(1000), '1.0 KB');
  assert.equal(fmt.formatBytesSI(1_500_000), '1.5 MB');
  assert.equal(fmt.formatBytesSI(1_000_000_000), '1.0 GB');
});

test('formatThroughput and formatNetworkBits distinguish bytes/s vs bits/s', () => {
  assert.equal(fmt.formatThroughput(1024 ** 2), '1.0 MiB/s');
  assert.equal(fmt.formatNetworkBits(125_000), '1.0 Mbps');
  assert.equal(fmt.formatNetworkBits(125_000_000), '1.0 Gbps');
});

test('formatPower and formatEnergy distinguish W vs Wh', () => {
  assert.equal(fmt.formatPower(350), '350.0 W');
  assert.equal(fmt.formatPower(2500), '2.5 kW');
  assert.equal(fmt.formatEnergy(1500), '1.50 kWh');
});

test('formatDuration scales ns, us, ms, s cleanly with µs symbol', () => {
  assert.equal(fmt.formatDuration(450, 'ns'), '450 ns');
  assert.equal(fmt.formatDuration(450, 'us'), '450 µs');
  assert.equal(fmt.formatDuration(1500, 'us'), '1.50 ms');
  assert.equal(fmt.formatDuration(125, 's'), '2m 5s');
  assert.equal(fmt.formatDuration(90061, 's'), '1d 1h');
});

test('formatCores, formatPercent, and formatTemperatureC', () => {
  assert.equal(fmt.formatCores(0.25), '250m');
  assert.equal(fmt.formatCores(4), '4 cores');
  assert.equal(fmt.formatPercent(0.85, true), '85.0%');
  assert.equal(fmt.formatPercent(112, false), '100.0%');
  assert.equal(fmt.formatPercent(-3, false), '0.0%');
  assert.equal(fmt.formatTemperatureC(45000, true), '45.0 °C');
});
