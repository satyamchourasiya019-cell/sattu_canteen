import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdminAuth } from '../hooks/useAdminAuth';
import { adminSignIn } from '../services/authService';
import { BACKEND_MODE } from '../firebase/config';
import { friendlyMessage } from '../utils/errors';

export default function LoginPage(): JSX.Element {
  const navigate = useNavigate();
  const { admin } = useAdminAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in? Go straight to the dashboard.
  useEffect(() => {
    if (admin) navigate('/admin', { replace: true });
  }, [admin, navigate]);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await adminSignIn(email.trim(), password);
      navigate('/admin', { replace: true });
    } catch (err) {
      setError(friendlyMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="order-logo" aria-hidden>🍽</div>
        <h1>Canteen Admin</h1>
        <p className="muted">Authorized staff only</p>

        <label className="field-label" htmlFor="login-email">
          Email
          <input
            id="login-email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="field-label" htmlFor="login-password">
          Password
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        {error && <div className="banner banner-error">{error}</div>}

        <button type="submit" className="btn-primary btn-block" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign In'}
        </button>

        {BACKEND_MODE === 'local' && (
          <div className="banner banner-info small-banner">
            <strong>Demo accounts</strong><br />
            admin@canteen.local / admin123<br />
            supervisor1@canteen.local / super123<br />
            supervisor2@canteen.local / super123
          </div>
        )}
      </form>
    </div>
  );
}
