'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { apiRequest } from '@/lib/client/api';

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleLogout(): Promise<void> {
    setPending(true);
    try {
      await apiRequest<{ loggedOut: boolean }>('/api/auth/logout', { method: 'POST' });
    } catch {
      // The cookies are cleared server-side even if the call reports an error;
      // fall through to the login screen.
    } finally {
      router.replace('/login');
      router.refresh();
    }
  }

  return (
    <Button variant="secondary" size="sm" onClick={handleLogout} disabled={pending}>
      {pending ? 'Signing out...' : 'Sign out'}
    </Button>
  );
}
