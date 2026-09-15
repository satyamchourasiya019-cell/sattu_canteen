import { useMemo, useState } from 'react';
import { apiGetPayments, apiSavePayment, type PaymentRow } from '../../services/api';
import { downloadCsv } from '../../utils/csv';
import { friendlyMessage } from '../../utils/errors';
import { formatCurrency } from '../../utils/format';

/**
 * Month-end settlement. One row per serial: name + the month's total canteen
 * usage, with three payment options — Fully Paid / Partly Paid / Not Paid.
 * Whatever stays unpaid (partly or nothing) carries forward into the next
 * month's row automatically.
 */
export default function TransactionsPage(): JSX.Element {
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [month, setMonth] = useState(thisMonth);
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [busySerial, setBusySerial] = useState<string | null>(null);

  async function load(m: string): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGetPayments(m);
      setRows(res.rows);
    } catch (err) {
      setError(friendlyMessage(err));
    } finally {
      setLoading(false);
    }
  }

  // Reload on mount and whenever the month changes.
  useMemo(() => {
    void load(month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.serial.toLowerCase().includes(q) || r.name.toLowerCase().includes(q) || r.department.toLowerCase().includes(q),
    );
  }, [rows, search]);

  const totals = useMemo(
    () => ({
      billed: filtered.reduce((s, r) => s + r.billed, 0),
      paid: filtered.reduce((s, r) => s + r.paid, 0),
      carry: filtered.reduce((s, r) => s + r.carryIn, 0),
    }),
    [filtered],
  );

  async function setStatus(row: PaymentRow, status: 'fully' | 'partial' | 'none'): Promise<void> {
    if (busySerial) return;
    setBusySerial(row.serial);
    setMessage(null);
    setError(null);
    try {
      let paid: number | undefined;
      if (status === 'partial') {
        const answer = window.prompt(
          `Partly paid amount for ${row.name || `serial ${row.serial}`} (total due: ${formatCurrency(row.billed + row.carryIn)}):`,
          String(Math.floor((row.billed + row.carryIn) / 2)),
        );
        if (answer === null) {
          setBusySerial(null);
          return;
        }
        paid = Math.max(0, Math.round(Number(answer) || 0));
      }
      const remaining = Math.max(0, row.billed + row.carryIn - (paid ?? (status === 'fully' ? row.billed + row.carryIn : 0)));
      await apiSavePayment({ serial: row.serial, month, status, paid, remaining: status === 'fully' ? 0 : remaining });
      setMessage(
        status === 'fully'
          ? `Serial ${row.serial} marked Fully Paid.`
          : status === 'none'
            ? `Serial ${row.serial} marked Not Paid — ${formatCurrency(row.billed + row.carryIn)} will carry to next month.`
            : `Serial ${row.serial} partly paid ${formatCurrency(paid ?? 0)} — remaining carries to next month.`,
      );
      await load(month);
    } catch (err) {
      setError(friendlyMessage(err));
    } finally {
      setBusySerial(null);
    }
  }

  function shiftMonth(delta: number): void {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    setMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }

  function exportCsv(): void {
    const header = ['Serial', 'Name', 'Department', 'Billed', 'Carry In', 'Total Due', 'Paid', 'Status'];
    const lines = filtered.map((r) =>
      [r.serial, r.name, r.department, r.billed, r.carryIn, r.billed + r.carryIn, r.paid, r.status ?? '—'].join(','),
    );
    downloadCsv(`payments_${month}.csv`, [header.join(','), ...lines].join('\n'));
  }

  const statusChip = (r: PaymentRow): JSX.Element => {
    if (!r.status) return <span className="mode-chip mode-addon">Pending</span>;
    if (r.status === 'fully') return <span className="mode-chip mode-login">Fully Paid</span>;
    if (r.status === 'partial') return <span className="mode-chip mode-addon">Partly Paid</span>;
    return <span className="mode-chip mode-manual">Not Paid</span>;
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Monthly Payments</h1>
        <div className="btn-row">
          <button type="button" className="btn-ghost" onClick={exportCsv}>Export CSV</button>
        </div>
      </div>

      <div className="month-bar">
        <button type="button" className="btn-ghost small" onClick={() => shiftMonth(-1)}>← Prev</button>
        <strong className="month-label">{month}</strong>
        <button type="button" className="btn-ghost small" onClick={() => shiftMonth(1)}>Next →</button>
        <input
          className="search-input"
          placeholder="Search serial / name / dept…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {message && <div className="banner banner-ok">{message}</div>}
      {error && <div className="banner banner-error">{error}</div>}
      {loading && rows.length === 0 && <div className="banner banner-info">Loading payments…</div>}

      <section className="panel">
        <div className="panel-head">
          <h2 className="section-title">
            {filtered.length} employee(s) · Billed {formatCurrency(totals.billed)} · Paid {formatCurrency(totals.paid)}
            {totals.carry > 0 && <> · Carried from before {formatCurrency(totals.carry)}</>}
          </h2>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Serial</th>
                <th>Name</th>
                <th>Department</th>
                <th className="num">Month Bill</th>
                <th className="num">Carry In</th>
                <th className="num">Total Due</th>
                <th>Status</th>
                <th>Set Payment</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && !loading && (
                <tr><td colSpan={8} className="empty-row">No canteen usage for this month yet.</td></tr>
              )}
              {filtered.map((r) => {
                const due = r.billed + r.carryIn;
                const busy = busySerial === r.serial;
                return (
                  <tr key={r.serial}>
                    <td className="mono">{r.serial}</td>
                    <td>{r.name || <span className="muted">unnamed</span>}</td>
                    <td>{r.department || '—'}</td>
                    <td className="num">{formatCurrency(r.billed)}</td>
                    <td className="num">{r.carryIn ? formatCurrency(r.carryIn) : '—'}</td>
                    <td className="num"><strong>{formatCurrency(due)}</strong></td>
                    <td>{statusChip(r)}</td>
                    <td>
                      <div className="btn-row">
                        <button type="button" className="btn-primary small" disabled={busy} onClick={() => void setStatus(r, 'fully')}>
                          Fully Paid
                        </button>
                        <button type="button" className="btn-ghost small" disabled={busy} onClick={() => void setStatus(r, 'partial')}>
                          Partly Paid
                        </button>
                        <button type="button" className="btn-danger small" disabled={busy} onClick={() => void setStatus(r, 'none')}>
                          Not Paid
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <p className="muted small">
        Partly Paid or Not Paid amounts are added to next month's "Carry In" automatically until fully cleared.
      </p>
    </div>
  );
}
