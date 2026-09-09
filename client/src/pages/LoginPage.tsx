import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import api from '../services/api';
import sasiLogo from '../assets/branding/sasi-logo.png';
import eliteLogo from '../assets/branding/elite-logo.jpg';
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
          locked?: boolean;
          reason?: string;
          event: {
            type: string;
            id: string;
            status: string;
            round1Status?: string;
            round2Status?: string;
            isQualifiedForRound2?: boolean;
            locked?: boolean;
          } | null;
        }>('/current-event', {
          headers: { Authorization: `Bearer ${res.data.token}` },
        });

        const event = eventRes.data.event;
        const isLocked = eventRes.data.locked || event?.locked;

        if (!event) {
          navigate('/waiting');
        } else if (isLocked) {
          navigate('/waiting');
        } else if (event.type === 'DEBUGGING') {
          if (event.status === 'RUNNING') {
            navigate('/debugging');
          } else {
            navigate('/waiting');
          }
        } else if (event.type === 'TECHNICAL_QUIZ') {
          if (event.round1Status === 'RUNNING') {
            navigate('/quiz');
          } else if (event.round2Status === 'RUNNING' && event.isQualifiedForRound2) {
            navigate('/quiz');
          } else {
            navigate('/waiting');
          }
        } else {
          navigate('/waiting');
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
          <div className={styles.logoWrapper}>
            <img
              src={sasiLogo}
              alt="SASI Institute of Technology & Engineering"
              className={styles.sasiLogo}
            />
          </div>
          <h1 className={styles.title}>Engineers' Day 2026</h1>
          <p className={styles.subtitle}>{adminOnly ? 'Control Room Administrator Portal' : 'Live Competition Portal'}</p>
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

      <div className={styles.footerCredit}>
        <img
          src={eliteLogo}
          alt="ELITE - Dept of Information Technology"
          className={styles.eliteLogo}
        />
        <div className={styles.creditText}>
          <span>Organized by <strong>ELITE</strong></span>
          <span className={styles.deptSubtext}>Department of Information Technology</span>
        </div>
      </div>
    </div>
  );
}
