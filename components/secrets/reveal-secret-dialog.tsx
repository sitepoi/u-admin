'use client';

import { useEffect, useRef, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { TextAreaInput } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { CredentialGate } from '@/components/secrets/credential-gate';
import { apiRequest } from '@/lib/client/api';
import type { PlatformRole } from '@/lib/shared/constants';

interface RevealResponse {
  secret: {
    secretId: string;
    kid: string | null;
    algorithm: string | null;
    version: number | null;
    privateKeyPem: string;
  };
}

export function RevealSecretDialog({
  secretId,
  sessionEmail,
  e2eRole,
}: {
  secretId: string;
  sessionEmail: string;
  e2eRole: PlatformRole;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [revealedKid, setRevealedKid] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const dialogOpenRef = useRef(false);

  useEffect(() => {
    dialogOpenRef.current = open;
  }, [open]);

  function wipeAndClose(): void {
    dialogOpenRef.current = false;
    setRevealedKey(null);
    setRevealedKid(null);
    setReason('');
    setCopied(false);
    setErrorMessage(null);
    setOpen(false);
  }

  async function handleToken(idToken: string): Promise<void> {
    if (reason.trim().length < 10) {
      throw new Error('Enter a reason of at least 10 characters. It is written to the audit log.');
    }

    const result = await apiRequest<RevealResponse>(
      `/api/platform/secrets/${encodeURIComponent(secretId)}/reveal`,
      {
        method: 'POST',
        body: { reason: reason.trim(), idToken },
      },
    );

    // If the dialog was closed while the request was in flight, discard the
    // response instead of leaving the key in state.
    if (!dialogOpenRef.current) return;

    // Held only in this component's state. Cleared on close.
    setRevealedKey(result.secret.privateKeyPem);
    setRevealedKid(result.secret.kid);
  }

  async function copyToClipboard(): Promise<void> {
    if (!revealedKey) return;
    try {
      await navigator.clipboard.writeText(revealedKey);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setErrorMessage('The browser blocked clipboard access. Select the key and copy manually.');
    }
  }

  return (
    <>
      <Button variant="danger" size="sm" onClick={() => setOpen(true)}>
        Reveal private key
      </Button>

      <Modal
        open={open}
        onClose={wipeAndClose}
        title="Reveal private key"
        description="Owner-only. The key is decrypted by the Secret API and returned once with no-store."
        footer={
          revealedKey ? (
            <>
              <Button variant="secondary" onClick={copyToClipboard}>
                {copied ? 'Copied' : 'Copy to clipboard'}
              </Button>
              <Button onClick={wipeAndClose}>Close and clear</Button>
            </>
          ) : (
            <Button variant="secondary" onClick={wipeAndClose}>
              Cancel
            </Button>
          )
        }
      >
        {revealedKey ? (
          <div className="space-y-3">
            <Alert tone="danger" title="Handle with care">
              This private key grants full control over the tenant's first-party identity. It is
              never stored by this application, never placed in browser storage, and must not be
              pasted into tickets or chat.
            </Alert>
            {revealedKid ? (
              <p className="text-xs text-slate-500">
                Key id: <span className="font-mono">{revealedKid}</span>
              </p>
            ) : null}
            <pre className="secret-output" aria-label="Revealed private key" data-testid="revealed-secret">
              {revealedKey}
            </pre>
            <p className="text-xs text-slate-500">
              Closing this dialog clears the key from React state. There is no way to retrieve it
              again from the Admin app.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <Alert tone="warning" title="This action is audited">
              A reveal requires the owner role, MFA and an authentication within the last few
              minutes. The Secret API verifies the same conditions independently.
            </Alert>
            {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}
            <TextAreaInput
              label="Reason"
              required
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              hint="Minimum 10 characters. Stored in the append-only audit log."
              autoComplete="off"
              spellCheck={false}
            />
            <CredentialGate
              emailHint={sessionEmail}
              submitLabel="Re-authenticate and reveal"
              onToken={handleToken}
              e2eRole={e2eRole}
            />
          </div>
        )}
      </Modal>
    </>
  );
}
