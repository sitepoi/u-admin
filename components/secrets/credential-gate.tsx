'use client';

import { useId, useState, type FormEvent, type ReactNode } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { TextInput } from '@/components/ui/form';
import {
  completeSmsMfaSignIn,
  completeTotpSignIn,
  describeAuthError,
  sendSmsMfaCode,
  signOutFirebaseClient,
  startEmailPasswordSignIn,
  type MfaChallenge,
} from '@/lib/firebase/mfa';
import { isClientE2eMode } from '@/lib/firebase/client';
import { buildE2eActorToken } from '@/lib/firebase/e2e';
import type { PlatformRole } from '@/lib/shared/constants';

interface CredentialGateProps {
  emailHint: string;
  submitLabel: string;
  onToken: (idToken: string) => Promise<void>;
  disabled?: boolean;
  /** Local Playwright only: enables the deterministic identity shortcut. */
  e2eRole?: PlatformRole;
  children?: ReactNode;
}

/**
 * Re-authenticates the operator and hands a fresh Firebase ID token to the
 * caller. Used by reveal / deliver / retire. No token is stored anywhere.
 */
export function CredentialGate({
  emailHint,
  submitLabel,
  onToken,
  disabled = false,
  e2eRole,
  children,
}: CredentialGateProps) {
  const recaptchaElementId = `recaptcha-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  const [email, setEmail] = useState(emailHint);
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<'credentials' | 'totp' | 'sms'>('credentials');
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null);
  const [smsVerificationId, setSmsVerificationId] = useState<string | null>(null);
  const [verificationCode, setVerificationCode] = useState('');
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function deliverToken(idToken: string): Promise<void> {
    await onToken(idToken);
    await signOutFirebaseClient();
    setPassword('');
    setVerificationCode('');
    setChallenge(null);
    setSmsVerificationId(null);
    setStep('credentials');
  }

  async function handleCredentialSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrorMessage(null);
    setPending(true);
    try {
      const outcome = await startEmailPasswordSignIn(email.trim(), password);
      if (outcome.status === 'success') {
        await deliverToken(outcome.idToken);
        return;
      }
      setChallenge(outcome.challenge);
      const hasTotp = outcome.challenge.hints.some((hint) => hint.factorId === 'totp');
      setStep(hasTotp ? 'totp' : 'sms');
    } catch (error) {
      if (error instanceof Error && !('code' in error)) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage(describeAuthError(error));
      }
    } finally {
      setPending(false);
    }
  }

  async function handleTotpSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!challenge) return;
    setErrorMessage(null);
    setPending(true);
    try {
      const result = await completeTotpSignIn(challenge, verificationCode);
      await deliverToken(result.idToken);
    } catch (error) {
      if (error instanceof Error && !('code' in error)) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage(describeAuthError(error));
      }
    } finally {
      setPending(false);
    }
  }

  async function handleSendSms(): Promise<void> {
    if (!challenge) return;
    setErrorMessage(null);
    setPending(true);
    try {
      const verificationId = await sendSmsMfaCode(challenge, recaptchaElementId);
      setSmsVerificationId(verificationId);
    } catch (error) {
      setErrorMessage(describeAuthError(error));
    } finally {
      setPending(false);
    }
  }

  async function handleE2eToken(): Promise<void> {
    if (!e2eRole) return;
    setErrorMessage(null);
    setPending(true);
    try {
      await deliverToken(buildE2eActorToken(e2eRole));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The local test action failed.');
    } finally {
      setPending(false);
    }
  }

  async function handleSmsSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!challenge || !smsVerificationId) return;
    setErrorMessage(null);
    setPending(true);
    try {
      const result = await completeSmsMfaSignIn(challenge, smsVerificationId, verificationCode);
      await deliverToken(result.idToken);
    } catch (error) {
      if (error instanceof Error && !('code' in error)) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage(describeAuthError(error));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <div id={recaptchaElementId} />
      {errorMessage ? (
        <div aria-live="assertive">
          <Alert tone="danger">{errorMessage}</Alert>
        </div>
      ) : null}

      {step === 'credentials' ? (
        <form className="space-y-3" onSubmit={handleCredentialSubmit} autoComplete="off">
          {children}
          {e2eRole && isClientE2eMode() ? (
            <Button
              type="button"
              variant="secondary"
              onClick={handleE2eToken}
              disabled={pending || disabled}
            >
              Continue with local E2E identity
            </Button>
          ) : null}
          <TextInput
            label="Email"
            type="email"
            name="reauth-email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <TextInput
            label="Password"
            type="password"
            name="reauth-password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            hint="Re-authentication is required. A fresh ID token is sent to the Secret API."
          />
          <Button type="submit" disabled={pending || disabled}>
            {pending ? 'Authenticating...' : submitLabel}
          </Button>
        </form>
      ) : null}

      {step === 'totp' ? (
        <form className="space-y-3" onSubmit={handleTotpSubmit} autoComplete="off">
          <TextInput
            label="Authenticator code"
            name="reauth-totp"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={verificationCode}
            onChange={(event) => setVerificationCode(event.target.value)}
          />
          <Button type="submit" disabled={pending || disabled}>
            {pending ? 'Verifying...' : submitLabel}
          </Button>
        </form>
      ) : null}

      {step === 'sms' ? (
        smsVerificationId ? (
          <form className="space-y-3" onSubmit={handleSmsSubmit} autoComplete="off">
            <TextInput
              label="SMS code"
              name="reauth-sms"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={verificationCode}
              onChange={(event) => setVerificationCode(event.target.value)}
            />
            <Button type="submit" disabled={pending || disabled}>
              {pending ? 'Verifying...' : submitLabel}
            </Button>
          </form>
        ) : (
          <Button onClick={handleSendSms} disabled={pending || disabled}>
            {pending ? 'Sending...' : 'Send SMS code'}
          </Button>
        )
      ) : null}
    </div>
  );
}
