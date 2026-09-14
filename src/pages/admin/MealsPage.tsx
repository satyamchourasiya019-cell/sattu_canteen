import { useEffect, useState } from 'react';
import { useMealItems } from '../../hooks/useTransactions';
import { useSettings } from '../../hooks/useSettings';
import { createMealItem, deleteMealItem, saveMealItem } from '../../services/mealItemService';
import { saveSettings } from '../../services/settingsService';
import { friendlyMessage } from '../../utils/errors';
import { formatCurrency } from '../../utils/format';
import { MEAL_LABELS, MEALS, type MealItem, type MealTimings, type MealType } from '../../types';

/** Admin "Meals & Items": meal prices, time windows, and the addon menu. */
export default function MealsPage(): JSX.Element {
  const { items, loading, error } = useMealItems();
  const { settings } = useSettings();

  // meal prices (edited as local state, saved per row)
  const [priceDraft, setPriceDraft] = useState<Record<string, string>>({});
  const [timings, setTimings] = useState<MealTimings>(settings.mealTimings);
  const [savingTimings, setSavingTimings] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // new item form
  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => setTimings(settings.mealTimings), [settings.mealTimings]);

  function flash(msg: string): void {
    setMessage(msg);
    setFormError(null);
    window.setTimeout(() => setMessage(null), 4000);
  }

  async function handleSavePrice(id: string): Promise<void> {
    const price = Math.max(0, Math.round(Number(priceDraft[id])));
    if (!Number.isFinite(price)) return;
    const item = items.find((i) => i.id === id);
    if (!item) return;
    setBusy(true);
    try {
      await saveMealItem({ ...item, price });
      flash(`${item.name} price updated to ${formatCurrency(price)}.`);
      setPriceDraft((p) => ({ ...p, [id]: '' }));
    } catch (err) {
      setFormError(friendlyMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleToggle(item: MealItem): Promise<void> {
    setBusy(true);
    try {
      await saveMealItem({ ...item, enabled: !item.enabled });
      flash(`${item.name} ${item.enabled ? 'disabled' : 'enabled'}.`);
    } catch (err) {
      setFormError(friendlyMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(item: MealItem): Promise<void> {
    if (!window.confirm(`Delete item "${item.name}"? Past transactions keep their recorded copy.`)) return;
    setBusy(true);
    try {
      await deleteMealItem(item.id);
      flash(`${item.name} deleted.`);
    } catch (err) {
      setFormError(friendlyMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate(): Promise<void> {
    const name = newName.trim();
    const price = Math.max(0, Math.round(Number(newPrice)));
    if (!name) { setFormError('Item name is required.'); return; }
    if (!Number.isFinite(price)) { setFormError('Enter a valid price.'); return; }
    setBusy(true);
    try {
      await createMealItem({ name, price });
      setNewName('');
      setNewPrice('');
      flash(`Item "${name}" added.`);
    } catch (err) {
      setFormError(friendlyMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveTimings(): Promise<void> {
    setSavingTimings(true);
    setFormError(null);
    try {
      await saveSettings({ mealTimings: timings });
      flash('Meal timings saved. QR time detection uses these windows immediately.');
    } catch (err) {
      setFormError(friendlyMessage(err));
    } finally {
      setSavingTimings(false);
    }
  }

  function updateTime(meal: MealType, part: 'from' | 'to', value: string): void {
    setTimings((t) => ({ ...t, [meal]: { ...t[meal], [part]: value } }));
  }

  return (
    <div className="page">
      <div className="page-head"><h1>Meals & Items</h1></div>

      {error && <div className="banner banner-error">{error}</div>}
      {message && <div className="banner banner-ok">{message}</div>}
      {formError && <div className="banner banner-error">{formError}</div>}
      {loading && <div className="banner banner-info">Loading items…</div>}

      <section className="panel">
        <h2 className="section-title">Meal Timings (drives QR time detection)</h2>
        <p className="muted small">
          When an employee scans a QR, the system checks the current server time against these windows and
          records the matching meal automatically. Windows may cross midnight (e.g. Dinner 19:00 → 01:00).
        </p>
        <div className="timings-grid">
          {MEALS.map((m) => (
            <div className="timing-card" key={m}>
              <div className="timing-name">{MEAL_LABELS[m]}</div>
              <label className="small">From
                <input type="time" value={timings[m].from} onChange={(e) => updateTime(m, 'from', e.target.value)} />
              </label>
              <label className="small">To
                <input type="time" value={timings[m].to} onChange={(e) => updateTime(m, 'to', e.target.value)} />
              </label>
            </div>
          ))}
        </div>
        <button type="button" className="btn-primary" disabled={savingTimings} onClick={handleSaveTimings}>
          {savingTimings ? 'Saving…' : 'Save Timings'}
        </button>
      </section>

      <section className="panel">
        <h2 className="section-title">Additional / With Items Menu</h2>
        <p className="muted small">
          These items appear in the employee's dropdown after scanning: "Other" on the Breakfast/Snacks QR,
          "With" on the Lunch/Dinner QR. Price changes apply to future scans only.
        </p>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Item</th><th>Price</th><th>New Price</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className={i.enabled ? '' : 'row-inactive'}>
                  <td>{i.name}</td>
                  <td><strong>{formatCurrency(i.price)}</strong></td>
                  <td>
                    <div className="inline-edit">
                      <input
                        type="number"
                        min={0}
                        placeholder={String(i.price)}
                        value={priceDraft[i.id] ?? ''}
                        onChange={(e) => setPriceDraft((p) => ({ ...p, [i.id]: e.target.value }))}
                      />
                      <button
                        type="button"
                        className="btn-ghost small"
                        disabled={busy || priceDraft[i.id] === undefined || priceDraft[i.id] === ''}
                        onClick={() => void handleSavePrice(i.id)}
                      >
                        Update
                      </button>
                    </div>
                  </td>
                  <td><span className={`mode-chip ${i.enabled ? 'mode-qr' : 'mode-manual'}`}>{i.enabled ? 'Active' : 'Disabled'}</span></td>
                  <td>
                    <div className="btn-row">
                      <button type="button" className="btn-ghost small" disabled={busy} onClick={() => void handleToggle(i)}>
                        {i.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button type="button" className="btn-danger small" disabled={busy} onClick={() => void handleDelete(i)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {items.length === 0 && !loading && (
                <tr><td colSpan={5} className="empty-row">No items yet — add the first one below.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="filter-row" style={{ marginTop: 12 }}>
          <input
            placeholder="New item name (e.g. Soup)"
            value={newName}
            maxLength={40}
            onChange={(e) => setNewName(e.target.value)}
          />
          <input
            type="number"
            min={0}
            placeholder="Price ₹"
            style={{ width: 120 }}
            value={newPrice}
            onChange={(e) => setNewPrice(e.target.value)}
          />
          <button type="button" className="btn-primary" disabled={busy} onClick={handleCreate}>Add Item</button>
        </div>
      </section>
    </div>
  );
}
