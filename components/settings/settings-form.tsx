'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { SelectInput, TextAreaInput } from '@/components/ui/form';
import { apiRequest, ApiClientError } from '@/lib/client/api';
import type { DeliveryMode } from '@/lib/shared/constants';
import type { PlatformSettings } from '@/lib/shared/settings';

export function SettingsForm({ initialSettings }: { initialSettings: PlatformSettings }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [reportingAutoRefreshEnabled, setReportingAutoRefreshEnabled] = useState(
    initialSettings.reportingAutoRefreshEnabled,
  );
  const [defaultDeliveryMode, setDefaultDeliveryMode] = useState<DeliveryMode>(
    initialSettings.defaultDeliveryMode,
  );
  const [maintenanceNotice, setMaintenanceNotice] = useState(initialSettings.maintenanceNotice);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await apiRequest('/api/platform/settings', {
        method: 'PATCH',
        body: {
          reportingAutoRefreshEnabled,
          defaultDeliveryMode,
          maintenanceNotice: maintenanceNotice.trim(),
        },
      });
      setSuccessMessage('Platform settings saved.');
      router.refresh();
    } catch (error) {
      setErrorMessage(
        error instanceof ApiClientError ? error.message : 'The settings could not be saved.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit} autoComplete="off">
      {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}
      {successMessage ? <Alert tone="success">{successMessage}</Alert> : null}

      <div className="flex items-start gap-3">
        <input
          id="reporting-auto-refresh"
          type="checkbox"
          className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600"
          checked={reportingAutoRefreshEnabled}
          onChange={(event) => setReportingAutoRefreshEnabled(event.target.checked)}
        />
        <div>
          <label htmlFor="reporting-auto-refresh" className="text-sm font-medium text-slate-800">
            Allow scheduled reporting refresh
          </label>
          <p className="text-xs text-slate-500">
            Informational switch for the Vercel Cron job. Manual refresh always remains available
            to owners and admins.
          </p>
        </div>
      </div>

      <SelectInput
        label="Default delivery mode for new tenants"
        value={defaultDeliveryMode}
        onChange={(event) => setDefaultDeliveryMode(event.target.value as DeliveryMode)}
        options={[
          { value: 'manual', label: 'Manual' },
          { value: 'runtime-fetch', label: 'Runtime fetch' },
          { value: 'vercel-env', label: 'Vercel environment variable' },
        ]}
      />

      <TextAreaInput
        label="Maintenance notice"
        rows={3}
        value={maintenanceNotice}
        onChange={(event) => setMaintenanceNotice(event.target.value)}
        hint="Shown on the dashboard. Leave empty to hide. Maximum 500 characters."
        maxLength={500}
        autoComplete="off"
      />

      <Button type="submit" disabled={pending}>
        {pending ? 'Saving...' : 'Save settings'}
      </Button>
    </form>
  );
}
