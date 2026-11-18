/**
 * Centralized telemetry & unit formatting utilities.
 * Enforces strict separation between IEC Base-2 (1024) and SI Base-10 (1000),
 * Bytes vs. Bits (* 8), Power (W) vs. Energy (Wh), Ratios vs. Percentages,
 * and sub-millisecond to multi-day durations.
 */

export type DurationInputUnit = 'ns' | 'us' | 'ms' | 's';

function isValidNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Format binary storage / memory in IEC Base-2 units (`B`, `KiB`, `MiB`, `GiB`, `TiB`, `PiB`).
 */
export function formatBytesIEC(bytes: number | null | undefined, decimals = 1): string {
  if (!isValidNumber(bytes)) return '-';
  if (bytes === 0) return '0 B';
  const sign = bytes < 0 ? '-' : '';
  const abs = Math.abs(bytes);
  if (abs < 1024) return `${sign}${Math.round(abs)} B`;

  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  const exp = Math.min(Math.floor(Math.log(abs) / Math.log(1024)), units.length - 1);
  const scaled = abs / 1024 ** exp;
  return `${sign}${scaled.toFixed(decimals)} ${units[exp]}`;
}

/**
 * Format decimal storage in SI Base-10 units (`B`, `KB`, `MB`, `GB`, `TB`, `PB`).
 */
export function formatBytesSI(bytes: number | null | undefined, decimals = 1): string {
  if (!isValidNumber(bytes)) return '-';
  if (bytes === 0) return '0 B';
  const sign = bytes < 0 ? '-' : '';
  const abs = Math.abs(bytes);
  if (abs < 1000) return `${sign}${Math.round(abs)} B`;

  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const exp = Math.min(Math.floor(Math.log(abs) / Math.log(1000)), units.length - 1);
  const scaled = abs / 1000 ** exp;
  return `${sign}${scaled.toFixed(decimals)} ${units[exp]}`;
}

/**
 * Format disk/stream byte throughput in IEC Base-2 (`B/s`, `KiB/s`, `MiB/s`, `GiB/s`, `TiB/s`).
 */
export function formatThroughput(bytesPerSec: number | null | undefined, decimals = 1): string {
  if (!isValidNumber(bytesPerSec)) return '-';
  return `${formatBytesIEC(bytesPerSec, decimals)}/s`;
}

/**
 * Convert Bytes/sec to Bits/sec (`* 8`) and format in SI Base-10 (`bps`, `Kbps`, `Mbps`, `Gbps`, `Tbps`).
 */
export function formatNetworkBits(bytesPerSec: number | null | undefined, decimals = 1): string {
  if (!isValidNumber(bytesPerSec)) return '-';
  const bitsPerSec = bytesPerSec * 8;
  if (bitsPerSec === 0) return '0 bps';
  const sign = bitsPerSec < 0 ? '-' : '';
  const abs = Math.abs(bitsPerSec);
  if (abs < 1000) return `${sign}${Math.round(abs)} bps`;

  const units = ['bps', 'Kbps', 'Mbps', 'Gbps', 'Tbps'];
  const exp = Math.min(Math.floor(Math.log(abs) / Math.log(1000)), units.length - 1);
  const scaled = abs / 1000 ** exp;
  return `${sign}${scaled.toFixed(decimals)} ${units[exp]}`;
}

/**
 * Format instantaneous power draw (`W`, `kW`, `MW`) using SI Base-10.
 */
export function formatPower(watts: number | null | undefined, decimals = 1): string {
  if (!isValidNumber(watts)) return '-';
  const sign = watts < 0 ? '-' : '';
  const abs = Math.abs(watts);
  if (abs < 1000) return `${sign}${abs.toFixed(decimals)} W`;
  if (abs < 1_000_000) return `${sign}${(abs / 1000).toFixed(decimals)} kW`;
  return `${sign}${(abs / 1_000_000).toFixed(decimals)} MW`;
}

/**
 * Format cumulative energy (`Wh`, `kWh`, `MWh`) using SI Base-10.
 */
export function formatEnergy(wattHours: number | null | undefined, decimals = 2): string {
  if (!isValidNumber(wattHours)) return '-';
  const sign = wattHours < 0 ? '-' : '';
  const abs = Math.abs(wattHours);
  if (abs < 1000) return `${sign}${abs.toFixed(decimals)} Wh`;
  if (abs < 1_000_000) return `${sign}${(abs / 1000).toFixed(decimals)} kWh`;
  return `${sign}${(abs / 1_000_000).toFixed(decimals)} MWh`;
}

/**
 * Format duration from `ns`, `us`, `ms`, or `s` into `ns`, `µs`, `ms`, `s`, `m`, `h`, or `d`.
 */
export function formatDuration(
  value: number | null | undefined,
  inputUnit: DurationInputUnit = 'ms',
): string {
  if (!isValidNumber(value)) return '-';
  const sign = value < 0 ? '-' : '';
  let ns: number;
  switch (inputUnit) {
    case 'ns':
      ns = Math.abs(value);
      break;
    case 'us':
      ns = Math.abs(value) * 1_000;
      break;
    case 'ms':
      ns = Math.abs(value) * 1_000_000;
      break;
    case 's':
      ns = Math.abs(value) * 1_000_000_000;
      break;
  }

  if (ns === 0) return '0 ms';
  if (ns < 1_000) return `${sign}${Math.round(ns)} ns`;
  const us = ns / 1_000;
  if (us < 1_000) return `${sign}${us < 10 ? us.toFixed(1) : Math.round(us)} µs`;
  const ms = us / 1_000;
  if (ms < 1_000) return `${sign}${ms.toFixed(2)} ms`;
  const sec = ms / 1_000;
  if (sec < 60) return `${sign}${sec.toFixed(2)} s`;
  const totalSeconds = Math.floor(sec);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const mins = Math.floor((totalSeconds % 3_600) / 60);
  const remSec = totalSeconds % 60;
  if (days > 0) return `${sign}${days}d ${hours}h`;
  if (hours > 0) return `${sign}${hours}h ${mins}m`;
  return `${sign}${mins}m ${remSec}s`;
}

/**
 * Format CPU compute (`m` millicores for `< 1` core, `cores` for `>= 1` core).
 */
export function formatCores(cores: number | null | undefined): string {
  if (!isValidNumber(cores)) return '-';
  if (cores === 0) return '0 cores';
  if (Math.abs(cores) < 1) return `${Math.round(cores * 1000)}m`;
  return `${Number.isInteger(cores) ? cores : cores.toFixed(2)} cores`;
}

/**
 * Clamp and format percentages (`0.0%`–`100.0%`), converting `0.0–1.0` ratios when `isRatio=true`.
 */
export function formatPercent(
  value: number | null | undefined,
  isRatio = false,
  decimals = 1,
): string {
  if (!isValidNumber(value)) return '-';
  const rawPct = isRatio ? value * 100 : value;
  const clamped = Math.max(0, Math.min(100, rawPct));
  return `${clamped.toFixed(decimals)}%`;
}

/**
 * Format temperature in degrees Celsius (`°C`), scaling millidegrees (`> 1000`) automatically if needed.
 */
export function formatTemperatureC(
  value: number | null | undefined,
  isMillidegrees = false,
  decimals = 1,
): string {
  if (!isValidNumber(value)) return '-';
  const c = isMillidegrees ? value / 1000 : value;
  return `${c.toFixed(decimals)} °C`;
}
