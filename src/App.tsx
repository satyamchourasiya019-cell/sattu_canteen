import { Navigate, Route, Routes } from 'react-router-dom';
import { BACKEND_MODE } from './firebase/config';
import { useAdminAuth } from './hooks/useAdminAuth';
import EmployeeHome from './pages/employee/EmployeeHome';
import ScanPage from './pages/employee/ScanPage';
import LoginPage from './pages/LoginPage';
import AdminLayout from './pages/admin/AdminLayout';
import DashboardPage from './pages/admin/DashboardPage';
import SerialsPage from './pages/admin/SerialsPage';
import TransactionsPage from './pages/admin/TransactionsPage';
import EmployeesPage from './pages/admin/EmployeesPage';
import MealsPage from './pages/admin/MealsPage';
import ReportsPage from './pages/admin/ReportsPage';
import SettingsPage from './pages/admin/SettingsPage';

/** Blocks /admin routes unless a valid admin/supervisor profile is signed in. */
function RequireAdmin({ children }: { children: JSX.Element }): JSX.Element | null {
  const { admin, loading } = useAdminAuth();
  if (loading) {
    return (
      <div className="boot-screen">
        <div className="spinner" aria-hidden />
        <p>Loading Dashboard…</p>
      </div>
    );
  }
  if (!admin) return <Navigate to="/admin/login" replace />;
  return children;
}

export default function App(): JSX.Element {
  // The demo banner only belongs to localhost development with the bundled
  // backend. The deployed cloud app (serverless API + Upstash) is fully real.
  const isLocalDev = BACKEND_MODE === 'local';
  return (
    <>
      {isLocalDev && (
        <div className="banner banner-info setup-banner">
          <strong>Local demo mode</strong> — data is stored on this machine (data/db.json), everything works
          including realtime. For production, add the VITE_FIREBASE_* variables to <code>.env</code>
          (see <code>.env.example</code>) and the same app switches to Firebase.
        </div>
      )}
      <Routes>
        <Route path="/" element={<Navigate to="/user-ordering" replace />} />
        <Route path="/user-ordering" element={<EmployeeHome />} />
        <Route path="/qr/:qrType" element={<ScanPage />} />

        <Route path="/admin/login" element={<LoginPage />} />
        <Route
          path="/admin"
          element={
            <RequireAdmin>
              <AdminLayout />
            </RequireAdmin>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="serials" element={<SerialsPage />} />
          <Route path="transactions" element={<TransactionsPage />} />
          <Route path="employees" element={<EmployeesPage />} />
          <Route path="meals" element={<MealsPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/user-ordering" replace />} />
      </Routes>
    </>
  );
}
