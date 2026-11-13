'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { TextAreaInput } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { apiRequest, ApiClientError } from '@/lib/client/api';
import type { TenantStatus } from '@/lib/shared/constants';

interface TenantActionsProps {
  tenantId: string;
  status: TenantStatus;
  canProvision: boolean;
  canArchive: boolean;
}

export function TenantActions({
  tenantId,
  status,
  canProvision,
  canArchive,
}: TenantActionsProps) {
  const router = useRouter();
  const [provisionDialogOpen, setProvisionDialogOpen] = useState(false);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<'provision' | 'archive' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [archiveReason, setArchiveReason] = useState('');

  async function handleProvision(): Promise<void> {
    setPendingAction('provision');
    setErrorMessage(null);
    setNoticeMessage(null);
    try {
      const result = await apiRequest<{
        outcome: 'succeeded' | 'failed';
        lastError: string | null;
      }>(`/api/platform/tenants/${encodeURIComponent(tenantId)}/provision`, {
        method: 'POST',
      });

      if (result.outcome === 'succeeded') {
        setNoticeMessage('Provisioning completed. Tenant is active.');
        setProvisionDialogOpen(false);
      } else {
        setErrorMessage(result.lastError ?? 'Provisioning failed. The attempt was recorded.');
      }
      router.refresh();
    } catch (error) {
      setErrorMessage(
        error instanceof ApiClientError ? error.message : 'Provisioning could not be started.',
      );
    } finally {
      setPendingAction(null);
    }
  }

  async function handleArchive(): Promise<void> {
    if (archiveReason.trim().length < 10) {
      setErrorMessage('Provide a reason of at least 10 characters for the audit record.');
      return;
    }

    setPendingAction('archive');
    setErrorMessage(null);
    setNoticeMessage(null);
    try {
      await apiRequest(`/api/platform/tenants/${encodeURIComponent(tenantId)}`, {
        method: 'PATCH',
        body: { status: 'archived', reason: archiveReason.trim() },
      });
      setArchiveDialogOpen(false);
      setArchiveReason('');
      setNoticeMessage('Tenant archived. Records are never hard-deleted.');
      router.refresh();
    } catch (error) {
      setErrorMessage(
        error instanceof ApiClientError ? error.message : 'The tenant could not be archived.',
      );
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {canProvision && status !== 'archived' ? (
          <Button onClick={() => setProvisionDialogOpen(true)} disabled={pendingAction !== null}>
            {status === 'failed' ? 'Retry provisioning' : 'Provision tenant'}
          </Button>
        ) : null}
        {canArchive && status !== 'archived' ? (
          <Button
            variant="danger"
            onClick={() => setArchiveDialogOpen(true)}
            disabled={pendingAction !== null}
          >
            Archive tenant
          </Button>
        ) : null}
      </div>

      <div aria-live="polite" className="space-y-2">
        {noticeMessage ? <Alert tone="success">{noticeMessage}</Alert> : null}
        {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}
      </div>

      <Modal
        open={provisionDialogOpen}
        onClose={() => {
          if (pendingAction === null) setProvisionDialogOpen(false);
        }}
        title="Provision tenant"
        description="Calls the CMS system API. The tenant record already exists, so CMS auto-enrollment can resolve the tenantId with the Secret API."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setProvisionDialogOpen(false)}
              disabled={pendingAction === 'provision'}
            >
              Cancel
            </Button>
            <Button onClick={handleProvision} disabled={pendingAction === 'provision'}>
              {pendingAction === 'provision' ? 'Provisioning...' : 'Start provisioning'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          Provisioning is idempotent. A second operator cannot run it concurrently, and a failed
          attempt can be retried. The result is written to the audit log.
        </p>
      </Modal>

      <Modal
        open={archiveDialogOpen}
        onClose={() => {
          if (pendingAction === null) setArchiveDialogOpen(false);
        }}
        title="Archive tenant"
        description="Archiving is a status change. The tenant record is retained for audit and can be inspected later."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setArchiveDialogOpen(false)}
              disabled={pendingAction === 'archive'}
            >
              Cancel
            </Button>
            <Button variant="danger" onClick={handleArchive} disabled={pendingAction === 'archive'}>
              {pendingAction === 'archive' ? 'Archiving...' : 'Archive tenant'}
            </Button>
          </>
        }
      >
        <TextAreaInput
          label="Reason"
          required
          rows={3}
          value={archiveReason}
          onChange={(event) => setArchiveReason(event.target.value)}
          hint="Minimum 10 characters. Stored in the audit log."
          autoComplete="off"
        />
      </Modal>
    </div>
  );
}
