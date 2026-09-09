import React from 'react';
import ReactDOM from 'react-dom/client';
import AdminApp from './AdminApp';
import { AuthProvider } from './state/AuthContext';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <AdminApp />
    </AuthProvider>
  </React.StrictMode>
);
