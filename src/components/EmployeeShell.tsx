import { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useEmployeeSession } from '../hooks/useEmployeeSession';
import { useSettings } from '../hooks/useSettings';
import { formatDisplayDate, todayDateString } from '../utils/format';

/**
 * App-style shell for all employee pages:
 *  - the logged-in employee's name + serial always shown at the top,
 *  - logout hidden inside the profile menu (not front and center),
 *  - bottom navigation: Home · Scan · Order.
 */
export default function EmployeeShell({ children }: { children: React.ReactNode }): JSX.Element {
  const { employee, logout } = useEmployeeSession();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  async function handleLogout(): Promise<void> {
    await logout();
    navigate('/user-ordering');
  }

  const initial = (employee?.name || '?').slice(0, 1).toUpperCase();

  return (
    <div className="eshell">
      <header className="eshell-top">
        <div className="eshell-brand" onClick={() => navigate('/user-ordering')}>
          <span className="eshell-logo" aria-hidden>🍽</span>
          <span className="eshell-canteen">{settings.canteenName || 'Canteen'}</span>
        </div>
        <div className="eshell-profile" ref={menuRef}>
          <button
            type="button"
            className="eshell-avatar-btn"
            onClick={() => (employee ? setMenuOpen((v) => !v) : navigate('/user-ordering'))}
          >
            <span className="eshell-avatar" aria-hidden>{initial}</span>
            <span className="eshell-who">
              <strong>{employee?.name || 'Sign in'}</strong>
              <small>{employee ? `Serial ${employee.serial}` : 'Tap to continue'}</small>
            </span>
            <svg className={`eshell-caret ${menuOpen ? 'up' : ''}`} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {menuOpen && (
            <div className="eshell-menu" role="menu">
              <div className="eshell-menu-head">
                <div className="eshell-menu-name">{employee?.name || 'Employee'}</div>
                <div className="eshell-menu-meta">
                  Serial {employee?.serial}
                  {employee?.employeeNo ? ` · ${employee.employeeNo}` : ''}
                  {employee?.department ? ` · ${employee.department}` : ''}
                </div>
              </div>
              <button type="button" className="eshell-menu-item danger" onClick={() => void handleLogout()}>
                Log out
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="eshell-body">{children}</main>

      <p className="eshell-date">{formatDisplayDate(todayDateString())}</p>

      <nav className="eshell-nav">
        <NavLink to="/user-ordering" end className={({ isActive }) => `eshell-nav-btn ${isActive ? 'on' : ''}`}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></svg>
          <span>Home</span>
        </NavLink>
        <NavLink to="/scan" className={({ isActive }) => `eshell-nav-btn ${isActive ? 'on' : ''}`}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" /><line x1="3" y1="12" x2="21" y2="12" /></svg>
          <span>Scan</span>
        </NavLink>
        <NavLink to="/order" className={({ isActive }) => `eshell-nav-btn ${isActive ? 'on' : ''}`}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2 4 6v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6l-2-4z" /><line x1="4" y1="6" x2="20" y2="6" /><path d="M16 10a4 4 0 0 1-8 0" /></svg>
          <span>Order</span>
        </NavLink>
      </nav>
    </div>
  );
}
