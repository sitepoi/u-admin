'use client';

import { useState, type FormEvent } from 'react';
import { signOut, multiFactor, signInWithEmailAndPassword, TotpMultiFactorGenerator } from 'firebase/auth';
import type { TotpSecret, User, UserCredential } from 'firebase/auth';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { TextInput } from '@/components/ui/form';
import { getFirebaseAuthClient } from '@/lib/firebase/client';
import {
  describeAuthError,
  describeEnrollmentError,
  isUnverifiedEmailError,
  sendAccountVerificationEmail,
} from '@/lib/firebase/mfa';

type EnrollmentStep = 'credentials' | 'verify-email' | 'enroll' | 'done';

/**
 * First-time TOTP enrollment. This page never creates a platform session: it
 * only proves the password and registers an authenticator factor, after which
 * the operator returns to /login and completes MFA normally.
 *
 * In production the page is behind the corporate access proxy; do not expose it
 * to the public internet.
 */
export function MfaEnrollForm() {
  const [step, setStep] = useState<EnrollmentStep>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [sharedSecret, setSharedSecret] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [enrolledUser, setEnrolledUser] = useState<User | null>(null);
  const [totpSecret, setTotpSecret] = useState<TotpSecret | null>(null);
  const [emailVerificationSent, setEmailVerificationSent] = useState(false);

  async function startTotpEnrolment(user: User): Promise<void> {
    try {
      // Force a fresh token so a just-completed email verification is visible
      // to the enrolment endpoint.
      await user.getIdToken(true);

      const multiFactorSession = await multiFactor(user).getSession();
      const generatedSecret =
        await TotpMultiFactorGenerator.generateSecret(multiFactorSession);

      setEnrolledUser(user);
      setTotpSecret(generatedSecret);
      setSharedSecret(generatedSecret.secretKey);
      setStep('enroll');
    } catch (error) {
      if (isUnverifiedEmailError(error)) {
        // Firebase refuses to register a factor for an unverified address.
        // Show the verification step instead of a dead-end error.
        setEnrolledUser(user);
        setErrorMessage(null);
        setStep('verify-email');
        return;
      }
      setErrorMessage(describeEnrollmentError(error));
    }
  }

  function resetFlow(): void {
    setStep('credentials');
    setPassword('');
    setVerificationCode('');
    setSharedSecret(null);
    setTotpSecret(null);
    setEnrolledUser(null);
    setEmailVerificationSent(false);
    setErrorMessage(null);
  }

  async function handleCredentialSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setErrorMessage(null);
    setPending(true);

    const auth = getFirebaseAuthClient();
    let credential: UserCredential;

    // Password failures and enrolment failures need different explanations:
    // auth/operation-not-allowed means "provider disabled" in the first step
    // but "TOTP MFA not enabled" in the second.
    try {
      credential = await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as { code?: string }).code === 'auth/multi-factor-auth-required'
      ) {
        setErrorMessage(
          'This account already has a second factor. Use the normal sign-in page.',
        );
      } else {
        setErrorMessage(describeAuthError(error));
      }
      setPending(false);
      return;
    }

    try {
      if (multiFactor(credential.user).enrolledFactors.length > 0) {
        await signOut(auth);
        setErrorMessage(
          'This account already has a second factor. Use the normal sign-in page.',
        );
        return;
      }

      // Refresh so a verification completed in another tab is picked up.
      try {
        await credential.user.reload();
      } catch {
        // Non-fatal: the enrolment call reports the real problem.
      }

      if (!credential.user.emailVerified) {
        setEnrolledUser(credential.user);
        setStep('verify-email');
        return;
      }

      await startTotpEnrolment(credential.user);
    } catch (error) {
      setErrorMessage(describeEnrollmentError(error));
    } finally {
      setPending(false);
    }
  }

  async function handleSendVerificationEmail(): Promise<void> {
    if (!enrolledUser) return;

    setErrorMessage(null);
    setPending(true);
    try {
      await sendAccountVerificationEmail(
        enrolledUser,
        `${window.location.origin}/mfa-enroll`,
      );
      setEmailVerificationSent(true);
    } catch (error) {
      setErrorMessage(describeEnrollmentError(error));
    } finally {
      setPending(false);
    }
  }

  async function handleVerificationContinue(): Promise<void> {
    if (!enrolledUser) return;

    setErrorMessage(null);
    setPending(true);
    try {
      await enrolledUser.reload();
      if (!enrolledUser.emailVerified) {
        setErrorMessage(
          'This email is still unverified. Open the link in the verification email, then try again.',
        );
        return;
      }
      await startTotpEnrolment(enrolledUser);
    } catch (error) {
      setErrorMessage(describeEnrollmentError(error));
    } finally {
      setPending(false);
    }
  }

  async function handleEnrollSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!enrolledUser || !totpSecret) return;

    setErrorMessage(null);
    setPending(true);

    try {
      const assertion = TotpMultiFactorGenerator.assertionForEnrollment(
        totpSecret,
        verificationCode.trim(),
      );
      await multiFactor(enrolledUser).enroll(assertion, 'Authenticator app');
      await signOut(getFirebaseAuthClient());
      setPassword('');
      setVerificationCode('');
      setSharedSecret(null);
      setTotpSecret(null);
      setEnrolledUser(null);
      setStep('done');
    } catch (error) {
      if (isUnverifiedEmailError(error)) {
        setStep('verify-email');
        setErrorMessage(null);
      } else {
        setErrorMessage(describeEnrollmentError(error));
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <Alert tone="warning" title="Trusted network only">
        Enrolment must be performed on the corporate network or behind the access proxy, and the
        person's identity should be verified out of band. Anyone with the password could otherwise
        register their own authenticator.
      </Alert>

      <div aria-live="polite">{errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}</div>

      {step === 'credentials' ? (
        <form className="space-y-4" onSubmit={handleCredentialSubmit}>
          <TextInput
            label="Email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <TextInput
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? 'Preparing enrolment...' : 'Continue'}
          </Button>
        </form>
      ) : null}

      {step === 'verify-email' ? (
        <div className="space-y-4">
          <Alert tone="warning" title="Verify your email first">
            Firebase does not allow a second factor on an unverified address. Send the
            verification email
            {enrolledUser?.email ? (
              <>
                {' '}to <strong>{enrolledUser.email}</strong>
              </>
            ) : null}
            , open the link, then come back to this page.
          </Alert>

          {emailVerificationSent ? (
            <Alert tone="success" title="Verification email sent">
              Check the inbox and spam folder for {enrolledUser?.email ?? 'your address'}. If this
              page is still open when you return, press &quot;I have verified, continue&quot;.
            </Alert>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={handleSendVerificationEmail} disabled={pending}>
              {pending
                ? 'Sending...'
                : emailVerificationSent
                  ? 'Send the email again'
                  : 'Send verification email'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={handleVerificationContinue}
              disabled={pending}
            >
              I have verified, continue
            </Button>
            <Button type="button" variant="ghost" onClick={resetFlow} disabled={pending}>
              Start over
            </Button>
          </div>
        </div>
      ) : null}

      {step === 'enroll' ? (
        <form className="space-y-4" onSubmit={handleEnrollSubmit}>
          <div>
            <p className="text-sm font-medium text-slate-800">
              1. Add this key to your authenticator app
            </p>
            <pre
              className="secret-output mt-2"
              aria-label="Authenticator shared secret"
              data-testid="totp-shared-secret"
            >
              {sharedSecret ?? ''}
            </pre>
            <p className="mt-1 text-xs text-slate-500">
              Enter the key manually in Google Authenticator, 1Password, Authy or a hardware token.
              It is shown once and never stored by this application.
            </p>
          </div>

          <TextInput
            label="2. Enter the 6-digit code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={verificationCode}
            onChange={(event) => setVerificationCode(event.target.value)}
          />

          <Button type="submit" disabled={pending}>
            {pending ? 'Enrolling...' : 'Enrol authenticator'}
          </Button>
        </form>
      ) : null}

      {step === 'done' ? (
        <div className="space-y-3">
          <Alert tone="success" title="Authenticator enrolled">
            The second factor is active. Sign in again to obtain a platform session.
          </Alert>
          <a
            href="/login"
            className="inline-flex items-center rounded-md bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Go to sign in
          </a>
        </div>
      ) : null}
    </div>
  );
}
