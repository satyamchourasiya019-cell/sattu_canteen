import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { useSettings } from '../../hooks/useSettings';
import { markCleanupDone, saveSettings } from '../../services/settingsService';
import { cleanupOldTransactions } from '../../services/transactionService';
import { cutoffDateString, isValidDateString } from '../../utils/dateUtils';
import { formatEpoch } from '../../utils/format';
import { friendlyMessage } from '../../utils/errors';
import { QR_TYPE_LABELS, type QrType } from '../../types';

const QR_TARGETS: { type: QrType; path: string; hint: string }[] = [
  { type: 'breakfastSnacks', path: '/qr/breakfastSnacks', hint: 'Print & paste at the Breakfast / Snacks counter' },
  { type: 'lunchDinner', path: '/qr/lunchDinner', hint: 'Print & paste at the Lunch / Dinner counter' },
];

export default function SettingsPage(): JSX.Element {
  const { settings, loading } = useSettings();
  const [name, setName] = useState('');
  const [selfReg, setSelfReg] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const [baseUrl, setBaseUrl] = useState('');

  const [confirmCutoff, setConfirmCutoff] = useState('');
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<string | null>(null);

  const expectedCutoff = useMemo(() => cutoffDateString(settings.retentionDays), [settings.retentionDays]);

  useEffect(() => {
    setName(settings.canteenName);
    setSelfReg(settings.allowSelfRegistration);
  }, [settings.canteenName, settings.allowSelfRegistration]);

  useEffect(() => {
    setBaseUrl(window.location.origin);
  }, []);

  useEffect(() => {
    if (!baseUrl) return;
    for (const t of QR_TARGETS) {
      const canvas = canvasRefs.current[t.type];
      if (canvas) {
        QRCode.toCanvas(canvas, `${baseUrl}${t.path}`, { width: 200, margin: 2 }, () => undefined);
      }
    }
  }, [baseUrl]);

  async function handleSave(): Promise<void> {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      await saveSettings({ canteenName: name.trim() || 'Company Canteen', allowSelfRegistration: selfReg });
      setMessage('Settings saved.');
    } catch (err) {
      setError(friendlyMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleCleanup(): Promise<void> {
    if (cleanupBusy) return;
    if (!isValidDateString(confirmCutoff) || confirmCutoff !== expectedCutoff) {
      setError(`Type the cutoff date exactly as shown (${expectedCutoff}) to enable cleanup.`);
      return;
    }
    setCleanupBusy(true);
    setError(null);
    setCleanupResult(null);
    try {
      const deleted = await cleanupOldTransactions(confirmCutoff);
      await markCleanupDone(Date.now(), deleted);
      setCleanupResult(
        deleted === 0
          ? 'No transactions older than the cutoff date were found. Nothing was deleted.'
          : `Cleanup complete: ${deleted} transaction(s) older than ${confirmCutoff} deleted.`,
      );
      setConfirmCutoff('');
    } catch (err) {
      setError(friendlyMessage(err));
    } finally {
      setCleanupBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="page-head"><h1>Settings</h1></div>

      {loading && <div className="banner banner-info">Loading settings…</div>}

      <section className="panel">
        <h2 className="section-title">General</h2>
        <label className="field-label" htmlFor="canteen-name">
          Canteen Name (shown on employee phones)
          <input id="canteen-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="check-label">
          <input type="checkbox" checked={selfReg} onChange={(e) => setSelfReg(e.target.checked)} />
          Allow employees to register themselves (turn off to require admin-added serials)
        </label>
        {message && <div className="banner banner-ok">{message}</div>}
        {error && <div className="banner banner-error">{error}</div>}
        <button type="button" className="btn-primary" disabled={saving} onClick={handleSave}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </section>

      <section className="panel">
        <h2 className="section-title">Canteen QR Codes (print both)</h2>
        <div className="qr-grid">
          {QR_TARGETS.map((t) => (
            <div className="qr-card" key={t.type}>
              <h3>{QR_TYPE_LABELS[t.type]}</h3>
              <canvas
                ref={(el) => {
                  canvasRefs.current[t.type] = el;
                }}
                className="qr-canvas"
                aria-label={`${QR_TYPE_LABELS[t.type]} QR code`}
              />
              <p className="muted small">{t.hint}</p>
              <div className="order-url">{baseUrl}{t.path}</div>
            </div>
          ))}
        </div>
        <p className="muted small">
          Employees scan the counter's QR; the page detects the current meal from the time windows in
          Meals &amp; Items — Breakfast/Snacks from QR 1, Lunch/Dinner from QR 2.
        </p>
      </section>

      <section className="panel">
        <h2 className="section-title">Data Retention</h2>
        <p className="muted small">
          Transactions older than <strong>{settings.retentionDays} days</strong> are eligible for deletion
          (cutoff <strong>{expectedCutoff}</strong>). Only records strictly older than the cutoff are removed.
          {settings.lastCleanupAt && <> Last run: {formatEpoch(settings.lastCleanupAt)}.</>}
        </p>
        <label className="field-label" htmlFor="cutoff">
          Confirm cutoff date to enable cleanup (type {expectedCutoff})
          <input id="cutoff" placeholder={expectedCutoff} value={confirmCutoff} maxLength={10} onChange={(e) => setConfirmCutoff(e.target.value)} />
        </label>
        {cleanupResult && <div className="banner banner-ok">{cleanupResult}</div>}
        <button type="button" className="btn-danger" disabled={cleanupBusy} onClick={handleCleanup}>
          {cleanupBusy ? 'Deleting old records…' : 'Run Cleanup'}
        </button>
      </section>

      <section className="panel">
        <h2 className="section-title">Admin Accounts</h2>
        <p className="muted small">
          Demo accounts: <code>admin@canteen.local / admin123</code> and two supervisors
          (<code>supervisor1@canteen.local</code>, <code>supervisor2@canteen.local</code> — password <code>super123</code>).
          In Firebase mode, accounts are managed in the Firebase Console (Authentication + <code>users</code> role docs).
        </p>
      </section>
    </div>
  );
}
