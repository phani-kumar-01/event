import React from 'react';
import ReactDOM from 'react-dom/client';
import AdminApp from './AdminApp';
import { AuthProvider } from './state/AuthContext';
import { ThemeProvider } from './state/ThemeContext';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <ThemeProvider>
        <AdminApp />
      </ThemeProvider>
    </AuthProvider>
  </React.StrictMode>
);
