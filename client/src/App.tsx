import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './state/AuthContext';
import LoginPage from './pages/LoginPage';
import DebuggingPage from './pages/DebuggingPage';
import QuizPage from './pages/QuizPage';
import AdminPage from './pages/AdminPage';
import WaitingPage from './pages/WaitingPage';

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
        <Route path="/" element={<HomeRedirect />} />
        <Route
          path="/debugging"
          element={<RequireAuth><DebuggingPage /></RequireAuth>}
        />
        <Route
          path="/quiz"
          element={<RequireAuth><QuizPage /></RequireAuth>}
        />
        <Route
          path="/admin"
          element={<RequireAdmin><AdminPage /></RequireAdmin>}
        />
        <Route
          path="/waiting"
          element={<RequireAuth><WaitingPage /></RequireAuth>}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
