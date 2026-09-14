import { useCallback, useEffect, useState } from 'react';
import * as api from '../services/api';
import type { Employee } from '../types';

/** Employee self-service session on this device (local demo mode). */
export function useEmployeeSession() {
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    api
      .apiEmployeeMe()
      .then((e) => {
        if (alive) {
          setEmployee(e);
          setLoading(false);
        }
      })
      .catch(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const login = useCallback(async (input: { serial: string; employeeNo: string; name: string; department: string }) => {
    const res = await api.apiEmployeeRegister(input);
    setEmployee(res.employee);
    return res.employee;
  }, []);

  const logout = useCallback(async () => {
    await api.apiEmployeeLogout();
    api.storeEmployeeSerial(null);
    setEmployee(null);
  }, []);

  return { employee, loading, login, logout };
}
