import React from 'react';
import ReactDOM from 'react-dom/client';
import AdminApp from '../src/AdminApp';
import { AuthProvider } from '../src/state/AuthContext';
import { ThemeProvider } from '../src/state/ThemeContext';
import '../src/styles/global.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <ThemeProvider>
        <AdminApp />
      </ThemeProvider>
    </AuthProvider>
  </React.StrictMode>
);
