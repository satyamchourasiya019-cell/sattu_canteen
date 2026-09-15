import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiSetOrderStatus } from '../../services/api';
import { useTransactionsByDate } from '../../hooks/useTransactions';
import { useSettings } from '../../hooks/useSettings';
import { formatCurrency, formatTime12h, todayDateString } from '../../utils/format';
import { MEAL_LABELS, MEALS, type MealType, type Transaction } from '../../types';

const ORDER_STATUS_LABELS: Record<string, string> = { new: 'New', preparing: 'Preparing', done: 'Done' };

function alarmBell(when: number): void {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    for (const offset of [0, 0.35, 0.7]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + offset + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.32);
    }
    setTimeout(() => void ctx.close(), 1500);
  } catch {
    /* autoplay blocked until first interaction — notifications still show */
  }
  void when;
}

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
  const seenOrders = useRef<Set<string>>(new Set());
  const firstLoad = useRef(true);

  const orders = useMemo(
    () =>
      txns
        .filter((t) => t.mode === 'order' && t.status !== 'cancelled')
        .sort((a, b) => b.createdAt - a.createdAt),
    [txns],
  );
  const pendingOrders = useMemo(() => orders.filter((o) => o.orderStatus !== 'done'), [orders]);

  // Alarm + desktop notification whenever a NEW online order arrives.
  useEffect(() => {
    if (firstLoad.current) {
      for (const o of orders) seenOrders.current.add(o.id);
      firstLoad.current = false;
      return;
    }
    const fresh = orders.filter((o) => !seenOrders.current.has(o.id) && o.orderStatus === 'new');
    if (fresh.length > 0) {
      for (const o of fresh) {
        seenOrders.current.add(o.id);
        try {
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('🔔 New food order!', {
              body: `${o.name || `Serial ${o.serial}`} — ${formatCurrency(o.amount)} · ${o.addons.map((a) => `${a.name}×${a.qty ?? 1}`).join(', ')}`,
            });
          }
        } catch {
          /* ignore */
        }
      }
      alarmBell(fresh.length);
    } else {
      for (const o of orders) seenOrders.current.add(o.id);
    }
  }, [orders]);

  // Ask for notification permission once, on first dashboard interaction.
  useEffect(() => {
    const ask = (): void => {
      if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission();
      window.removeEventListener('pointerdown', ask);
      window.removeEventListener('keydown', ask);
    };
    window.addEventListener('pointerdown', ask);
    window.addEventListener('keydown', ask);
    return () => {
      window.removeEventListener('pointerdown', ask);
      window.removeEventListener('keydown', ask);
    };
  }, []);

  async function setOrder(id: string, action: 'preparing' | 'done'): Promise<void> {
    try {
      await apiSetOrderStatus(id, action);
    } catch {
      /* the live poll will re-fetch the true state */
    }
  }

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

      <section className="panel orders-panel" data-test="live-orders">
        <div className="panel-head">
          <h2 className="section-title">🔴 Live Food Orders {pendingOrders.length > 0 && <span className="orders-badge">{pendingOrders.length}</span>}</h2>
          <span className="muted small">Alarm + notification on every new order</span>
        </div>
        {orders.length === 0 ? (
          <p className="muted small pad-h">No online orders yet today. They appear here instantly with an alarm.</p>
        ) : (
          <div className="orders-list">
            {orders.map((o) => (
              <div className={`order-card-live status-${o.orderStatus ?? 'done'}`} key={o.id}>
                <div className="order-live-main">
                  <div className="order-live-name">
                    {o.name || `Serial ${o.serial}`} <span className="mono">#{o.serial}</span>
                    {o.department ? <span className="muted small"> · {o.department}</span> : null}
                  </div>
                  <div className="order-live-items">
                    {o.addons.map((a) => `${a.name}×${a.qty ?? 1}`).join(', ')}
                  </div>
                  {o.orderNote ? <div className="order-live-note">“{o.orderNote}”</div> : null}
                </div>
                <div className="order-live-side">
                  <span className="order-live-amount">{formatCurrency(o.amount)}</span>
                  <span className={`order-status-chip st-${o.orderStatus ?? 'done'}`}>{ORDER_STATUS_LABELS[o.orderStatus ?? 'done']}</span>
                  <span className="muted small">{formatTime12h(o.time)}</span>
                  <div className="btn-row">
                    {o.orderStatus === 'new' && (
                      <button type="button" className="btn-ghost small" onClick={() => void setOrder(o.id, 'preparing')}>
                        Preparing
                      </button>
                    )}
                    {o.orderStatus !== 'done' && (
                      <button type="button" className="btn-primary small" onClick={() => void setOrder(o.id, 'done')}>
                        Done ✓
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

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
          <Link className="btn-ghost small" to="/admin/transactions">Open Payments →</Link>
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
                  <td>{t.mode === 'order' ? 'Online order' : MEAL_LABELS[t.meal]}{t.mode === 'addon' ? ' (extra)' : ''}</td>
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
