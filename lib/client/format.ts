export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(date);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  return new Intl.NumberFormat('en-GB').format(value);
}

export function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  if (value === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  const scaled = value / Math.pow(1024, exponent);
  return `${scaled.toFixed(scaled >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function formatRelative(value: string | null | undefined): string {
  if (!value) return 'never';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'never';
  const deltaSeconds = Math.round((Date.now() - timestamp) / 1000);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (Math.abs(deltaSeconds) < 60) return formatter.format(-deltaSeconds, 'second');
  if (Math.abs(deltaSeconds) < 3600) return formatter.format(-Math.round(deltaSeconds / 60), 'minute');
  if (Math.abs(deltaSeconds) < 86400) return formatter.format(-Math.round(deltaSeconds / 3600), 'hour');
  return formatter.format(-Math.round(deltaSeconds / 86400), 'day');
}

export function truncateMiddle(value: string, maximumLength = 28): string {
  if (value.length <= maximumLength) return value;
  const half = Math.floor((maximumLength - 1) / 2);
  return `${value.slice(0, half)}…${value.slice(-half)}`;
}
