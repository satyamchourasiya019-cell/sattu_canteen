import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useEmployeeSession } from '../../hooks/useEmployeeSession';
import { useSettings } from '../../hooks/useSettings';
import { ApiError } from '../../services/api';
import { friendlyMessage } from '../../utils/errors';
import { formatDisplayDate, todayDateString } from '../../utils/format';

type FieldErrors = Partial<Record<'serial' | 'employeeNo' | 'name' | 'department' | 'form', string>>;

/**
 * Employee home: register once (serial + name + employee no + department),
 * then the device stays identified. Two big QR-destination buttons follow.
 */
export default function EmployeeHome(): JSX.Element {
  const { employee, loading, login, logout } = useEmployeeSession();
  const { settings } = useSettings();
  const [params] = useSearchParams();

  const [serial, setSerial] = useState('');
  const [employeeNo, setEmployeeNo] = useState('');
  const [name, setName] = useState('');
  const [department, setDepartment] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const s = params.get('serial');
    if (s) setSerial(s.trim().replace(/\s+/g, ''));
  }, [params]);

  useEffect(() => {
    setErrors({});
  }, [serial, employeeNo, name, department]);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (submitting) return;
    const next: FieldErrors = {};
    if (!serial.trim()) next.serial = 'Serial number is required.';
    if (!name.trim()) next.name = 'Name is required.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSubmitting(true);
    try {
      await login({ serial: serial.trim().replace(/\s+/g, ''), employeeNo: employeeNo.trim(), name: name.trim(), department: department.trim() });
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors) {
        setErrors({ ...err.fieldErrors, form: err.message });
      } else {
        setErrors({ form: friendlyMessage(err) });
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogout(): Promise<void> {
    await logout();
    setSerial('');
    setEmployeeNo('');
    setName('');
    setDepartment('');
  }

  if (loading) {
    return (
      <div className="order-wrap center">
        <div className="spinner" aria-hidden />
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (employee) {
    return (
      <div className="order-wrap">
        <header className="order-header">
          <div className="order-logo" aria-hidden>🍽</div>
          <h1>{settings.canteenName || 'Canteen'}</h1>
          <p className="muted">{formatDisplayDate(todayDateString())}</p>
        </header>

        <div className="order-card">
          <div className="id-card">
            <div className="id-avatar" aria-hidden>{(employee.name || '?').slice(0, 1).toUpperCase()}</div>
            <div>
              <div className="id-name">{employee.name || 'Employee'}</div>
              <div className="id-meta">
                Serial <strong>{employee.serial}</strong>
                {employee.employeeNo ? <> · Emp No <strong>{employee.employeeNo}</strong></> : null}
                {employee.department ? <> · {employee.department}</> : null}
              </div>
            </div>
          </div>

          <p className="muted small center-text">What did you take? Scan the matching QR in the canteen, or tap below:</p>

          <Link to="/qr/breakfastSnacks" className="qr-btn">
            <span className="qr-btn-icon" aria-hidden>🌅</span>
            <span>
              <strong>Breakfast / Snacks QR</strong>
              <small>Morning & evening counter</small>
            </span>
          </Link>
          <Link to="/qr/lunchDinner" className="qr-btn">
            <span className="qr-btn-icon" aria-hidden>🍛</span>
            <span>
              <strong>Lunch / Dinner QR</strong>
              <small>Afternoon & night counter</small>
            </span>
          </Link>

          <button type="button" className="btn-ghost small logout-link" onClick={handleLogout}>
            Not you? Log out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="order-wrap">
      <header className="order-header">
        <div className="order-logo" aria-hidden>🍽</div>
        <h1>{settings.canteenName || 'Canteen'} — Register</h1>
        <p className="muted">{formatDisplayDate(todayDateString())}</p>
      </header>

      <form className="order-card" onSubmit={handleSubmit}>
        <h2 className="order-title">Employee Registration</h2>
        <p className="muted small">One time only — this phone will remember you.</p>

        <label className="field-label" htmlFor="reg-serial">
          Serial Number *
          <input
            id="reg-serial"
            inputMode="numeric"
            autoComplete="off"
            placeholder="e.g. 025"
            value={serial}
            maxLength={20}
            onChange={(e) => setSerial(e.target.value)}
          />
        </label>
        {errors.serial && <div className="field-error">{errors.serial}</div>}

        <label className="field-label" htmlFor="reg-name">
          Name *
          <input
            id="reg-name"
            autoComplete="name"
            placeholder="e.g. Satyam Chourasiya"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {errors.name && <div className="field-error">{errors.name}</div>}

        <label className="field-label" htmlFor="reg-empno">
          Employee Number
          <input
            id="reg-empno"
            inputMode="numeric"
            autoComplete="off"
            placeholder="e.g. 10245"
            value={employeeNo}
            maxLength={20}
            onChange={(e) => setEmployeeNo(e.target.value)}
          />
        </label>
        {errors.employeeNo && <div className="field-error">{errors.employeeNo}</div>}

        <label className="field-label" htmlFor="reg-dept">
          Department
          <input
            id="reg-dept"
            placeholder="e.g. Production"
            value={department}
            maxLength={40}
            onChange={(e) => setDepartment(e.target.value)}
          />
        </label>
        {errors.department && <div className="field-error">{errors.department}</div>}

        {errors.form && <div className="banner banner-error">{errors.form}</div>}

        <button type="submit" className="btn-primary btn-block" disabled={submitting}>
          {submitting ? 'Registering…' : 'Register / Continue'}
        </button>
      </form>
    </div>
  );
}
