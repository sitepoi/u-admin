import 'server-only';

import { sanitizeForLog } from '@/lib/server/logging/redact';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogFields {
  [key: string]: unknown;
}

export interface LogRecord extends LogFields {
  level: LogLevel;
  time: string;
  service: 'platform-admin';
  event: string;
}

function writeLog(level: LogLevel, event: string, fields: LogFields): void {
  const record: LogRecord = {
    level,
    time: new Date().toISOString(),
    service: 'platform-admin',
    event,
    ...(sanitizeForLog(fields) as LogFields),
  };

  let serialized: string;
  try {
    serialized = JSON.stringify(record);
  } catch {
    serialized = JSON.stringify({
      level,
      time: record.time,
      service: record.service,
      event,
      serializationError: true,
    });
  }

  if (level === 'error') {
    console.error(serialized);
  } else if (level === 'warn') {
    console.warn(serialized);
  } else {
    console.info(serialized);
  }
}

export function logInfo(event: string, fields: LogFields = {}): void {
  writeLog('info', event, fields);
}

export function logWarn(event: string, fields: LogFields = {}): void {
  writeLog('warn', event, fields);
}

export function logError(event: string, fields: LogFields = {}): void {
  writeLog('error', event, fields);
}
