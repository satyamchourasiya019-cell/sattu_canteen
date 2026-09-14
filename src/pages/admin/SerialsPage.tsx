import { useMemo, useState } from 'react';
import { useDailyEntries, useMealItems, useTransactionsByDate } from '../../hooks/useTransactions';
import { createManualEntry, deleteTransaction } from '../../services/transactionService';
import { friendlyMessage } from '../../utils/errors';
import { formatCurrency, formatTime12h, todayDateString } from '../../utils/format';
import { MEAL_LABELS, MEALS, type DailyEntry, type MealType } from '../../types';

/**
 * The Admin "Serial Number Page": every employee's day as one row
 * (Breakfast | Snacks | Lunch | Dinner | Additional | Total) that updates
 * live when employees scan. Admins can also make manual entries/corrections.
 */
export default function SerialsPage(): JSX.Element {
  const [date, setDate] = useState(todayDateString());
  const { entries, loading, error } = useDailyEntries(date, date);
  const { txns } = useTransactionsByDate(date);
  const { items } = useMealItems();
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // manual entry modal state
  const [manualFor, setManualFor] = useState<DailyEntry | null>(null);
  const [manualMeal, setManualMeal] = useState<MealType>('lunch');
  const [manualAddons, setManualAddons] = useState<string[]>([]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.serial.toLowerCase().includes(q) ||
        e.employeeNo.toLowerCase().includes(q) ||
        e.name.toLowerCase().includes(q) ||
        e.department.toLowerCase().includes(q),
    );
  }, [entries, search]);

  const serialTxns = useMemo(
    () => (manualFor ? txns.filter((t) => t.serial === manualFor.serial) : []),
    [txns, manualFor],
  );

  const totals = useMemo(
    () => ({
      rows: filtered.length,
      amount: filtered.reduce((s, e) => s + e.total, 0),
      breakfast: filtered.filter((e) => e.breakfast > 0).length,
      snacks: filtered.filter((e) => e.snacks > 0).length,
      lunch: filtered.filter((e) => e.lunch > 0).length,
      dinner: filtered.filter((e) => e.dinner > 0).length,
    }),
    [filtered],
  );

  async function handleManualSubmit(): Promise<void> {
    if (!manualFor || busy) return;
    setBusy(true);
    setFormError(null);
    setMessage(null);
    try {
      await createManualEntry({ serial: manualFor.serial, meal: manualMeal, addonIds: manualAddons });
      setMessage(`Manual entry saved for serial ${manualFor.serial} (${MEAL_LABELS[manualMeal]}).`);
      setManualAddons([]);
      setManualFor(null);
    } catch (err) {
      setFormError(friendlyMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteTxn(id: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    setFormError(null);
    try {
      await deleteTransaction(id);
      setMessage('Record deleted.');
    } catch (err) {
      setFormError(friendlyMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Serial Numbers — Daily Billing</h1>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      {error && <div className="banner banner-error">{error}</div>}
      {message && <div className="banner banner-ok">{message}</div>}
      {formError && <div className="banner banner-error">{formError}</div>}
      {loading && entries.length === 0 && <div className="banner banner-info">Loading records…</div>}

      <section className="panel">
        <div className="panel-head">
          <h2 className="section-title">{filtered.length} employee row(s) · {formatCurrency(totals.amount)}</h2>
          <input
            className="search-input"
            placeholder="Search serial / name / department…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Serial</th>
                <th>Emp No</th>
                <th>Name</th>
                <th>Department</th>
                <th className="num">Breakfast</th>
                <th className="num">Snacks</th>
                <th className="num">Lunch</th>
                <th className="num">Dinner</th>
                <th className="num">Additional</th>
                <th className="num">Total</th>
                <th>Last Scan</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && !loading && (
                <tr><td colSpan={12} className="empty-row">No meals recorded for this date yet. Rows appear automatically when employees scan.</td></tr>
              )}
              {filtered.map((e) => (
                <tr key={e.serial}>
                  <td className="mono">{e.serial}</td>
                  <td className="mono">{e.employeeNo || '—'}</td>
                  <td>{e.name || '—'}</td>
                  <td>{e.department || '—'}</td>
                  <td className="num">{e.breakfast ? formatCurrency(e.breakfast) : '—'}</td>
                  <td className="num">{e.snacks ? formatCurrency(e.snacks) : '—'}</td>
                  <td className="num">{e.lunch ? formatCurrency(e.lunch) : '—'}</td>
                  <td className="num">{e.dinner ? formatCurrency(e.dinner) : '—'}</td>
                  <td className="num small-cell">
                    {e.addons.length ? `${e.addons.map((a) => a.name).join(', ')} — ${formatCurrency(e.addonAmount)}` : '—'}
                  </td>
                  <td className="num"><strong>{formatCurrency(e.total)}</strong></td>
                  <td>{formatTime12h(e.lastTime)}</td>
                  <td>
                    <button
                      type="button"
                      className="btn-ghost small"
                      onClick={() => {
                        setManualFor(e);
                        setManualMeal('lunch');
                        setManualAddons([]);
                      }}
                    >
                      Manual Entry
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            {filtered.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={7}>Totals — B: {totals.breakfast} · S: {totals.snacks} · L: {totals.lunch} · D: {totals.dinner}</td>
                  <td colSpan={5} className="num"><strong>{formatCurrency(totals.amount)}</strong></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      {manualFor && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <h3>Manual Entry — Serial {manualFor.serial} ({manualFor.name || 'unnamed'})</h3>
            <p className="muted small">Admin override. Creates an extra record for today; duplicate protection is not applied.</p>

            <div className="field-row">
              <label className="field-label">
                Meal
                <select value={manualMeal} onChange={(e) => setManualMeal(e.target.value as MealType)}>
                  {MEALS.map((m) => (
                    <option key={m} value={m}>{MEAL_LABELS[m]}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="addon-list">
              {items.filter((i) => i.enabled).map((a) => (
                <label key={a.id} className={`addon-row ${manualAddons.includes(a.id) ? 'selected' : ''}`}>
                  <input
                    type="checkbox"
                    checked={manualAddons.includes(a.id)}
                    onChange={() =>
                      setManualAddons((prev) => (prev.includes(a.id) ? prev.filter((x) => x !== a.id) : [...prev, a.id]))
                    }
                  />
                  <span className="addon-name">{a.name}</span>
                  <span className="addon-price">{formatCurrency(a.price)}</span>
                </label>
              ))}
            </div>

            {formError && <div className="banner banner-error">{formError}</div>}

            <div className="btn-row">
              <button type="button" className="btn-primary" disabled={busy} onClick={handleManualSubmit}>
                {busy ? 'Saving…' : 'Save Manual Entry'}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setManualFor(null)}>Cancel</button>
            </div>

            {serialTxns.length > 0 && (
              <>
                <h4 className="section-title">Today's records for this serial</h4>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr><th>Time</th><th>Meal</th><th>Details</th><th>Amount</th><th /></tr>
                    </thead>
                    <tbody>
                      {serialTxns.map((t) => (
                        <tr key={t.id}>
                          <td>{formatTime12h(t.time)}</td>
                          <td>{MEAL_LABELS[t.meal]}{t.mode === 'addon' ? ' (extra)' : ''}{t.mode === 'manual' ? ' (manual)' : ''}</td>
                          <td className="small-cell">{t.addons.length ? t.addons.map((a) => `${a.name} ₹${a.price}`).join(', ') : '—'}</td>
                          <td>{formatCurrency(t.amount)}</td>
                          <td>
                            <button type="button" className="btn-danger small" disabled={busy} onClick={() => void handleDeleteTxn(t.id)}>
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
