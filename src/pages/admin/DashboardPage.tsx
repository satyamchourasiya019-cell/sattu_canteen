import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTransactionsByDate } from '../../hooks/useTransactions';
import { useSettings } from '../../hooks/useSettings';
import { formatCurrency, formatTime12h, todayDateString } from '../../utils/format';
import { MEAL_LABELS, MEALS, type MealType, type Transaction } from '../../types';

function countByMeal(txns: Transaction[], meal: MealType): { count: number; amount: number } {
  let count = 0;
  let amount = 0;
  for (const t of txns) {
    if (t.meal !== meal) continue;
    count += 1;
    amount += t.amount;
  }
  return { count, amount };
}

export default function DashboardPage(): JSX.Element {
  const today = todayDateString();
  const { txns, loading, error } = useTransactionsByDate(today);
  const { settings } = useSettings();
  const [search, setSearch] = useState('');

  const stats = useMemo(() => {
    const todayTxns = txns.filter((t) => t.date === today && t.status !== 'cancelled');
    const uniqueEmployees = new Set(todayTxns.map((t) => t.serial));
    const totalAmount = todayTxns.reduce((s, t) => s + t.amount, 0);
    const addonAmount = todayTxns.reduce((s, t) => s + t.addonAmount, 0);
    const byMeal = Object.fromEntries(MEALS.map((m) => [m, countByMeal(todayTxns, m)])) as Record<MealType, { count: number; amount: number }>;
    return {
      transactions: todayTxns.length,
      employees: uniqueEmployees.size,
      totalAmount,
      addonAmount,
      byMeal,
    };
  }, [txns, today]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return txns;
    return txns.filter(
      (t) =>
        t.serial.toLowerCase().includes(q) ||
        t.employeeNo.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q),
    );
  }, [txns, search]);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Dashboard — Today</h1>
        <span className="live-dot" title="Live — updates automatically" />
      </div>

      {error && <div className="banner banner-error">{error}</div>}
      {loading && txns.length === 0 && <div className="banner banner-info">Loading Dashboard…</div>}

      <section className="cards-row">
        <div className="stat-card">
          <div className="stat-label">Total Transactions</div>
          <div className="stat-value">{stats.transactions}</div>
          <div className="stat-sub">{stats.employees} employees served</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Amount</div>
          <div className="stat-value">{formatCurrency(stats.totalAmount)}</div>
          <div className="stat-sub">incl. {formatCurrency(stats.addonAmount)} additional items</div>
        </div>
        {MEALS.map((m) => (
          <div className="stat-card" key={m}>
            <div className="stat-label">{MEAL_LABELS[m]}</div>
            <div className="stat-value">{stats.byMeal[m].count}</div>
            <div className="stat-sub">{formatCurrency(stats.byMeal[m].amount)}</div>
          </div>
        ))}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2 className="section-title">Live Transactions</h2>
          <input
            className="search-input"
            placeholder="Search serial / emp no / name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Link className="btn-ghost small" to="/admin/serials">Open Serial Page →</Link>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Serial</th>
                <th>Emp No</th>
                <th>Name</th>
                <th>Department</th>
                <th>Meal</th>
                <th>Meal ₹</th>
                <th>Additional</th>
                <th>Total</th>
                <th>Mode</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && !loading && (
                <tr><td colSpan={10} className="empty-row">No transactions yet today. They will appear here live as employees scan.</td></tr>
              )}
              {filtered.map((t) => (
                <tr key={t.id}>
                  <td>{formatTime12h(t.time)}</td>
                  <td className="mono">{t.serial}</td>
                  <td className="mono">{t.employeeNo || '—'}</td>
                  <td>{t.name || '—'}</td>
                  <td>{t.department || '—'}</td>
                  <td>{MEAL_LABELS[t.meal]}{t.mode === 'addon' ? ' (extra)' : ''}</td>
                  <td>{t.mealAmount ? formatCurrency(t.mealAmount) : '—'}</td>
                  <td className="small-cell">
                    {t.addons.length ? `${t.addons.map((a) => a.name).join(', ')} (${formatCurrency(t.addonAmount)})` : '—'}
                  </td>
                  <td><strong>{formatCurrency(t.amount)}</strong></td>
                  <td><span className={`mode-chip mode-${t.mode}`}>{t.mode === 'qr' ? 'QR' : t.mode === 'manual' ? 'Manual' : 'Extra'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">Canteen: {settings.canteenName} · Meal timings are configured under Meals & Items.</p>
      </section>
    </div>
  );
}
