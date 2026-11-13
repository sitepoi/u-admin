'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { SelectInput, TextAreaInput } from '@/components/ui/form';
import { CredentialGate } from '@/components/secrets/credential-gate';
import { apiRequest } from '@/lib/client/api';
import type { DeliveryMode, PlatformRole } from '@/lib/shared/constants';

interface DeliverResponse {
  delivery: {
    secretId: string;
    mode: DeliveryMode | null;
    deliveryStatus: string;
    deliveredAt: string | null;
    target: string | null;
    message: string | null;
  };
}

export function DeliverSecretForm({
  secretId,
  sessionEmail,
  defaultMode,
  e2eRole,
}: {
  secretId: string;
  sessionEmail: string;
  defaultMode: DeliveryMode;
  e2eRole: PlatformRole;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<DeliveryMode>(defaultMode);
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<DeliverResponse['delivery'] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleToken(idToken: string): Promise<void> {
    if (reason.trim().length < 10) {
      throw new Error('Enter a reason of at least 10 characters.');
    }

    const response = await apiRequest<DeliverResponse>(
      `/api/platform/secrets/${encodeURIComponent(secretId)}/deliver`,
      {
        method: 'POST',
        body: { mode, reason: reason.trim(), idToken },
      },
    );

    setResult(response.delivery);
    setReason('');
    router.refresh();
  }

  if (!expanded) {
    return (
      <div className="space-y-2">
        <Button variant="secondary" size="sm" onClick={() => setExpanded(true)}>
          Deliver secret
        </Button>
        {result ? (
          <Alert tone="success">
            Delivery reported: {result.deliveryStatus}
            {result.target ? ` to ${result.target}` : ''}.
          </Alert>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}
      {result ? (
        <Alert tone="success" title="Delivery result">
          <ul className="space-y-0.5 text-xs">
            <li>Status: {result.deliveryStatus}</li>
            <li>Mode: {result.mode ?? mode}</li>
            <li>Target: {result.target ?? '-'}</li>
            {result.message ? <li>Message: {result.message}</li> : null}
          </ul>
        </Alert>
      ) : null}

      <SelectInput
        label="Delivery mode"
        value={mode}
        onChange={(event) => setMode(event.target.value as DeliveryMode)}
        options={[
          { value: 'manual', label: 'Manual' },
          { value: 'runtime-fetch', label: 'Runtime fetch' },
          { value: 'vercel-env', label: 'Vercel environment variable' },
        ]}
        hint="The Secret API performs the delivery and owns its status."
      />
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
      <CredentialGate
        emailHint={sessionEmail}
        submitLabel="Authenticate and deliver"
        onToken={handleToken}
        e2eRole={e2eRole}
      />
      <Button variant="ghost" size="sm" onClick={() => setExpanded(false)}>
        Collapse
      </Button>
    </div>
  );
}
