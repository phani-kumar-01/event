import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { useAuth } from './state/AuthContext';
import LoginPage from './pages/LoginPage';
import AdminPage from './pages/AdminPage';

function AdminHome() {
  const { user, logout } = useAuth();

  if (!user) return <LoginPage adminOnly />;
  if (user.role !== 'ADMIN') {
    return (
      <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
        <h1>Admin access required</h1>
        <p>This portal is only for administrators.</p>
        <button onClick={logout}>Return to admin login</button>
      </main>
    );
  }
  return <AdminPage />;
}

export default function AdminApp() {
  return <BrowserRouter><AdminHome /></BrowserRouter>;
}
