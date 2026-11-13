'use client';

import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { TextInput } from '@/components/ui/form';
import { Alert } from '@/components/ui/alert';
import { apiRequest, ApiClientError } from '@/lib/client/api';
import { isClientE2eMode } from '@/lib/firebase/client';
import {
  completeSmsMfaSignIn,
  completeTotpSignIn,
  describeAuthError,
  sendSmsMfaCode,
  signOutFirebaseClient,
  startEmailPasswordSignIn,
  type MfaChallenge,
} from '@/lib/firebase/mfa';
import { PLATFORM_ROLES, type PlatformRole } from '@/lib/shared/constants';

type LoginStep = 'credentials' | 'mfa' | 'sms';

/**
 * The API rejects a valid password sign-in when the token has no second
 * factor. That is an enrolment problem, not a credential problem, so it needs
 * a message that tells the operator what to do next.
 */
function describeSignInFailure(error: unknown): string {
  if (error instanceof ApiClientError && error.code === 'MFA_REQUIRED') {
    return 'This account signed in without a second factor. Open the MFA enrolment page, enrol an authenticator app, then sign in again.';
  }
  return describeAuthError(error);
}

export function LoginForm({ nextPath }: { nextPath: string }) {
  const e2eMode = isClientE2eMode();
  const firebaseConfigured = Boolean(
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY && process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  );

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [step, setStep] = useState<LoginStep>('credentials');
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null);
  const [smsVerificationId, setSmsVerificationId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function establishSession(idToken: string): Promise<void> {
    await apiRequest<{ role: string }>('/api/auth/session', {
      method: 'POST',
      body: { idToken },
    });
    await signOutFirebaseClient();
    window.location.assign(nextPath);
  }

  async function handleCredentialSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrorMessage(null);
    setStatusMessage('Verifying credentials...');
    setPending(true);

    try {
      const outcome = await startEmailPasswordSignIn(email.trim(), password);
      if (outcome.status === 'success') {
        setStatusMessage('Establishing platform session...');
        await establishSession(outcome.idToken);
        return;
      }

      const mfaChallenge = outcome.challenge;
      setChallenge(mfaChallenge);
      const hasTotp = mfaChallenge.hints.some((hint) => hint.factorId === 'totp');
      const hasPhone = mfaChallenge.hints.some((hint) => hint.factorId === 'phone');

      if (hasTotp) {
        setStep('mfa');
        setStatusMessage('Enter the 6-digit code from your authenticator app.');
      } else if (hasPhone) {
        setStep('sms');
        setStatusMessage('Send an SMS code to continue.');
      } else {
        setErrorMessage(
          'This account uses an unsupported second factor. Ask an owner to enrol an authenticator app.',
        );
        setStatusMessage(null);
      }
    } catch (error) {
      setErrorMessage(describeSignInFailure(error));
      setStatusMessage(null);
    } finally {
      setPending(false);
    }
  }

  async function handleTotpSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!challenge) return;
    setErrorMessage(null);
    setStatusMessage('Verifying second factor...');
    setPending(true);

    try {
      const result = await completeTotpSignIn(challenge, verificationCode);
      setStatusMessage('Establishing platform session...');
      await establishSession(result.idToken);
    } catch (error) {
      setErrorMessage(describeSignInFailure(error));
      setStatusMessage(null);
    } finally {
      setPending(false);
    }
  }

  async function handleSendSmsCode(): Promise<void> {
    if (!challenge) return;
    setErrorMessage(null);
    setStatusMessage('Sending SMS code...');
    setPending(true);

    try {
      const verificationId = await sendSmsMfaCode(challenge, 'recaptcha-container');
      setSmsVerificationId(verificationId);
      setStatusMessage('Enter the 6-digit code sent to your phone.');
    } catch (error) {
      setErrorMessage(describeSignInFailure(error));
      setStatusMessage(null);
    } finally {
      setPending(false);
    }
  }

  async function handleSmsSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!challenge || !smsVerificationId) return;
    setErrorMessage(null);
    setStatusMessage('Verifying second factor...');
    setPending(true);

    try {
      const result = await completeSmsMfaSignIn(challenge, smsVerificationId, verificationCode);
      setStatusMessage('Establishing platform session...');
      await establishSession(result.idToken);
    } catch (error) {
      setErrorMessage(describeSignInFailure(error));
      setStatusMessage(null);
    } finally {
      setPending(false);
    }
  }

  async function handleE2eSignIn(role: PlatformRole): Promise<void> {
    setErrorMessage(null);
    setPending(true);
    setStatusMessage('Establishing local test session...');
    try {
      await apiRequest<{ role: string }>('/api/auth/session', {
        method: 'POST',
        body: { e2eActor: role },
      });
      window.location.assign(nextPath);
    } catch (error) {
      setErrorMessage(
        error instanceof ApiClientError ? error.message : 'The local test session could not be created.',
      );
      setStatusMessage(null);
    } finally {
      setPending(false);
    }
  }

  function resetFlow(): void {
    setStep('credentials');
    setChallenge(null);
    setSmsVerificationId(null);
    setVerificationCode('');
    setPassword('');
    setErrorMessage(null);
    setStatusMessage(null);
  }

  return (
    <div className="space-y-6">
      <div aria-live="polite" className="sr-only">
        {statusMessage ?? ''}
      </div>

      {!e2eMode && !firebaseConfigured ? (
        <Alert tone="warning" title="Firebase is not configured">
          Add the <code className="font-mono text-xs">NEXT_PUBLIC_FIREBASE_*</code> and{' '}
          <code className="font-mono text-xs">PLATFORM_FIREBASE_*</code> values to{' '}
          <code className="font-mono text-xs">.env.local</code>, or run{' '}
          <code className="font-mono text-xs">npm run dev:demo</code> for a local demo without
          Firebase.
        </Alert>
      ) : null}

      {errorMessage ? (
        <Alert tone="danger" title="Sign-in problem">
          {errorMessage}
        </Alert>
      ) : null}

      {step === 'credentials' ? (
        <form className="space-y-4" onSubmit={handleCredentialSubmit} noValidate={false}>
          <TextInput
            label="Email"
            type="email"
            name="email"
            autoComplete="username"
            inputMode="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@uniconhub.com"
          />
          <TextInput
            label="Password"
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? 'Signing in...' : 'Sign in'}
          </Button>
        </form>
      ) : null}

      {step === 'mfa' ? (
        <form className="space-y-4" onSubmit={handleTotpSubmit}>
          <TextInput
            label="Authenticator code"
            name="verificationCode"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={verificationCode}
            onChange={(event) => setVerificationCode(event.target.value)}
            hint="A second factor is mandatory for every platform session."
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? 'Verifying...' : 'Verify and continue'}
            </Button>
            <Button type="button" variant="ghost" onClick={resetFlow} disabled={pending}>
              Start over
            </Button>
          </div>
        </form>
      ) : null}

      {step === 'sms' ? (
        <div className="space-y-4">
          <div id="recaptcha-container" />
          {smsVerificationId ? (
            <form className="space-y-4" onSubmit={handleSmsSubmit}>
              <TextInput
                label="SMS code"
                name="smsCode"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                value={verificationCode}
                onChange={(event) => setVerificationCode(event.target.value)}
                hint="A second factor is mandatory for every platform session."
              />
              <div className="flex gap-2">
                <Button type="submit" disabled={pending}>
                  {pending ? 'Verifying...' : 'Verify and continue'}
                </Button>
                <Button type="button" variant="ghost" onClick={resetFlow} disabled={pending}>
                  Start over
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex gap-2">
              <Button type="button" onClick={handleSendSmsCode} disabled={pending}>
                {pending ? 'Sending...' : 'Send SMS code'}
              </Button>
              <Button type="button" variant="ghost" onClick={resetFlow} disabled={pending}>
                Start over
              </Button>
            </div>
          )}
        </div>
      ) : null}

      <p className="text-xs text-slate-500">
        Access is limited to allowlisted platform staff. There is no public sign-up.{' '}
        <a href="/mfa-enroll" className="text-indigo-700 hover:underline">
          First-time MFA enrolment
        </a>
      </p>

      {e2eMode ? (
        <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-4">
          <p className="text-xs font-semibold tracking-wide text-amber-800 uppercase">
            Local E2E mode
          </p>
          <p className="mt-1 text-xs text-amber-700">
            Development only. The server refuses this helper in production.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {PLATFORM_ROLES.map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => handleE2eSignIn(role)}
                disabled={pending}
                className="rounded-md bg-amber-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-amber-500 disabled:opacity-60"
              >
                Sign in as {role}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
