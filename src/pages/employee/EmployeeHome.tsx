import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import EmployeeShell from '../../components/EmployeeShell';
import { useEmployeeSession } from '../../hooks/useEmployeeSession';
import { useSettings } from '../../hooks/useSettings';
import { ApiError } from '../../services/api';
import { friendlyMessage } from '../../utils/errors';

type FieldErrors = Partial<Record<'serial' | 'name' | 'phone' | 'form', string>>;

/**
 * Employee home. Two states:
 *  - NOT logged in: a clean app-style login card (serial, name, phone, dept).
 *  - Logged in: rendered inside EmployeeShell (name header, bottom nav) with
 *    the two big actions — Scan Canteen QR and Order Food.
 */
export default function EmployeeHome(): JSX.Element {
  const { employee, loading, login } = useEmployeeSession();
  const { settings } = useSettings();

  if (loading) {
    return (
      <div className="boot-screen">
        <div className="spinner" aria-hidden />
        <p>Loading…</p>
      </div>
    );
  }

  if (employee) {
    return (
      <EmployeeShell>
        <HomeBody />
      </EmployeeShell>
    );
  }

  return <LoginBody canteenName={settings.canteenName} onLogin={login} />;
}

function HomeBody(): JSX.Element {
  const { employee } = useEmployeeSession();
  const navigate = useNavigate();
  const [scanError, setScanError] = useState(false);

  return (
    <div className="pad-lg">
      {scanError && (
        <div className="banner banner-error">
          The scanner could not open on this device. Use the counter links below or open this site over HTTPS.
        </div>
      )}

      <button type="button" className="scan-cta" onClick={() => navigate('/scan')} data-test="scan-cta">
        <span className="scan-cta-icon" aria-hidden>
          <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
            <line x1="3" y1="12" x2="21" y2="12" />
          </svg>
        </span>
        <span>
          <strong>Scan Canteen QR</strong>
          <small>Record your meal at the counter</small>
        </span>
      </button>

      <button type="button" className="order-cta" onClick={() => navigate('/order')} data-test="order-cta">
        <span className="order-cta-icon" aria-hidden>
          <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2 4 6v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6l-2-4z" /><line x1="4" y1="6" x2="20" y2="6" /><path d="M16 10a4 4 0 0 1-8 0" /></svg>
        </span>
        <span>
          <strong>Order Food Online</strong>
          <small>Pick items — canteen prepares them</small>
        </span>
        <span className="order-cta-arrow" aria-hidden>→</span>
      </button>

      <p className="muted small center-text">No camera? Open a counter link directly:</p>
      <div className="qr-btn-row">
        <button
          type="button"
          className="qr-btn compact"
          onClick={() => {
            navigate('/qr/breakfastSnacks');
            setScanError(false);
          }}
        >
          <span className="qr-btn-icon" aria-hidden>🌅</span>
          <span><strong>Breakfast / Snacks</strong></span>
        </button>
        <button
          type="button"
          className="qr-btn compact"
          onClick={() => {
            navigate('/qr/lunchDinner');
            setScanError(false);
          }}
        >
          <span className="qr-btn-icon" aria-hidden>🍛</span>
          <span><strong>Lunch / Dinner</strong></span>
        </button>
      </div>

      {employee && (
        <p className="muted small center-text login-note">
          You stay logged in on this phone until the canteen admin removes you.
        </p>
      )}
    </div>
  );
}

function LoginBody({
  canteenName,
  onLogin,
}: {
  canteenName: string;
  onLogin: (input: { serial: string; employeeNo: string; name: string; department: string; phone: string }) => Promise<unknown>;
}): JSX.Element {
  const [serial, setSerial] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [department, setDepartment] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

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
      await onLogin({
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

  return (
    <div className="login-screen">
      <div className="login-brand">
        <div className="login-logo" aria-hidden>🍽</div>
        <h1>{canteenName || 'Canteen'}</h1>
        <p>Employee sign in</p>
      </div>

      <form className="login-card" onSubmit={handleSubmit}>
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

        <div className="field-split">
          <label className="field-label" htmlFor="reg-phone">
            Phone
            <input
              id="reg-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="98765 43210"
              value={phone}
              maxLength={20}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
          <label className="field-label" htmlFor="reg-dept">
            Department
            <input
              id="reg-dept"
              placeholder="Production"
              value={department}
              maxLength={40}
              onChange={(e) => setDepartment(e.target.value)}
            />
          </label>
        </div>
        {errors.phone && <div className="field-error">{errors.phone}</div>}

        {errors.form && <div className="banner banner-error">{errors.form}</div>}

        <button type="submit" className="btn-primary btn-block" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign In'}
        </button>
        <p className="muted small center-text">One time only — this phone will remember you until the admin removes you.</p>
      </form>
    </div>
  );
}
