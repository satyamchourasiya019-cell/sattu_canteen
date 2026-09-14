import { useEffect, useState } from 'react';
import { watchAdminAuth } from '../services/authService';
import type { AdminUser } from '../types';

export function useAdminAuth(): { admin: AdminUser | null; loading: boolean } {
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = watchAdminAuth((user, stillLoading) => {
      setAdmin(user);
      setLoading(stillLoading === true);
    });
    return unsub;
  }, []);

  return { admin, loading };
}
