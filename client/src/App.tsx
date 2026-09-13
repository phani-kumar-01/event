import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './state/AuthContext';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const DebuggingPage = lazy(() => import('./pages/DebuggingPage'));
const QuizPage = lazy(() => import('./pages/QuizPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const WaitingPage = lazy(() => import('./pages/WaitingPage'));

function PageLoader() {
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
        fontSize: '0.95rem',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            width: '28px',
            height: '28px',
            border: '3px solid rgba(255,255,255,0.1)',
            borderTopColor: '#00e5ff',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
            margin: '0 auto 0.75rem auto',
          }}
        />
        <span>Loading portal...</span>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== 'ADMIN') return <Navigate to="/" replace />;
  return <>{children}</>;
}

function HomeRedirect() {
  const { user } = useAuth();
  if (!user) return <LoginPage />;
  if (user.role === 'ADMIN') return <Navigate to="/admin" replace />;
  return <Navigate to="/waiting" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            <Suspense fallback={<PageLoader />}>
              <HomeRedirect />
            </Suspense>
          }
        />
        <Route
          path="/debugging"
          element={
            <RequireAuth>
              <Suspense fallback={<PageLoader />}>
                <DebuggingPage />
              </Suspense>
            </RequireAuth>
          }
        />
        <Route
          path="/quiz"
          element={
            <RequireAuth>
              <Suspense fallback={<PageLoader />}>
                <QuizPage />
              </Suspense>
            </RequireAuth>
          }
        />
        <Route
          path="/admin"
          element={
            <RequireAdmin>
              <Suspense fallback={<PageLoader />}>
                <AdminPage />
              </Suspense>
            </RequireAdmin>
          }
        />
        <Route
          path="/waiting"
          element={
            <RequireAuth>
              <Suspense fallback={<PageLoader />}>
                <WaitingPage />
              </Suspense>
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
