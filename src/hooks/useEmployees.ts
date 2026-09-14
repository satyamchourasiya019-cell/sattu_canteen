import { useEffect, useState } from 'react';
import { subscribeEmployees } from '../services/employeeService';
import type { Employee } from '../types';

/** Realtime employee master list (admin). */
export function useEmployeeList(): { employees: Employee[]; loading: boolean; error: string | null } {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let gotFirst = false;
    const unsub = subscribeEmployees(
      (list) => {
        gotFirst = true;
        setEmployees(list);
        setLoading(false);
        setError(null);
      },
      (msg) => {
        gotFirst = true;
        setError(msg);
        setLoading(false);
      },
    );
    return () => {
      unsub();
      if (!gotFirst) setLoading(false);
    };
  }, []);

  return { employees, loading, error };
}
