import React from 'react';
import ReactDOM from 'react-dom/client';
import AdminApp from '../src/AdminApp';
import { AuthProvider } from '../src/state/AuthContext';
import '../src/styles/global.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <AdminApp />
    </AuthProvider>
  </React.StrictMode>
);
