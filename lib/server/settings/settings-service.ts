import 'server-only';

import type { DeliveryMode } from '@/lib/shared/constants';
import { DELIVERY_MODES } from '@/lib/shared/constants';
import {
  DEFAULT_PLATFORM_SETTINGS,
  PLATFORM_SETTING_IDS,
  type PlatformSettingId,
  type PlatformSettings,
} from '@/lib/shared/settings';
import { getPlatformConfig, isE2eMode } from '@/lib/server/env';
import { getPlatformStore } from '@/lib/server/firestore/store-provider';
import type { PlatformSettingRecord } from '@/lib/shared/platform-types';

export type { PlatformSettingId, PlatformSettings };
export {
  DEFAULT_PLATFORM_SETTINGS,
  PLATFORM_SETTING_IDS,
} from '@/lib/shared/settings';

function coerceSettingValue(settingId: PlatformSettingId, rawValue: unknown): unknown {
  if (settingId === 'reportingAutoRefreshEnabled') {
    return typeof rawValue === 'boolean' ? rawValue : DEFAULT_PLATFORM_SETTINGS.reportingAutoRefreshEnabled;
  }
  if (settingId === 'defaultDeliveryMode') {
    return typeof rawValue === 'string' && (DELIVERY_MODES as readonly string[]).includes(rawValue)
      ? (rawValue as DeliveryMode)
      : DEFAULT_PLATFORM_SETTINGS.defaultDeliveryMode;
  }
  return typeof rawValue === 'string' ? rawValue.slice(0, 500) : DEFAULT_PLATFORM_SETTINGS.maintenanceNotice;
}

export async function getPlatformSettings(): Promise<PlatformSettings> {
  const storedSettings = await getPlatformStore().listSettings();
  const settings: PlatformSettings = { ...DEFAULT_PLATFORM_SETTINGS };

  for (const settingId of PLATFORM_SETTING_IDS) {
    const storedSetting = storedSettings.find((entry) => entry.settingId === settingId);
    if (!storedSetting) continue;
    (settings as unknown as Record<string, unknown>)[settingId] = coerceSettingValue(
      settingId,
      storedSetting.value,
    );
  }

  return settings;
}

export async function updatePlatformSettings(
  values: Partial<PlatformSettings>,
  actorUid: string,
): Promise<PlatformSettings> {
  const store = getPlatformStore();
  const timestamp = new Date().toISOString();

  for (const settingId of PLATFORM_SETTING_IDS) {
    if (!(settingId in values)) continue;
    const record: PlatformSettingRecord = {
      settingId,
      value: coerceSettingValue(settingId, values[settingId]),
      updatedAt: timestamp,
      updatedBy: actorUid,
    };
    await store.putSetting(record);
  }

  return getPlatformSettings();
}

export interface EnvironmentStatusItem {
  name: string;
  scope: 'platform' | 'public' | 'server';
  configured: boolean;
  note: string;
}

function isConfigured(variableName: string): boolean {
  return (process.env[variableName] ?? '').trim().length > 0;
}

/**
 * Reports which variables are present. Values are never returned: an operator
 * needs to know that a secret exists, not what it is.
 */
export function getEnvironmentStatus(): EnvironmentStatusItem[] {
  const config = (() => {
    try {
      return getPlatformConfig();
    } catch {
      return null;
    }
  })();

  return [
    {
      name: 'PLATFORM_HOST',
      scope: 'platform',
      configured: isConfigured('PLATFORM_HOST'),
      note: isConfigured('PLATFORM_HOST') ? 'Platform host is set.' : 'Required. Only this host is served.',
    },
    {
      name: 'PLATFORM_ADMIN_EMAILS',
      scope: 'platform',
      configured: Boolean(config?.adminEmails.length),
      note: config ? `${config.adminEmails.length} allowlisted email address(es).` : 'Missing or invalid.',
    },
    {
      name: 'PLATFORM_IP_ALLOWLIST',
      scope: 'platform',
      configured: Boolean(config?.ipAllowlist.length),
      note: config?.ipAllowlist.length ? 'IP allowlist enforced.' : 'No IP allowlist (rely on the access proxy).',
    },
    {
      name: 'PLATFORM_FIREBASE_PROJECT_ID',
      scope: 'server',
      configured: isConfigured('PLATFORM_FIREBASE_PROJECT_ID'),
      note: 'Admin Firebase project (separate from tenants and the Secret API vault).',
    },
    {
      name: 'PLATFORM_FIREBASE_CLIENT_EMAIL',
      scope: 'server',
      configured: isConfigured('PLATFORM_FIREBASE_CLIENT_EMAIL'),
      note: 'Service account email.',
    },
    {
      name: 'PLATFORM_FIREBASE_PRIVATE_KEY',
      scope: 'server',
      configured: isConfigured('PLATFORM_FIREBASE_PRIVATE_KEY'),
      note: 'Service account private key (escaped newlines supported).',
    },
    {
      name: 'SECRET_API_BASE_URL',
      scope: 'server',
      configured: isConfigured('SECRET_API_BASE_URL'),
      note: 'Server-to-server Secret API endpoint.',
    },
    {
      name: 'SECRET_API_ADMIN_SERVICE_TOKEN',
      scope: 'server',
      configured: isConfigured('SECRET_API_ADMIN_SERVICE_TOKEN'),
      note: 'Bearer token used by the Admin server only.',
    },
    {
      name: 'CMS_SYSTEM_API_BASE_URL',
      scope: 'server',
      configured: isConfigured('CMS_SYSTEM_API_BASE_URL'),
      note: 'CMS system API used for tenant provisioning.',
    },
    {
      name: 'CMS_SYSTEM_API_KEY',
      scope: 'server',
      configured: isConfigured('CMS_SYSTEM_API_KEY'),
      note: 'Included in the CMS system API path; never logged.',
    },
    {
      name: 'PLATFORM_REPORTING_SERVICE_ACCOUNT_JSON',
      scope: 'server',
      configured: isConfigured('PLATFORM_REPORTING_SERVICE_ACCOUNT_JSON'),
      note: 'Dedicated read-only cross-tenant reporting account.',
    },
    {
      name: 'PLATFORM_REPORTING_CRON_SECRET',
      scope: 'server',
      configured: isConfigured('PLATFORM_REPORTING_CRON_SECRET'),
      note: 'Optional: allows Vercel Cron to trigger a refresh.',
    },
  ];
}

export interface PlatformRuntimeInfo {
  platformHost: string;
  sessionTtlHours: number;
  revealFreshAuthSeconds: number;
  ipAllowlistEnabled: boolean;
  devHostsConfigured: number;
  e2eMode: boolean;
  inMemoryStore: boolean;
}

export function getPlatformRuntimeInfo(): PlatformRuntimeInfo {
  const config = getPlatformConfig();
  return {
    platformHost: config.platformHost,
    sessionTtlHours: Math.round(config.sessionTtlSeconds / 3600),
    revealFreshAuthSeconds: config.revealFreshAuthSeconds,
    ipAllowlistEnabled: config.ipAllowlist.length > 0,
    devHostsConfigured: config.allowedDevHosts.length,
    e2eMode: isE2eMode(),
    inMemoryStore: getPlatformStore().kind === 'memory',
  };
}
