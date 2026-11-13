'use client';

import { FirebaseError } from 'firebase/app';
import {
  getMultiFactorResolver,
  PhoneAuthProvider,
  PhoneMultiFactorGenerator,
  RecaptchaVerifier,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
  TotpMultiFactorGenerator,
  type ActionCodeSettings,
  type MultiFactorInfo,
  type MultiFactorResolver,
  type User,
  type UserCredential,
} from 'firebase/auth';

import { getFirebaseAuthClient } from '@/lib/firebase/client';

export interface MfaHintSummary {
  uid: string;
  factorId: string;
  displayName: string | null;
  phoneNumber: string | null;
}

export interface MfaChallenge {
  resolver: MultiFactorResolver;
  rawHints: MultiFactorInfo[];
  hints: MfaHintSummary[];
  preferredFactorId: string;
}

export type SignInOutcome =
  | { status: 'success'; idToken: string; userCredential: UserCredential }
  | { status: 'mfa-required'; challenge: MfaChallenge };

function isMultiFactorRequired(error: unknown): error is FirebaseError {
  return error instanceof FirebaseError && error.code === 'auth/multi-factor-auth-required';
}

function summarizeHints(resolver: MultiFactorResolver): MfaHintSummary[] {
  return resolver.hints.map((hint) => ({
    uid: hint.uid,
    factorId: hint.factorId,
    displayName: hint.displayName ?? null,
    phoneNumber:
      'phoneNumber' in hint && typeof hint.phoneNumber === 'string' ? hint.phoneNumber : null,
  }));
}

/**
 * Email/password sign-in with Firebase MFA handling.
 * A successful password sign-in on an MFA-enrolled account throws
 * `auth/multi-factor-auth-required`, which is converted into a challenge.
 */
export async function startEmailPasswordSignIn(
  email: string,
  password: string,
): Promise<SignInOutcome> {
  const auth = getFirebaseAuthClient();

  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const idToken = await userCredential.user.getIdToken(true);
    return { status: 'success', idToken, userCredential };
  } catch (error) {
    if (!isMultiFactorRequired(error)) throw error;

    const resolver = getMultiFactorResolver(
      auth,
      error as Parameters<typeof getMultiFactorResolver>[1],
    );
    const hints = summarizeHints(resolver);
    return {
      status: 'mfa-required',
      challenge: {
        resolver,
        rawHints: resolver.hints,
        hints,
        preferredFactorId: hints[0]?.factorId ?? '',
      },
    };
  }
}

export async function completeTotpSignIn(
  challenge: MfaChallenge,
  verificationCode: string,
): Promise<{ idToken: string }> {
  const totpHint = challenge.rawHints.find((hint) => hint.factorId === 'totp');
  if (!totpHint) {
    throw new Error('This account has no authenticator-app factor.');
  }

  const assertion = TotpMultiFactorGenerator.assertionForSignIn(
    totpHint.uid,
    verificationCode.trim(),
  );
  const userCredential = await challenge.resolver.resolveSignIn(assertion);
  const idToken = await userCredential.user.getIdToken(true);
  return { idToken };
}

/**
 * Starts an SMS challenge. The verification id is kept in component state -
 * never in storage.
 */
export async function sendSmsMfaCode(
  challenge: MfaChallenge,
  recaptchaContainerId: string,
): Promise<string> {
  const phoneHint = challenge.rawHints.find((hint) => hint.factorId === 'phone');
  if (!phoneHint) {
    throw new Error('This account has no SMS factor.');
  }

  const auth = getFirebaseAuthClient();
  const recaptchaVerifier = new RecaptchaVerifier(auth, recaptchaContainerId, {
    size: 'invisible',
  });
  const phoneAuthProvider = new PhoneAuthProvider(auth);

  return phoneAuthProvider.verifyPhoneNumber(
    { multiFactorHint: phoneHint, session: challenge.resolver.session },
    recaptchaVerifier,
  );
}

export async function completeSmsMfaSignIn(
  challenge: MfaChallenge,
  verificationId: string,
  verificationCode: string,
): Promise<{ idToken: string }> {
  const phoneCredential = PhoneAuthProvider.credential(verificationId, verificationCode.trim());
  const assertion = PhoneMultiFactorGenerator.assertion(phoneCredential);
  const userCredential = await challenge.resolver.resolveSignIn(assertion);
  const idToken = await userCredential.user.getIdToken(true);
  return { idToken };
}

export async function signOutFirebaseClient(): Promise<void> {
  try {
    await signOut(getFirebaseAuthClient());
  } catch {
    // Nothing to clear.
  }
}

/**
 * Sends the Firebase account-verification email.
 *
 * MFA enrolment is refused for unverified addresses. The continue URL brings
 * the operator back to the enrolment page, but Firebase only accepts it when
 * the host is an authorized domain, so a rejection falls back to the default
 * handler instead of failing the action.
 */
export async function sendAccountVerificationEmail(
  user: User,
  continueUrl: string,
): Promise<void> {
  const actionCodeSettings: ActionCodeSettings = {
    url: continueUrl,
    handleCodeInApp: false,
  };

  try {
    await sendEmailVerification(user, actionCodeSettings);
  } catch (error) {
    if (
      error instanceof FirebaseError &&
      (error.code === 'auth/unauthorized-continue-uri' ||
        error.code === 'auth/invalid-continue-uri')
    ) {
      await sendEmailVerification(user);
      return;
    }
    throw error;
  }
}

/** True when Firebase refused MFA enrolment because the email is unverified. */
export function isUnverifiedEmailError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'auth/unverified-email'
  );
}

/** Maps Firebase auth errors to safe, user-facing text. */
export function describeAuthError(error: unknown): string {
  if (error instanceof FirebaseError) {
    // Some SDK versions use a long code here, for example
    // auth/api-key-not-valid.-please-pass-a-valid-api-key.
    if (error.code.startsWith('auth/api-key-not-valid')) {
      return 'The Firebase Web API key is invalid. Check NEXT_PUBLIC_FIREBASE_API_KEY and redeploy.';
    }

    switch (error.code) {
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
        return 'Email or password is incorrect.';
      case 'auth/invalid-email':
        return 'Enter a valid email address.';
      case 'auth/too-many-requests':
        return 'Too many attempts. Wait a few minutes before trying again.';
      case 'auth/user-disabled':
        return 'This account has been disabled.';
      case 'auth/unverified-email':
        return 'This account email is not verified. Verify it in Firebase Authentication before signing in.';
      case 'auth/network-request-failed':
        return 'The authentication service could not be reached.';
      case 'auth/invalid-api-key':
        return 'The Firebase Web API key is invalid. Check NEXT_PUBLIC_FIREBASE_API_KEY and redeploy.';
      case 'auth/unauthorized-domain':
        return 'This domain is not authorized in Firebase. Add it under Authentication -> Settings -> Authorized domains.';
      case 'auth/unauthorized-continue-uri':
      case 'auth/invalid-continue-uri':
        return 'Firebase rejected the email return URL. Add this domain under Authentication -> Settings -> Authorized domains.';
      case 'auth/operation-not-allowed':
        return 'This authentication method is not enabled for the Firebase project (auth/operation-not-allowed). Check Authentication -> Sign-in method.';
      case 'auth/configuration-not-found':
        return 'Firebase Authentication is not configured for this project.';
      case 'auth/code-expired':
        return 'The verification code expired. Start again.';
      case 'auth/invalid-verification-code':
        return 'The verification code is incorrect.';
      case 'auth/multi-factor-auth-required':
        return 'Multi-factor authentication is required.';
      default:
        // The code is safe to show and makes configuration problems diagnosable.
        return `Sign-in failed (${error.code}). Please try again.`;
    }
  }

  if (error instanceof Error && error.message) {
    return error.message.slice(0, 300);
  }
  return 'Sign-in failed. Please try again.';
}

/**
 * Enrolment-specific text. The password step has already succeeded here, so
 * `auth/operation-not-allowed` means the project refuses TOTP enrolment, not
 * that email/password sign-in is disabled.
 */
export function describeEnrollmentError(error: unknown): string {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case 'auth/operation-not-allowed':
        return 'The Firebase project does not allow authenticator-app enrolment (auth/operation-not-allowed). Enable Identity Platform multi-factor authentication, with the Authenticator app factor, for this project.';
      case 'auth/unverified-email':
        return 'MFA requires a verified email. Use "Send verification email" on this page, open the link, then continue.';
      case 'auth/too-many-requests':
        return 'Firebase rate-limited this request. Wait a minute, then try again.';
      case 'auth/unsupported-first-factor':
        return 'This project does not allow multi-factor authentication for email/password accounts.';
      case 'auth/unsupported-second-factor':
        return 'This project does not support authenticator-app second factors.';
      case 'auth/missing-multi-factor-session':
      case 'auth/invalid-multi-factor-session':
        return 'The enrolment session expired. Enter your password again to restart.';
      case 'auth/second-factor-already-in-use':
        return 'This account already has that second factor. Use the normal sign-in page.';
      case 'auth/maximum-second-factor-count-exceeded':
        return 'This account reached the maximum number of second factors.';
      case 'auth/invalid-verification-code':
        return 'The verification code is incorrect.';
      case 'auth/code-expired':
        return 'The verification code expired. Restart enrolment.';
      default:
        return describeAuthError(error);
    }
  }
  return describeAuthError(error);
}
