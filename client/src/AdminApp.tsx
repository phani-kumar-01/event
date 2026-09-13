import React, { Suspense, lazy } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { useAuth } from './state/AuthContext';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));

function AdminPageLoader() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: '#0a0f1d',
        color: '#94a3b8',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            width: '28px',
            height: '28px',
            border: '3px solid rgba(255,255,255,0.1)',
            borderTopColor: '#f59e0b',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
            margin: '0 auto 0.75rem auto',
          }}
        />
        <span>Loading Admin Console...</span>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function AdminHome() {
  const { user, logout } = useAuth();

  if (!user) {
    return (
      <Suspense fallback={<AdminPageLoader />}>
        <LoginPage adminOnly />
      </Suspense>
    );
  }

  if (user.role !== 'ADMIN') {
    return (
      <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif', color: '#fff', background: '#0a0f1d', minHeight: '100vh' }}>
        <h1>Admin access required</h1>
        <p>This portal is restricted to authorized administrators.</p>
        <button onClick={logout} style={{ padding: '0.5rem 1rem', background: '#e11d48', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
          Return to admin login
        </button>
      </main>
    );
  }

  return (
    <Suspense fallback={<AdminPageLoader />}>
      <AdminPage />
    </Suspense>
  );
}

export default function AdminApp() {
  return (
    <BrowserRouter>
      <AdminHome />
    </BrowserRouter>
  );
}
