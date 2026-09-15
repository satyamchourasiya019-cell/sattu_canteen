import { useMemo, useState } from 'react';
import { useEmployeeList } from '../../hooks/useEmployees';
import { bulkCreateSerials, deleteEmployee, resetEmployeeLogin, saveEmployee, validateSerialInput } from '../../services/employeeService';
import { employeesToCsv, downloadCsv } from '../../utils/csv';
import { friendlyMessage } from '../../utils/errors';
import type { Employee } from '../../types';

type FormState = { serial: string; employeeNo: string; name: string; department: string; phone: string; active: boolean };
const EMPTY_FORM: FormState = { serial: '', employeeNo: '', name: '', department: '', phone: '', active: true };

export default function EmployeesPage(): JSX.Element {
  const { employees, loading, error } = useEmployeeList();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<FormState | null>(null);
  const [editingSerial, setEditingSerial] = useState<string | null>(null); // null = new
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [bulkCount, setBulkCount] = useState('500');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(
      (e) =>
        e.serial.toLowerCase().includes(q) ||
        e.employeeNo.toLowerCase().includes(q) ||
        e.name.toLowerCase().includes(q) ||
        e.department.toLowerCase().includes(q),
    );
  }, [employees, search]);

  function openNew(): void {
    setEditing({ ...EMPTY_FORM });
    setEditingSerial(null);
    setFormError(null);
  }

  function openEdit(e: Employee): void {
    setEditing({ serial: e.serial, employeeNo: e.employeeNo, name: e.name, department: e.department, phone: e.phone || '', active: e.active });
    setEditingSerial(e.serial);
    setFormError(null);
  }

  async function handleSave(): Promise<void> {
    if (!editing || busy) return;
    const serial = validateSerialInput(editing.serial);
    if (!serial) {
      setFormError('Enter a valid serial number (letters, numbers, dashes — max 20 chars).');
      return;
    }
    if (!editing.name.trim()) {
      setFormError('Name is required.');
      return;
    }
    setBusy(true);
    setFormError(null);
    setMessage(null);
    try {
      await saveEmployee(serial, {
        employeeNo: editing.employeeNo.trim(),
        name: editing.name.trim(),
        department: editing.department.trim(),
        phone: editing.phone.trim(),
        active: editing.active,
      });
      setMessage(editingSerial ? `Serial ${serial} updated.` : `Serial ${serial} added.`);
      setEditing(null);
    } catch (err) {
      setFormError(friendlyMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleActive(e: Employee): Promise<void> {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await saveEmployee(e.serial, { active: !e.active });
      setMessage(`Serial ${e.serial} ${e.active ? 'deactivated' : 'activated'}.`);
    } catch (err) {
      setFormError(friendlyMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(e: Employee): Promise<void> {
    if (busy) return;
    if (!window.confirm(`Delete serial ${e.serial} (${e.name || 'unnamed'})? Historical transactions keep their own copies of the data.`)) return;
    setBusy(true);
    setMessage(null);
    try {
      await deleteEmployee(e.serial);
      setMessage(`Serial ${e.serial} deleted.`);
    } catch (err) {
      setFormError(friendlyMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleResetLogin(e: Employee): Promise<void> {
    if (busy) return;
    if (!window.confirm(`Reset login for serial ${e.serial} (${e.name || 'unnamed'})? Their phone will be logged out and the serial becomes free for a new login.`)) return;
    setBusy(true);
    setMessage(null);
    try {
      await resetEmployeeLogin(e.serial);
      setMessage(`Login reset for serial ${e.serial} — the employee can log in again from any phone.`);
    } catch (err) {
      setFormError(friendlyMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleBulk(): Promise<void> {
    if (busy) return;
    const count = Math.floor(Number(bulkCount));
    if (!Number.isFinite(count) || count < 1 || count > 2000) {
      setFormError('Enter a count between 1 and 2000.');
      return;
    }
    setBusy(true);
    setFormError(null);
    setMessage(null);
    try {
      const added = await bulkCreateSerials(count);
      setMessage(`${added} serial number(s) created (1…${count}). Existing serials were not touched.`);
    } catch (err) {
      setFormError(friendlyMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Employees</h1>
        <div className="btn-row">
          <button type="button" className="btn-ghost" onClick={() => downloadCsv('employees.csv', employeesToCsv(employees))}>
            Export CSV
          </button>
          <button type="button" className="btn-primary" onClick={openNew}>Add Employee</button>
        </div>
      </div>

      {error && <div className="banner banner-error">{error}</div>}
      {message && <div className="banner banner-ok">{message}</div>}
      {formError && !editing && <div className="banner banner-error">{formError}</div>}
      {loading && employees.length === 0 && <div className="banner banner-info">Loading employees…</div>}

      <section className="panel">
        <div className="panel-head">
          <h2 className="section-title">{filtered.length} of {employees.length} employee(s)</h2>
          <div className="filter-row">
            <input
              className="search-input"
              placeholder="Search serial / emp no / name / dept…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="bulk-box">
              <label className="small">Create serials 1…N</label>
              <input
                type="number"
                min={1}
                max={2000}
                value={bulkCount}
                onChange={(e) => setBulkCount(e.target.value)}
                style={{ width: 90 }}
              />
              <button type="button" className="btn-ghost small" disabled={busy} onClick={handleBulk}>Create</button>
            </div>
          </div>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Serial</th>
                <th>Employee No</th>
                <th>Name</th>
                <th>Department</th>
                <th>Phone</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && !loading && (
                <tr><td colSpan={7} className="empty-row">No employees yet. Add one or create serials in bulk.</td></tr>
              )}
              {filtered.map((e) => (
                <tr key={e.serial} className={e.active ? '' : 'row-inactive'}>
                  <td className="mono">{e.serial}</td>
                  <td className="mono">{e.employeeNo || '—'}</td>
                  <td>{e.name || <span className="muted">unclaimed</span>}</td>
                  <td>{e.department || '—'}</td>
                  <td className="mono">{e.phone || '—'}</td>
                  <td>
                    <span className={`mode-chip ${e.active ? 'mode-qr' : 'mode-manual'}`}>{e.active ? 'Active' : 'Inactive'}</span>
                    {e.loggedIn && <span className="mode-chip mode-login">Logged in</span>}
                  </td>
                  <td>
                    <div className="btn-row">
                      <button type="button" className="btn-ghost small" onClick={() => openEdit(e)}>Edit</button>
                      {e.loggedIn && (
                        <button type="button" className="btn-ghost small" disabled={busy} onClick={() => void handleResetLogin(e)}>
                          Reset Login
                        </button>
                      )}
                      <button type="button" className="btn-ghost small" disabled={busy} onClick={() => void handleToggleActive(e)}>
                        {e.active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button type="button" className="btn-danger small" disabled={busy} onClick={() => void handleDelete(e)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {editing && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <h3>{editingSerial ? `Edit Serial ${editingSerial}` : 'Add Employee'}</h3>
            <label className="field-label" htmlFor="emp-serial">
              Serial Number *
              <input
                id="emp-serial"
                value={editing.serial}
                maxLength={20}
                disabled={Boolean(editingSerial)}
                onChange={(ev) => setEditing({ ...editing, serial: ev.target.value })}
              />
            </label>
            <label className="field-label" htmlFor="emp-no">
              Employee Number
              <input
                id="emp-no"
                value={editing.employeeNo}
                maxLength={20}
                onChange={(ev) => setEditing({ ...editing, employeeNo: ev.target.value })}
              />
            </label>
            <label className="field-label" htmlFor="emp-name">
              Name *
              <input
                id="emp-name"
                value={editing.name}
                maxLength={60}
                onChange={(ev) => setEditing({ ...editing, name: ev.target.value })}
              />
            </label>
            <label className="field-label" htmlFor="emp-dept">
              Department
              <input
                id="emp-dept"
                value={editing.department}
                maxLength={40}
                onChange={(ev) => setEditing({ ...editing, department: ev.target.value })}
              />
            </label>
            <label className="field-label" htmlFor="emp-phone">
              Phone Number
              <input
                id="emp-phone"
                type="tel"
                value={editing.phone}
                maxLength={20}
                onChange={(ev) => setEditing({ ...editing, phone: ev.target.value })}
              />
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={editing.active}
                onChange={(ev) => setEditing({ ...editing, active: ev.target.checked })}
              />
              Active (employee can scan)
            </label>

            {formError && <div className="banner banner-error">{formError}</div>}

            <div className="btn-row">
              <button type="button" className="btn-primary" disabled={busy} onClick={handleSave}>
                {busy ? 'Saving…' : 'Save'}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
