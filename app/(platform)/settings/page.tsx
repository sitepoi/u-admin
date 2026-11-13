import { Alert } from '@/components/ui/alert';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader, DescriptionList } from '@/components/ui/card';
import { SettingsForm } from '@/components/settings/settings-form';
import { formatDateTime } from '@/lib/client/format';
import { PLATFORM_ROLES } from '@/lib/shared/constants';
import { ROLE_MATRIX_ROWS, roleCan } from '@/lib/server/auth/roles';
import { requireServerSession } from '@/lib/server/auth/server-session';
import { getPlatformStore } from '@/lib/server/firestore/store-provider';
import {
  getEnvironmentStatus,
  getPlatformRuntimeInfo,
  getPlatformSettings,
} from '@/lib/server/settings/settings-service';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const session = await requireServerSession();
  const canManageSettings = roleCan(session.role, 'settings:manage');

  const [settings, settingsRecords, environmentStatus, runtimeInfo] = await Promise.all([
    getPlatformSettings(),
    getPlatformStore().listSettings(),
    Promise.resolve(getEnvironmentStatus()),
    Promise.resolve(getPlatformRuntimeInfo()),
  ]);

  const lastUpdatedAt =
    settingsRecords
      .map((record) => record.updatedAt)
      .filter((updatedAt) => Boolean(updatedAt))
      .sort()
      .at(-1) ?? null;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">Platform settings</h1>
        <p className="mt-1 text-sm text-slate-600">
          Operational settings and configuration status. Secret values are never displayed.
        </p>
      </header>

      {runtimeInfo.e2eMode ? (
        <Alert tone="danger" title="E2E mode is active">
          PLATFORM_E2E_MODE is enabled. Authentication and persistence are simulated. This is only
          possible outside production and never on Vercel.
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Runtime" description="Effective platform configuration." />
          <CardBody>
            <DescriptionList
              items={[
                { label: 'Platform host', value: runtimeInfo.platformHost, mono: true },
                { label: 'Session TTL', value: `${runtimeInfo.sessionTtlHours} hour(s)` },
                {
                  label: 'Reveal fresh-auth window',
                  value: `${runtimeInfo.revealFreshAuthSeconds} seconds`,
                },
                {
                  label: 'IP allowlist',
                  value: runtimeInfo.ipAllowlistEnabled ? (
                    <Badge tone="indigo">enabled</Badge>
                  ) : (
                    <Badge>disabled</Badge>
                  ),
                },
                {
                  label: 'Development hosts',
                  value:
                    runtimeInfo.devHostsConfigured > 0
                      ? `${runtimeInfo.devHostsConfigured} configured`
                      : 'none',
                },
                {
                  label: 'Persistence',
                  value:
                    runtimeInfo.inMemoryStore ? 'in-memory (E2E only)' : 'Firestore (server-only)',
                },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Platform settings"
            description={
              canManageSettings
                ? 'Owner-managed operational settings.'
                : 'Read-only. Only an owner can change platform settings.'
            }
          />
          <CardBody>
            {canManageSettings ? (
              <SettingsForm initialSettings={settings} />
            ) : (
              <DescriptionList
                items={[
                  {
                    label: 'Scheduled reporting refresh',
                    value: settings.reportingAutoRefreshEnabled ? 'enabled' : 'disabled',
                  },
                  { label: 'Default delivery mode', value: settings.defaultDeliveryMode },
                  { label: 'Maintenance notice', value: settings.maintenanceNotice || '' },
                ]}
              />
            )}
            {lastUpdatedAt ? (
              <p className="mt-4 text-xs text-slate-500">
                Last updated {formatDateTime(lastUpdatedAt)}.
              </p>
            ) : null}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Environment status"
          description="Presence only. Values are never rendered, logged or sent to the browser."
        />
        <CardBody className="px-0 py-0">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Variable</th>
                  <th scope="col">Scope</th>
                  <th scope="col">Status</th>
                  <th scope="col">Note</th>
                </tr>
              </thead>
              <tbody>
                {environmentStatus.map((item) => (
                  <tr key={item.name}>
                    <td className="font-mono text-xs">{item.name}</td>
                    <td className="text-xs text-slate-500">{item.scope}</td>
                    <td>
                      <StatusBadge
                        status={item.configured ? 'active' : 'failed'}
                        label={item.configured ? 'configured' : 'missing'}
                      />
                    </td>
                    <td className="text-xs text-slate-600">{item.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Role matrix"
          description="Enforced server-side in lib/server/auth/roles.ts. The UI only hides controls."
        />
        <CardBody className="px-0 py-0">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Action</th>
                  {PLATFORM_ROLES.map((role) => (
                    <th key={role} scope="col" className="text-center">
                      {role}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROLE_MATRIX_ROWS.map((row) => (
                  <tr key={row.permission}>
                    <td className="text-sm">{row.label}</td>
                    {PLATFORM_ROLES.map((role) => (
                      <td key={role} className="text-center">
                        {roleCan(role, row.permission) ? (
                          <span className="text-emerald-600" aria-label="allowed">
                            yes
                          </span>
                        ) : (
                          <span className="text-slate-300" aria-label="denied">
                            no
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
