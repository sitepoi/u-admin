'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { TextAreaInput, TextInput } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { CredentialGate } from '@/components/secrets/credential-gate';
import { apiRequest } from '@/lib/client/api';
import type { PlatformRole } from '@/lib/shared/constants';

export function RetireSecretDialog({
  secretId,
  sessionEmail,
  e2eRole,
}: {
  secretId: string;
  sessionEmail: string;
  e2eRole: PlatformRole;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  function closeDialog(): void {
    setOpen(false);
    setReason('');
    setConfirmation('');
    setErrorMessage(null);
  }

  async function handleToken(idToken: string): Promise<void> {
    if (confirmation.trim().toLowerCase() !== 'retire') {
      throw new Error('Type "retire" to confirm.');
    }
    if (reason.trim().length < 10) {
      throw new Error('Enter a reason of at least 10 characters.');
    }

    await apiRequest(`/api/platform/secrets/${encodeURIComponent(secretId)}/retire`, {
      method: 'POST',
      body: { reason: reason.trim(), idToken },
    });

    setSuccessMessage('Retirement submitted to the Secret API.');
    setOpen(false);
    setReason('');
    setConfirmation('');
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <Button variant="danger" size="sm" onClick={() => setOpen(true)}>
        Retire secret
      </Button>
      {successMessage ? <Alert tone="success">{successMessage}</Alert> : null}

      <Modal
        open={open}
        onClose={closeDialog}
        title="Retire secret"
        description="Owner-only. The Secret API marks the secret retired after verifying owner and MFA."
        footer={
          <Button variant="secondary" onClick={closeDialog}>
            Cancel
          </Button>
        }
      >
        <div className="space-y-3">
          <Alert tone="danger" title="Irreversible for the tenant">
            A retired key can no longer be used by the CMS. Confirm that the tenant has been moved
            to a replacement key before continuing.
          </Alert>
          {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}
          <TextAreaInput
            label="Reason"
            required
            rows={2}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setErrorMessage(null);
            }}
            hint="Minimum 10 characters. Written to the audit log."
            autoComplete="off"
          />
          <TextInput
            label="Type retire to confirm"
            required
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <CredentialGate
            emailHint={sessionEmail}
            submitLabel="Authenticate and retire"
            onToken={handleToken}
            e2eRole={e2eRole}
          />
        </div>
      </Modal>
    </div>
  );
}
