/** Platform settings shape shared by the settings form and the server service. */
import type { DeliveryMode } from '@/lib/shared/constants';

export const PLATFORM_SETTING_IDS = [
  'reportingAutoRefreshEnabled',
  'defaultDeliveryMode',
  'maintenanceNotice',
] as const;

export type PlatformSettingId = (typeof PLATFORM_SETTING_IDS)[number];

export interface PlatformSettings {
  reportingAutoRefreshEnabled: boolean;
  defaultDeliveryMode: DeliveryMode;
  maintenanceNotice: string;
}

export const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = {
  reportingAutoRefreshEnabled: false,
  defaultDeliveryMode: 'manual',
  maintenanceNotice: '',
};
