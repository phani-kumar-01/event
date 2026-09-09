import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import api from '../services/api';
import styles from './LoginPage.module.css';

export default function LoginPage({ adminOnly = false }: { adminOnly?: boolean }) {
  const { login, logout } = useAuth();
  const navigate = useNavigate();

  const [rollNo, setRollNo] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await api.post<{
        token: string;
        user: { id: string; rollNo: string; name: string; role: 'ADMIN' | 'STUDENT' };
      }>('/auth/login', { rollNo: rollNo.trim().toUpperCase(), password });

      if (adminOnly && res.data.user.role !== 'ADMIN') {
        logout();
        setError('This login is for administrators only.');
        return;
      }

      login(res.data.token, res.data.user);

      if (res.data.user.role === 'ADMIN') {
        navigate('/admin');
      } else {
        // Determine current event from server
        const eventRes = await api.get<{
          event: { type: string; id: string } | null;
        }>('/current-event', {
          headers: { Authorization: `Bearer ${res.data.token}` },
        });

        const event = eventRes.data.event;
        if (!event) {
          navigate('/waiting');
        } else if (event.type === 'DEBUGGING') {
          navigate('/debugging');
        } else {
          navigate('/quiz');
        }
      }
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Login failed. Please check your credentials.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.header}>
          <h1 className={styles.title}>SASI Engineers' Day</h1>
          <p className={styles.subtitle}>{adminOnly ? 'Administrator Portal' : 'Competition Portal'}</p>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          {error && <div className={styles.error}>{error}</div>}

          <div className={styles.field}>
            <label htmlFor="rollNo" className={styles.label}>
              Roll Number
            </label>
            <input
              id="rollNo"
              type="text"
              className={styles.input}
              value={rollNo}
              onChange={(e) => setRollNo(e.target.value)}
              placeholder="e.g. CS001"
              required
              autoFocus
              autoCapitalize="characters"
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="password" className={styles.label}>
              Password
            </label>
            <input
              id="password"
              type="password"
              className={styles.input}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              required
            />
          </div>

          <button type="submit" className={styles.btn} disabled={loading}>
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  );
}
