import 'server-only';

import { getCmsConfig } from '@/lib/server/env';
import { logWarn } from '@/lib/server/logging/logger';
import { redactText } from '@/lib/server/logging/redact';

export interface CmsCallResult {
  ok: boolean;
  status: number;
  errorMessage: string | null;
}

/**
 * Minimal CMS system API client.
 *
 * The Admin app does not reimplement CMS tenant creation: it calls the existing
 * system endpoints and records the outcome.
 *
 * The API key is part of the URL path, so the URL must never be logged. Log
 * lines use a sanitised pathname with the key replaced.
 */
function buildSanitizedPath(pathname: string, apiKey: string): string {
  return pathname.split(apiKey).join('[cms-api-key]');
}

async function callCmsSystemApi(pathname: string): Promise<CmsCallResult> {
  const config = getCmsConfig();
  const url = `${config.baseUrl}${pathname}`;
  const sanitizedPath = buildSanitizedPath(pathname, config.apiKey);

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
      signal: controller.signal,
      cache: 'no-store',
    });

    if (response.ok) {
      return { ok: true, status: response.status, errorMessage: null };
    }

    let errorMessage: string | null = null;
    try {
      const responseText = await response.text();
      if (responseText) {
        errorMessage = redactText(responseText.slice(0, 300));
      }
    } catch {
      errorMessage = null;
    }

    logWarn('cms.request_failed', {
      path: sanitizedPath,
      status: response.status,
    });

    return { ok: false, status: response.status, errorMessage };
  } catch (error) {
    logWarn('cms.request_error', {
      path: sanitizedPath,
      error: error instanceof Error ? error.message : 'unknown error',
    });
    return {
      ok: false,
      status: 0,
      errorMessage: 'The CMS system API could not be reached.',
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export async function createCmsTenant(
  tenantId: string,
  cmsProjectId: string,
): Promise<CmsCallResult> {
  const config = getCmsConfig();
  return callCmsSystemApi(
    `/api/system/${encodeURIComponent(config.apiKey)}/ctgc/${encodeURIComponent(
      tenantId,
    )}/${encodeURIComponent(cmsProjectId)}`,
  );
}

export async function retryCmsFirstPartyEnrollment(
  tenantId: string,
  cmsProjectId: string,
): Promise<CmsCallResult> {
  const config = getCmsConfig();
  return callCmsSystemApi(
    `/api/system/${encodeURIComponent(config.apiKey)}/rfti/${encodeURIComponent(
      tenantId,
    )}/${encodeURIComponent(cmsProjectId)}`,
  );
}
