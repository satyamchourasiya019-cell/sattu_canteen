import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useEmployeeSession } from '../../hooks/useEmployeeSession';
import { useSettings } from '../../hooks/useSettings';
import { ApiError } from '../../services/api';
import { friendlyMessage } from '../../utils/errors';
import { formatDisplayDate, todayDateString } from '../../utils/format';

type FieldErrors = Partial<Record<'serial' | 'name' | 'phone' | 'form', string>>;

/**
 * App-style login: the employee signs in ONCE with serial + name (+ phone,
 * department). The device stays logged in until the ADMIN removes it —
 * "Not you? Log out" only frees the serial for the next person; one serial
 * can be logged in on a single device at a time.
 */
export default function EmployeeHome(): JSX.Element {
  const { employee, loading, login, logout } = useEmployeeSession();
  const { settings } = useSettings();
  const navigate = useNavigate();

  const [serial, setSerial] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [department, setDepartment] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setErrors({});
  }, [serial, name, phone, department]);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (submitting) return;
    const next: FieldErrors = {};
    if (!serial.trim()) next.serial = 'Serial number is required.';
    if (!name.trim()) next.name = 'Name is required.';
    if (phone.trim() && !/^[0-9+\-\s]{6,20}$/.test(phone.trim())) next.phone = 'Please enter a valid phone number.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSubmitting(true);
    try {
      await login({
        serial: serial.trim().replace(/\s+/g, ''),
        employeeNo: '',
        name: name.trim(),
        department: department.trim(),
        phone: phone.trim(),
      });
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

  async function handleSwitchUser(): Promise<void> {
    await logout();
    setSerial('');
    setName('');
    setPhone('');
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

          <button type="button" className="scan-cta" onClick={() => navigate('/scan')}>
            <span className="scan-cta-icon" aria-hidden>
              <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
                <line x1="3" y1="12" x2="21" y2="12" />
              </svg>
            </span>
            <span>
              <strong>Scan Canteen QR</strong>
              <small>Camera opens — point at the counter code</small>
            </span>
          </button>

          <p className="muted small center-text">No camera? Open a counter link directly:</p>
          <div className="qr-btn-row">
            <Link to="/qr/breakfastSnacks" className="qr-btn compact">
              <span className="qr-btn-icon" aria-hidden>🌅</span>
              <span><strong>Breakfast / Snacks</strong></span>
            </Link>
            <Link to="/qr/lunchDinner" className="qr-btn compact">
              <span className="qr-btn-icon" aria-hidden>🍛</span>
              <span><strong>Lunch / Dinner</strong></span>
            </Link>
          </div>

          <p className="muted small center-text login-note">
            You stay logged in on this phone until the canteen admin removes you.
          </p>
          <button type="button" className="btn-ghost small logout-link" onClick={handleSwitchUser}>
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
        <h1>{settings.canteenName || 'Canteen'}</h1>
        <p className="muted">{formatDisplayDate(todayDateString())}</p>
      </header>

      <form className="order-card" onSubmit={handleSubmit}>
        <h2 className="order-title">Employee Login</h2>
        <p className="muted small">One time only — this phone will remember you until the admin removes you.</p>

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
            placeholder="Your full name"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {errors.name && <div className="field-error">{errors.name}</div>}

        <label className="field-label" htmlFor="reg-phone">
          Phone Number
          <input
            id="reg-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="e.g. 98765 43210"
            value={phone}
            maxLength={20}
            onChange={(e) => setPhone(e.target.value)}
          />
        </label>
        {errors.phone && <div className="field-error">{errors.phone}</div>}

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

        {errors.form && <div className="banner banner-error">{errors.form}</div>}

        <button type="submit" className="btn-primary btn-block" disabled={submitting}>
          {submitting ? 'Logging in…' : 'Login'}
        </button>
      </form>
    </div>
  );
}
