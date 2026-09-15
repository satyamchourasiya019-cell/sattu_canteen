import { useMemo, useState } from 'react';
import { useTransactionsRange } from '../../hooks/useTransactions';
import { downloadCsv, transactionsToCsv, dailyEntriesToCsv } from '../../utils/csv';
import { aggregateDailyEntries } from '../../services/transactionService';
import { formatCurrency, toDateString, todayDateString } from '../../utils/format';
import { MEAL_LABELS, MEALS, type MealType } from '../../types';

type Tab = 'employee' | 'daily' | 'monthly' | 'department' | 'meal';

const TABS: { id: Tab; label: string }[] = [
  { id: 'employee', label: 'Employee History' },
  { id: 'daily', label: 'Daily' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'department', label: 'Department-wise' },
  { id: 'meal', label: 'Meal-wise' },
];

function daysAgoStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toDateString(d);
}

export default function ReportsPage(): JSX.Element {
  const [from, setFrom] = useState(daysAgoStr(29));
  const [to, setTo] = useState(todayDateString());
  const [tab, setTab] = useState<Tab>('employee');
  const [empSearch, setEmpSearch] = useState('');
  const { txns, loading } = useTransactionsRange(from, to);

  const active = useMemo(() => txns.filter((t) => t.status !== 'cancelled'), [txns]);
  const grand = useMemo(() => ({
    count: active.length,
    amount: active.reduce((s, t) => s + t.amount, 0),
    addon: active.reduce((s, t) => s + t.addonAmount, 0),
    employees: new Set(active.map((t) => t.serial)).size,
  }), [active]);

  const dailyRows = useMemo(() => {
    const m = new Map<string, { date: string; transactions: number; employees: Set<string>; amount: number; addon: number; meals: Record<MealType, number> }>();
    for (const t of active) {
      let r = m.get(t.date);
      if (!r) {
        r = { date: t.date, transactions: 0, employees: new Set<string>(), amount: 0, addon: 0, meals: { breakfast: 0, lunch: 0, snacks: 0, dinner: 0 } };
        m.set(t.date, r);
      }
      r.transactions += 1;
      r.employees.add(t.serial);
      r.amount += t.amount;
      r.addon += t.addonAmount;
      r.meals[t.meal] += 1;
    }
    return [...m.values()].sort((a, b) => b.date.localeCompare(a.date));
  }, [active]);

  const monthlyRows = useMemo(() => {
    const m = new Map<string, { month: string; transactions: number; employees: Set<string>; amount: number }>();
    for (const t of active) {
      const month = t.date.slice(0, 7);
      let r = m.get(month);
      if (!r) {
        r = { month, transactions: 0, employees: new Set<string>(), amount: 0 };
        m.set(month, r);
      }
      r.transactions += 1;
      r.employees.add(t.serial);
      r.amount += t.amount;
    }
    return [...m.values()].sort((a, b) => b.month.localeCompare(a.month));
  }, [active]);

  const employeeRows = useMemo(() => {
    // Online orders are not part of DailyEntry meal columns — count them
    // straight from the transactions, then merge with the day aggregation.
    const online = new Map<string, { count: number; amount: number }>();
    for (const t of active) {
      if (t.mode !== 'order') continue;
      const o = online.get(t.serial) ?? { count: 0, amount: 0 };
      o.count += 1;
      o.amount += t.amount;
      online.set(t.serial, o);
    }
    return aggregateDailyEntries(active)
      .reduce((rows, e) => {
        const existing = rows.find((r) => r.serial === e.serial);
        if (existing) {
          existing.transactions += 1;
          existing.total += e.total;
          existing.breakfast += e.breakfast > 0 ? 1 : 0;
          existing.snacks += e.snacks > 0 ? 1 : 0;
          existing.lunch += e.lunch > 0 ? 1 : 0;
          existing.dinner += e.dinner > 0 ? 1 : 0;
        } else {
          rows.push({
            serial: e.serial, employeeNo: e.employeeNo, name: e.name, department: e.department,
            transactions: 1, total: e.total,
            breakfast: e.breakfast > 0 ? 1 : 0, snacks: e.snacks > 0 ? 1 : 0,
            lunch: e.lunch > 0 ? 1 : 0, dinner: e.dinner > 0 ? 1 : 0,
          });
        }
        return rows;
      }, [] as { serial: string; employeeNo: string; name: string; department: string; transactions: number; total: number; breakfast: number; snacks: number; lunch: number; dinner: number; onlineOrders?: number }[])
      .map((r) => ({ ...r, onlineOrders: online.get(r.serial)?.count ?? 0 }))
      .sort((a, b) => a.serial.localeCompare(b.serial, undefined, { numeric: true }));
  }, [active]);

  const departmentRows = useMemo(() => {
    const m = new Map<string, { department: string; transactions: number; employees: Set<string>; amount: number }>();
    for (const t of active) {
      const key = t.department || '—';
      let r = m.get(key);
      if (!r) {
        r = { department: key, transactions: 0, employees: new Set<string>(), amount: 0 };
        m.set(key, r);
      }
      r.transactions += 1;
      r.employees.add(t.serial);
      r.amount += t.amount;
    }
    return [...m.values()].sort((a, b) => b.amount - a.amount);
  }, [active]);

  const mealRows = useMemo(() => MEALS.map((meal) => {
    const rows = active.filter((t) => t.meal === meal);
    return {
      meal,
      transactions: rows.length,
      employees: new Set(rows.map((t) => t.serial)).size,
      mealAmount: rows.reduce((s, t) => s + t.mealAmount, 0),
      addonAmount: rows.reduce((s, t) => s + t.addonAmount, 0),
      amount: rows.reduce((s, t) => s + t.amount, 0),
    };
  }), [active]);

  return (
    <div className="page">
      <div className="page-head">
        <h1>History</h1>
        <button
          type="button"
          className="btn-primary"
          disabled={active.length === 0}
          onClick={() => downloadCsv(`report_${from}_to_${to}.csv`, tab === 'employee' ? dailyEntriesToCsv(aggregateDailyEntries(active)) : transactionsToCsv(active))}
        >
          Export CSV
        </button>
      </div>

      <section className="panel">
        <div className="filter-row">
          <div className="date-pair">
            <label>From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label>To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          </div>
          <div className="chip-row">
            {TABS.map((t) => (
              <button key={t.id} type="button" className={`chip ${tab === t.id ? 'chip-active' : ''}`} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {loading && active.length === 0 && <div className="banner banner-info">Calculating report…</div>}

        <div className="summary-line">
          {grand.count} transactions · {grand.employees} employees · Additional {formatCurrency(grand.addon)} · <strong>Total {formatCurrency(grand.amount)}</strong>
        </div>

        {tab === 'daily' && (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Date</th><th>Transactions</th><th>Employees</th>{MEALS.map((m) => <th key={m}>{MEAL_LABELS[m]}</th>)}<th>Additional ₹</th><th className="num">Total ₹</th></tr></thead>
              <tbody>
                {dailyRows.map((r) => (
                  <tr key={r.date}>
                    <td>{r.date}</td>
                    <td>{r.transactions}</td>
                    <td>{r.employees.size}</td>
                    {MEALS.map((m) => <td key={m}>{r.meals[m]}</td>)}
                    <td>{formatCurrency(r.addon)}</td>
                    <td className="num"><strong>{formatCurrency(r.amount)}</strong></td>
                  </tr>
                ))}
                {dailyRows.length === 0 && !loading && <tr><td colSpan={9} className="empty-row">No data in this range.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'monthly' && (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Month</th><th>Transactions</th><th>Employees</th><th className="num">Total ₹</th></tr></thead>
              <tbody>
                {monthlyRows.map((r) => (
                  <tr key={r.month}>
                    <td>{r.month}</td>
                    <td>{r.transactions}</td>
                    <td>{r.employees.size}</td>
                    <td className="num"><strong>{formatCurrency(r.amount)}</strong></td>
                  </tr>
                ))}
                {monthlyRows.length === 0 && !loading && <tr><td colSpan={4} className="empty-row">No data in this range.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'employee' && (
          <>
            <div className="filter-row">
              <input
                className="search-input"
                placeholder="Search employee by serial / name / department…"
                value={empSearch}
                onChange={(e) => setEmpSearch(e.target.value)}
              />
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Serial</th><th>Emp No</th><th>Name</th><th>Department</th><th>Visits</th><th className="num">Breakfast days</th><th className="num">Snacks days</th><th className="num">Lunch days</th><th className="num">Dinner days</th><th className="num">Online orders</th><th className="num">Total ₹</th></tr></thead>
                <tbody>
                  {employeeRows
                    .filter((r) => {
                      const q = empSearch.trim().toLowerCase();
                      if (!q) return true;
                      return (
                        r.serial.toLowerCase().includes(q) ||
                        r.employeeNo.toLowerCase().includes(q) ||
                        (r.name || '').toLowerCase().includes(q) ||
                        (r.department || '').toLowerCase().includes(q)
                      );
                    })
                    .map((r) => (
                      <tr key={r.serial}>
                        <td className="mono">{r.serial}</td>
                        <td className="mono">{r.employeeNo || '—'}</td>
                        <td>{r.name || '—'}</td>
                        <td>{r.department || '—'}</td>
                        <td>{r.transactions}</td>
                        <td className="num">{r.breakfast}</td>
                        <td className="num">{r.snacks}</td>
                        <td className="num">{r.lunch}</td>
                        <td className="num">{r.dinner}</td>
                        <td className="num">{r.onlineOrders}</td>
                        <td className="num"><strong>{formatCurrency(r.total)}</strong></td>
                      </tr>
                    ))}
                  {employeeRows.length === 0 && !loading && <tr><td colSpan={11} className="empty-row">No data in this range.</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === 'department' && (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Department</th><th>Transactions</th><th>Employees</th><th className="num">Total ₹</th></tr></thead>
              <tbody>
                {departmentRows.map((r) => (
                  <tr key={r.department}>
                    <td>{r.department}</td>
                    <td>{r.transactions}</td>
                    <td>{r.employees.size}</td>
                    <td className="num"><strong>{formatCurrency(r.amount)}</strong></td>
                  </tr>
                ))}
                {departmentRows.length === 0 && !loading && <tr><td colSpan={4} className="empty-row">No data in this range.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'meal' && (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Meal</th><th>Transactions</th><th>Unique Employees</th><th className="num">Meal ₹</th><th className="num">Additional ₹</th><th className="num">Total ₹</th></tr></thead>
              <tbody>
                {mealRows.map((r) => (
                  <tr key={r.meal}>
                    <td>{MEAL_LABELS[r.meal]}</td>
                    <td>{r.transactions}</td>
                    <td>{r.employees}</td>
                    <td className="num">{formatCurrency(r.mealAmount)}</td>
                    <td className="num">{formatCurrency(r.addonAmount)}</td>
                    <td className="num"><strong>{formatCurrency(r.amount)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
