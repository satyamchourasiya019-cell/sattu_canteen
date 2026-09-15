import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import EmployeeShell from '../../components/EmployeeShell';
import { useEmployeeSession } from '../../hooks/useEmployeeSession';
import { apiGetMyOrder, apiPlaceOrder, apiPublicMenu } from '../../services/api';
import { ApiError } from '../../services/api';
import { friendlyMessage } from '../../utils/errors';
import { formatCurrency } from '../../utils/format';
import type { MealItem, Transaction } from '../../types';

/**
 * Online food ordering. The employee picks items from the canteen menu with
 * quantities; the order lands on the admin laptop live (with alarm) and the
 * amount is added to their serial's day/month billing automatically.
 * Re-ordering the same day merges into the same open order.
 */
export default function OrderPage(): JSX.Element {
  return (
    <EmployeeShell>
      <OrderBody />
    </EmployeeShell>
  );
}

function OrderBody(): JSX.Element {
  const { employee } = useEmployeeSession();
  const navigate = useNavigate();
  const [menu, setMenu] = useState<MealItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ added: number; extended: boolean } | null>(null);
  const [openOrder, setOpenOrder] = useState<Transaction | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [items, mine] = await Promise.all([apiPublicMenu(), apiGetMyOrder()]);
        if (!alive) return;
        setMenu(items);
        setOpenOrder(mine.mine);
        setLoading(false);
      } catch (err) {
        if (!alive) return;
        setError(friendlyMessage(err));
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const lines = useMemo(
    () =>
      menu
        .filter((i) => (qty[i.id] ?? 0) > 0)
        .map((i) => ({ id: i.id, name: i.name, price: i.price, qty: qty[i.id] })),
    [menu, qty],
  );
  const total = lines.reduce((s, l) => s + l.price * l.qty, 0);

  function changeQty(id: string, delta: number): void {
    setQty((prev) => {
      const next = Math.min(10, Math.max(0, (prev[id] ?? 0) + delta));
      const copy = { ...prev };
      if (next === 0) delete copy[id];
      else copy[id] = next;
      return copy;
    });
  }

  async function placeOrder(): Promise<void> {
    if (submitting || lines.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiPlaceOrder(lines, note.trim() || undefined);
      setDone({ added: res.added, extended: res.extended });
      setQty({});
      setNote('');
      setOpenOrder(res.order);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'UNAUTHENTICATED') {
        navigate('/user-ordering');
        return;
      }
      setError(friendlyMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="center pad-lg">
        <div className="spinner" aria-hidden />
        <p className="muted">Loading menu…</p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="center pad-lg">
        <div className="success-icon big" aria-hidden>✓</div>
        <h2 className="order-again-title">{done.extended ? 'Items added to your order' : 'Order placed!'}</h2>
        <p className="muted">
          {formatCurrency(done.added)} {done.extended ? 'added to' : 'added to'} your serial {employee?.serial} account. The canteen has been notified.
        </p>
        {openOrder && (
          <div className="myorder-box">
            <div className="myorder-title">Your open order today</div>
            {openOrder.addons.map((a) => (
              <div className="myorder-line" key={a.id}>
                <span>{a.name} × {a.qty ?? 1}</span>
                <strong>{formatCurrency(a.price * (a.qty ?? 1))}</strong>
              </div>
            ))}
            <div className="myorder-line total">
              <span>Total</span>
              <strong>{formatCurrency(openOrder.amount)}</strong>
            </div>
          </div>
        )}
        <div className="btn-row center">
          <button type="button" className="btn-primary" onClick={() => setDone(null)}>Order more</button>
          <button type="button" className="btn-ghost" onClick={() => navigate('/user-ordering')}>Home</button>
        </div>
      </div>
    );
  }

  return (
    <div className="pad-lg">
      {openOrder && (
        <div className="banner banner-info slim">
          Open order today: <strong>{formatCurrency(openOrder.amount)}</strong> — ordering again adds to it.
        </div>
      )}
      {menu.length === 0 ? (
        <div className="center pad-lg">
          <p className="muted">No items on the menu yet. Please check again later.</p>
        </div>
      ) : (
        <div className="menu-list">
          {menu.map((item) => {
            const q = qty[item.id] ?? 0;
            return (
              <div className={`menu-row ${q > 0 ? 'picked' : ''}`} key={item.id}>
                <div className="menu-info">
                  <div className="menu-name">{item.name}</div>
                  <div className="menu-price">{formatCurrency(item.price)}</div>
                </div>
                {q === 0 ? (
                  <button type="button" className="menu-add" onClick={() => changeQty(item.id, 1)}>ADD +</button>
                ) : (
                  <div className="stepper">
                    <button type="button" onClick={() => changeQty(item.id, -1)} aria-label="less">−</button>
                    <span>{q}</span>
                    <button type="button" onClick={() => changeQty(item.id, 1)} aria-label="more">+</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <label className="field-label" htmlFor="order-note">
        Note for the canteen (optional)
        <input
          id="order-note"
          placeholder="e.g. less spicy"
          value={note}
          maxLength={140}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>

      <div className="order-footer">
        <div className="order-footer-total">
          <span>{lines.length ? `${lines.reduce((s, l) => s + l.qty, 0)} item(s)` : 'Total'}</span>
          <strong>{formatCurrency(total)}</strong>
        </div>
        <button type="button" className="btn-primary btn-block" disabled={submitting || lines.length === 0} onClick={() => void placeOrder()}>
          {submitting ? 'Placing order…' : lines.length === 0 ? 'Select items' : 'Place Order'}
        </button>
      </div>

      {error && <div className="banner banner-error">{error}</div>}
    </div>
  );
}
