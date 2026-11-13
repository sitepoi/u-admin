import 'server-only';

import { getPlatformFirestore } from '@/lib/server/firebase/admin';
import { isE2eMode } from '@/lib/server/env';
import { FirestorePlatformStore } from '@/lib/server/firestore/firestore-store';
import { InMemoryPlatformStore } from '@/lib/server/firestore/in-memory-store';
import type { PlatformStore } from '@/lib/server/firestore/store';

let cachedStore: PlatformStore | null = null;

/**
 * In development Next.js can execute route handlers and pages in separate
 * module graphs, so module-scoped state is duplicated. The E2E store is pinned
 * to globalThis to keep a single instance per server process.
 */
function getOrCreateInMemoryStore(): InMemoryPlatformStore {
  const globalObject = globalThis as typeof globalThis & {
    __platformAdminInMemoryStore?: InMemoryPlatformStore;
  };
  if (!globalObject.__platformAdminInMemoryStore) {
    globalObject.__platformAdminInMemoryStore = new InMemoryPlatformStore();
  }
  return globalObject.__platformAdminInMemoryStore;
}

export function getPlatformStore(): PlatformStore {
  if (cachedStore) return cachedStore;
  cachedStore = isE2eMode()
    ? getOrCreateInMemoryStore()
    : new FirestorePlatformStore(getPlatformFirestore());
  return cachedStore;
}

/** Test-only seam used by Vitest and the E2E bootstrap. */
export function setPlatformStoreForTesting(store: PlatformStore | null): void {
  cachedStore = store;
}

export function isUsingInMemoryStore(): boolean {
  return getPlatformStore().kind === 'memory';
}
