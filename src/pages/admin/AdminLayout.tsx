import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAdminAuth } from '../../hooks/useAdminAuth';
import { adminSignOut } from '../../services/authService';

const NAV = [
  { to: '/admin', label: 'Dashboard', end: true },
  { to: '/admin/serials', label: 'Serial Numbers' },
  { to: '/admin/transactions', label: 'Transactions' },
  { to: '/admin/employees', label: 'Employees' },
  { to: '/admin/meals', label: 'Meals & Items' },
  { to: '/admin/reports', label: 'Reports' },
  { to: '/admin/settings', label: 'Settings' },
];

export default function AdminLayout(): JSX.Element {
  const { admin } = useAdminAuth();
  const navigate = useNavigate();

  async function handleSignOut(): Promise<void> {
    await adminSignOut();
    navigate('/admin/login');
  }

  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">🍽 CANTEEN</div>
        <nav>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          {admin && (
            <>
              <div className="sidebar-user">{admin.email}</div>
              <div className="sidebar-role">{admin.role}</div>
              <button type="button" className="btn-ghost small" onClick={handleSignOut}>Sign Out</button>
            </>
          )}
        </div>
      </aside>
      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}
