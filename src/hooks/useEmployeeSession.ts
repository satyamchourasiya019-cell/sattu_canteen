import { useCallback, useEffect, useState } from 'react';
import * as api from '../services/api';
import { BACKEND_MODE, requireAuth } from '../firebase/config';
import { checkSerial, saveEmployee } from '../services/employeeService';
import { signInAnonymously } from 'firebase/auth';
import { friendlyMessage } from '../utils/errors';
import type { Employee } from '../types';

/**
 * Employee self-service session on this device.
 *
 * Local mode: session token + serial kept by the demo server / localStorage.
 * Firebase mode: the device signs in anonymously and stores the serial
 * locally; registration claims a serial only if it has no name yet, and
 * Firestore rules reject overwriting an already-claimed serial.
 */
export function useEmployeeSession() {
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    if (BACKEND_MODE !== 'firebase') {
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
    }
    // Firebase mode: restore from the stored serial.
    const serial = api.storedEmployeeSerial();
    if (!serial) {
      setLoading(false);
      return () => undefined;
    }
    checkSerial(serial)
      .then((check) => {
        if (!alive) return;
        if (check.ok) {
          setEmployee({
            serial,
            employeeNo: check.employeeNo ?? '',
            name: check.name ?? '',
            department: check.department ?? '',
            active: true,
            createdAt: 0,
            updatedAt: 0,
          });
        } else {
          api.storeEmployeeSerial(null);
        }
        setLoading(false);
      })
      .catch(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const login = useCallback(
    async (input: { serial: string; employeeNo: string; name: string; department: string }) => {
      if (BACKEND_MODE !== 'firebase') {
        const res = await api.apiEmployeeRegister(input);
        setEmployee(res.employee);
        return res.employee;
      }
      // Firebase mode
      const auth = requireAuth();
      if (!auth.currentUser) await signInAnonymously(auth);
      const check = await checkSerial(input.serial);
      if (!check.ok) {
        throw new Error(
          check.reason === 'inactive'
            ? 'This serial number is inactive. Please contact the canteen supervisor.'
            : 'Please enter a valid serial number.',
        );
      }
      const alreadyClaimed = Boolean(check.name && check.name.trim());
      // Only fill empty fields — never overwrite admin-entered data.
      const update: Record<string, string> = {};
      if (!check.name && input.name.trim()) update.name = input.name.trim();
      if (!check.employeeNo && input.employeeNo.trim()) update.employeeNo = input.employeeNo.trim();
      if (!check.department && input.department.trim()) update.department = input.department.trim();
      if (Object.keys(update).length > 0) {
        try {
          await saveEmployee(input.serial, update);
        } catch {
          // Rules may reject the update (e.g. claimed by someone else in
          // between); the device can still continue with the existing data.
        }
      }
      const emp: Employee = {
        serial: input.serial,
        employeeNo: check.employeeNo || input.employeeNo.trim(),
        name: check.name || input.name.trim(),
        department: check.department || input.department.trim(),
        active: true,
        createdAt: 0,
        updatedAt: 0,
      };
      void alreadyClaimed;
      api.storeEmployeeSerial(input.serial);
      setEmployee(emp);
      return emp;
    },
    [],
  );

  const logout = useCallback(async () => {
    if (BACKEND_MODE !== 'firebase') await api.apiEmployeeLogout();
    api.storeEmployeeSerial(null);
    setEmployee(null);
  }, []);

  return { employee, loading, login, logout, friendlyMessage };
}
