import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import QrScanner from '../../components/QrScanner';
import { ApiError } from '../../services/api';
import { confirmScan, getScanContext } from '../../services/scanService';
import { friendlyMessage } from '../../utils/errors';
import { formatCurrency, formatDisplayDate, formatTime12h } from '../../utils/format';
import type { ScanContext } from '../../types';

type Phase = 'scanner' | 'checking' | 'confirm' | 'done' | 'error';

/**
 * In-app scan flow (opened from the employee home "Scan QR" button).
 * The camera reads the counter QR; the SERVER decides which meal is active
 * right now (phone clocks are not trusted) — so scanning the same QR at 8 AM
 * records Breakfast and at 8 PM records Dinner. Duplicates are blocked by
 * the backend and the screen offers extra items instead.
 */
export default function QrScanPage(): JSX.Element {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('scanner');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [ctx, setCtx] = useState<ScanContext | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ kind: 'created' | 'addon'; meal: string; amount: number; time: string } | null>(null);
  const lastCode = useRef<string | null>(null);

  useEffect(() => {
    lastCode.current = null;
  }, []);

  const handleDetected = useCallback(
    async (text: string): Promise<void> => {
      // Only react to canteen counter URLs (printed QRs point at /qr/...).
      if (!/\/qr\/(breakfastSnacks|lunchDinner)/.test(text)) {
        setErrorMsg('This is not a canteen counter QR code. Please scan the QR placed at the counter.');
        setPhase('error');
        return;
      }
      if (lastCode.current === text) return; // same frame still visible
      lastCode.current = text;
      setPhase('checking');
      setErrorMsg(null);
      try {
        const c = await getScanContext(text.endsWith('lunchDinner') ? 'lunchDinner' : 'breakfastSnacks');
        setCtx(c);
        setSelected([]);
        setPhase('confirm');
      } catch (err) {
        if (err instanceof ApiError) {
          setErrorMsg(err.message);
        } else {
          setErrorMsg(friendlyMessage(err));
        }
        setPhase('error');
      }
    },
    [],
  );

  function toggleAddon(id: string): void {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handleConfirm(): Promise<void> {
    if (!ctx || submitting) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await confirmScan(ctx.meal, selected);
      setResult({ kind: res.kind, meal: ctx.meal, amount: res.transaction.amount, time: res.transaction.time });
      setPhase('done');
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg(friendlyMessage(err));
      }
      setPhase('error');
    } finally {
      setSubmitting(false);
    }
  }

  function backToScanner(): void {
    lastCode.current = null;
    setCtx(null);
    setErrorMsg(null);
    setPhase('scanner');
  }

  if (phase === 'scanner') {
    return (
      <div className="order-wrap">
        <header className="order-header">
          <h1>Scan Counter QR</h1>
          <p className="muted">{formatDisplayDate(new Date().toISOString().slice(0, 10))}</p>
        </header>
        <div className="order-card">
          <QrScanner onDetected={(t) => void handleDetected(t)} onClose={() => navigate('/user-ordering')} />
        </div>
      </div>
    );
  }

  if (phase === 'checking') {
    return (
      <div className="order-wrap center">
        <div className="spinner" aria-hidden />
        <p className="muted">Checking today's menu time…</p>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="order-wrap">
        <div className="order-card error-card">
          <div className="error-icon" aria-hidden>!</div>
          <h1>Cannot Record Right Now</h1>
          <p>{errorMsg}</p>
          <div className="btn-row">
            <button type="button" className="btn-primary" onClick={backToScanner}>Scan Again</button>
            <Link className="btn-ghost" to="/user-ordering">Home</Link>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'done' && result) {
    return (
      <div className="order-wrap">
        <div className="order-card success-card">
          <div className="success-icon" aria-hidden>✓</div>
          <h1>{result.kind === 'created' ? 'Meal Recorded' : 'Additional Item Added'}</h1>
          <div className="confirm-box">
            <div className="confirm-row"><span>Meal</span><strong>{result.meal}</strong></div>
            <div className="confirm-row"><span>Time</span><strong>{formatTime12h(result.time)}</strong></div>
            <div className="confirm-row"><span>Amount Added</span><strong className="total-strong">{formatCurrency(result.amount)}</strong></div>
          </div>
          <p className="muted small center-text">Your canteen account has been updated. Thank you!</p>
          <div className="btn-row">
            <button type="button" className="btn-primary" onClick={backToScanner}>Scan Again</button>
            <Link className="btn-ghost" to="/user-ordering">Home</Link>
          </div>
        </div>
      </div>
    );
  }

  if (!ctx) {
    return (
      <div className="order-wrap center">
        <div className="spinner" aria-hidden />
        <p className="muted">Loading…</p>
      </div>
    );
  }

  const addonTotal = ctx.addons.filter((a) => selected.includes(a.id)).reduce((s, a) => s + a.price, 0);
  const grandTotal = (ctx.alreadyTaken ? 0 : ctx.mealAmount) + addonTotal;

  return (
    <div className="order-wrap">
      <header className="order-header">
        <h1>{ctx.meal ? ctx.meal.charAt(0).toUpperCase() + ctx.meal.slice(1) : 'Meal'} Time</h1>
        <p className="muted">{formatDisplayDate(ctx.date)} · {formatTime12h(ctx.time)}</p>
      </header>

      <div className="order-card">
        <div className="id-card compact">
          <div className="id-avatar" aria-hidden>{(ctx.employee.name || '?').slice(0, 1).toUpperCase()}</div>
          <div>
            <div className="id-name">{ctx.employee.name || 'Employee'}</div>
            <div className="id-meta">Serial <strong>{ctx.employee.serial}</strong></div>
          </div>
        </div>

        {ctx.alreadyTaken && ctx.existingTransaction ? (
          <div className="banner banner-info">
            <strong>{ctx.meal.charAt(0).toUpperCase() + ctx.meal.slice(1)} already recorded</strong> at {formatTime12h(ctx.existingTransaction.time)} — {formatCurrency(ctx.existingTransaction.amount)}. No duplicate charge. You can still add extra items below.
          </div>
        ) : (
          <div className="banner banner-ok">
            <strong>{ctx.meal.charAt(0).toUpperCase() + ctx.meal.slice(1)}</strong> will be recorded at {formatCurrency(ctx.mealAmount)}.
          </div>
        )}

        <h2 className="order-subtitle">
          {ctx.qrType === 'breakfastSnacks' ? 'Extra items (Tea / Coffee / Milk / …)' : 'Taken with (Extra Roti / Curd / Sweet / …)'}
        </h2>
        {ctx.addons.length === 0 ? (
          <p className="muted small">No additional items available.</p>
        ) : (
          <div className="addon-list">
            {ctx.addons.map((a) => (
              <label key={a.id} className={`addon-row ${selected.includes(a.id) ? 'selected' : ''}`}>
                <input type="checkbox" checked={selected.includes(a.id)} onChange={() => toggleAddon(a.id)} />
                <span className="addon-name">{a.name}</span>
                <span className="addon-price">{formatCurrency(a.price)}</span>
              </label>
            ))}
          </div>
        )}

        <div className="total-bar">
          <span>Total to add</span>
          <strong>{formatCurrency(grandTotal)}</strong>
        </div>

        <button type="button" className="btn-primary btn-block" disabled={submitting || (ctx.alreadyTaken && selected.length === 0)} onClick={handleConfirm}>
          {submitting ? 'Recording…' : ctx.alreadyTaken ? 'Add Selected Items' : `Confirm ${ctx.meal}`}
        </button>
        {!ctx.alreadyTaken && selected.length === 0 && (
          <p className="muted small center-text">No extra items? Just confirm.</p>
        )}
      </div>
    </div>
  );
}
