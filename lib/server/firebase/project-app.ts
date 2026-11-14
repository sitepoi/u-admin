import 'server-only';

import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';

import { ApiError } from '@/lib/server/errors';
import { getProjectAccessConfig } from '@/lib/server/env';

interface ServiceAccountShape {
  project_id?: string;
  client_email?: string;
  private_key?: string;
}

/**
 * Initializes (once per project) an Admin SDK app that targets another
 * Firebase project with the cross-project service account. The credentials'
 * own project_id is not a boundary: IAM on the target project decides access.
 */
export function getProjectFirebaseApp(projectId: string): App {
  const appName = `platform-project-${projectId}`;
  const existingApp = getApps().find((candidateApp) => candidateApp.name === appName);
  if (existingApp) return existingApp;

  let serviceAccountJson: string;
  try {
    serviceAccountJson = getProjectAccessConfig().serviceAccountJson;
  } catch {
    throw ApiError.projectAccessFailed(
      'PLATFORM_PROJECTS_SERVICE_ACCOUNT_JSON is not configured. Add the service account JSON and redeploy.',
    );
  }

  let parsedServiceAccount: ServiceAccountShape;
  try {
    parsedServiceAccount = JSON.parse(serviceAccountJson) as ServiceAccountShape;
  } catch {
    throw ApiError.projectAccessFailed('The project access credentials are not valid JSON.');
  }

  if (!parsedServiceAccount.client_email || !parsedServiceAccount.private_key) {
    throw ApiError.projectAccessFailed('The project access credentials are incomplete.');
  }

  return initializeApp(
    {
      credential: cert({
        projectId: parsedServiceAccount.project_id ?? projectId,
        clientEmail: parsedServiceAccount.client_email,
        privateKey: parsedServiceAccount.private_key.replace(/\\n/g, '\n'),
      }),
      projectId,
    },
    appName,
  );
}
