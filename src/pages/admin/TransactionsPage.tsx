import { useMemo, useState } from 'react';
import { useTransactionsRange } from '../../hooks/useTransactions';
import { deleteTransaction } from '../../services/transactionService';
import { transactionsToCsv, downloadCsv } from '../../utils/csv';
import { friendlyMessage } from '../../utils/errors';
import { formatCurrency, formatTime12h, toDateString, todayDateString } from '../../utils/format';
import { MEAL_LABELS, MEALS, type MealType, type Transaction } from '../../types';

function daysAgoStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toDateString(d);
}

type Quick = 'today' | 'yesterday' | '7d' | 'custom';

export default function TransactionsPage(): JSX.Element {
  const [quick, setQuick] = useState<Quick>('today');
  const [from, setFrom] = useState(todayDateString());
  const [to, setTo] = useState(todayDateString());
  const [search, setSearch] = useState('');
  const [meal, setMeal] = useState<'all' | MealType>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { txns, loading } = useTransactionsRange(from, to);

  function applyQuick(q: Quick): void {
    setQuick(q);
    setError(null);
    const today = todayDateString();
    if (q === 'today') { setFrom(today); setTo(today); }
    else if (q === 'yesterday') { const y = daysAgoStr(1); setFrom(y); setTo(y); }
    else if (q === '7d') { setFrom(daysAgoStr(6)); setTo(today); }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return txns.filter((t) => {
      if (meal !== 'all' && t.meal !== meal) return false;
      if (!q) return true;
      return (
        t.serial.toLowerCase().includes(q) ||
        t.employeeNo.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.department.toLowerCase().includes(q)
      );
    });
  }, [txns, search, meal]);

  const totals = useMemo(
    () => ({
      count: filtered.length,
      amount: filtered.reduce((s, t) => s + t.amount, 0),
      addon: filtered.reduce((s, t) => s + t.addonAmount, 0),
    }),
    [filtered],
  );

  async function handleDelete(t: Transaction): Promise<void> {
    if (busyId) return;
    setBusyId(t.id);
    setError(null);
    try {
      await deleteTransaction(t.id);
    } catch (err) {
      setError(friendlyMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  function handleExport(): void {
    if (filtered.length === 0) return;
    downloadCsv(`transactions_${from}_to_${to}.csv`, transactionsToCsv(filtered));
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Transaction History</h1>
        <button type="button" className="btn-primary" disabled={filtered.length === 0} onClick={handleExport}>
          Export CSV
        </button>
      </div>

      <section className="panel">
        <div className="filter-row">
          <div className="chip-row">
            {(['today', 'yesterday', '7d', 'custom'] as Quick[]).map((q) => (
              <button
                key={q}
                type="button"
                className={`chip ${quick === q ? 'chip-active' : ''}`}
                onClick={() => applyQuick(q)}
              >
                {q === 'today' ? 'Today' : q === 'yesterday' ? 'Yesterday' : q === '7d' ? 'Last 7 days' : 'Custom'}
              </button>
            ))}
          </div>
          {quick === 'custom' && (
            <div className="date-pair">
              <label>From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
              <label>To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
            </div>
          )}
          <input
            className="search-input"
            placeholder="Search serial / emp no / name / dept…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select value={meal} onChange={(e) => setMeal(e.target.value as 'all' | MealType)}>
            <option value="all">All meals</option>
            {MEALS.map((m) => (
              <option key={m} value={m}>{MEAL_LABELS[m]}</option>
            ))}
          </select>
        </div>

        {error && <div className="banner banner-error">{error}</div>}
        {loading && txns.length === 0 && <div className="banner banner-info">Loading transactions…</div>}

        <div className="summary-line">
          {totals.count} transaction(s) · Meal items {formatCurrency(totals.amount - totals.addon)} · Additional {formatCurrency(totals.addon)} · <strong>Total {formatCurrency(totals.amount)}</strong>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Time</th>
                <th>Emp No</th>
                <th>Serial</th>
                <th>Name</th>
                <th>Department</th>
                <th>QR</th>
                <th>Meal</th>
                <th>Items</th>
                <th className="num">Amount</th>
                <th>Mode</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && !loading && (
                <tr><td colSpan={12} className="empty-row">No transactions match the filters.</td></tr>
              )}
              {filtered.map((t) => (
                <tr key={t.id}>
                  <td>{t.date}</td>
                  <td>{formatTime12h(t.time)}</td>
                  <td className="mono">{t.employeeNo || '—'}</td>
                  <td className="mono">{t.serial}</td>
                  <td>{t.name || '—'}</td>
                  <td>{t.department || '—'}</td>
                  <td>{t.qrType === 'lunchDinner' ? 'L/D' : 'B/S'}</td>
                  <td>{MEAL_LABELS[t.meal]}</td>
                  <td className="small-cell">
                    {t.mealAmount ? `Meal ${formatCurrency(t.mealAmount)}` : ''}
                    {t.addons.length ? `${t.mealAmount ? ' + ' : ''}${t.addons.map((a) => `${a.name} ₹${a.price}`).join(', ')}` : ''}
                  </td>
                  <td className="num"><strong>{formatCurrency(t.amount)}</strong></td>
                  <td><span className={`mode-chip mode-${t.mode}`}>{t.mode === 'qr' ? 'QR' : t.mode === 'manual' ? 'Manual' : 'Extra'}</span></td>
                  <td>
                    <button type="button" className="btn-danger small" disabled={busyId === t.id} onClick={() => void handleDelete(t)}>
                      {busyId === t.id ? '…' : 'Delete'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
