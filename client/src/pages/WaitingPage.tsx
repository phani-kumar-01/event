import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { useConnectionStatus } from '../hooks/useConnectionStatus';
import { getSocket } from '../services/socket';
import api from '../services/api';
import ConnectionBadge from '../components/ConnectionBadge';
import sasiLogo from '../assets/branding/sasi-logo.png';
import eliteLogo from '../assets/branding/elite-logo.jpg';
import styles from './WaitingPage.module.css';

interface QualificationInfo {
  isQualified: boolean;
  round1Score: number;
  round1Rank: number;
  round2Score: number;
  finalScore: number;
  finalRank: number;
}

interface EventData {
  id: string;
  type: string;
  name: string;
  status: string;
  startTime: string;
  endTime: string;
  durationSeconds?: number;
  version: number;
  currentRound: number;
  round1Status: string;
  round2Status: string;
  isQualifiedForRound2: boolean;
  locked?: boolean;
  reason?: string;
  hasQualifications?: boolean;
  qualification?: QualificationInfo | null;
}

export default function WaitingPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const connectionStatus = useConnectionStatus();

  const [events, setEvents] = useState<EventData[]>([]);
  const [loading, setLoading] = useState(true);

  const loadEvents = useCallback(async () => {
    try {
      const res = await api.get<{ events: EventData[] }>('/events');
      if (res.data.events) {
        setEvents(res.data.events);
      }
    } catch {
      // Fallback to /current-event if /events is not ready
      try {
        const fallbackRes = await api.get<{ event: EventData | null }>('/current-event');
        if (fallbackRes.data.event) {
          setEvents([fallbackRes.data.event]);
        }
      } catch {
        // Ignore network errors on polling/fetching
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  // Socket.IO real-time event updates
  useEffect(() => {
    const socket = getSocket();

    function handleStateChange() {
      loadEvents();
    }

    socket.on('event.state_changed', handleStateChange);
    socket.on('event.round_changed', handleStateChange);
    socket.on('connect', loadEvents);

    return () => {
      socket.off('event.state_changed', handleStateChange);
      socket.off('event.round_changed', handleStateChange);
      socket.off('connect', loadEvents);
    };
  }, [loadEvents]);

  // Extract both events
  const debugEvent = events.find((e) => e.type === 'DEBUGGING');
  const quizEvent = events.find((e) => e.type === 'TECHNICAL_QUIZ');

  const isDebugRunning = debugEvent?.status === 'RUNNING';
  const isQuizRunning =
    quizEvent?.round1Status === 'RUNNING' ||
    (quizEvent?.round2Status === 'RUNNING' && quizEvent?.isQualifiedForRound2);

  // Auto-enter if exactly one event is running and user is newly landing
  useEffect(() => {
    if (loading) return;
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('lobby') === 'true') return;

    if (isDebugRunning && !isQuizRunning) {
      navigate('/debugging');
    } else if (isQuizRunning && !isDebugRunning) {
      navigate('/quiz');
    }
  }, [loading, isDebugRunning, isQuizRunning, navigate]);

  return (
    <div className={styles.page}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <img
            src={sasiLogo}
            alt="SASI Institute of Technology & Engineering"
            className={styles.headerLogo}
            width={160}
            height={32}
            fetchPriority="high"
          />
          {user && (
            <span className={styles.userBadge}>
              👤 {user.rollNo} {user.name ? `(${user.name})` : ''}
            </span>
          )}
        </div>
        <div className={styles.headerRight}>
          <button className={styles.refreshBtn} onClick={() => loadEvents()} title="Refresh event status">
            🔄 Refresh
          </button>
          <ConnectionBadge status={connectionStatus} />
          <button className={styles.logoutBtn} onClick={logout}>
            Logout
          </button>
        </div>
      </header>

      {/* ── Main Lobby ─────────────────────────────────────────────────── */}
      <main className={styles.container}>
        <div className={styles.lobbyBanner}>
          <div>
            <h1 className={styles.lobbyTitle}>SASI Engineers' Day 2026 — Competition Arena</h1>
            <p className={styles.lobbySubtitle}>
              Select an active event below to participate. Real-time status syncs automatically.
            </p>
          </div>
        </div>

        <div className={styles.cardsGrid}>
          {/* ── Card 1: C Debugging Arena ─────────────────────────────── */}
          <div className={`${styles.eventCard} ${isDebugRunning ? styles.eventCardLive : ''}`}>
            <div>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitleBlock}>
                  <h2 className={styles.cardTitle}>🛠️ C Debugging Arena</h2>
                  <span className={styles.cardMeta}>
                    Duration: {Math.floor((debugEvent?.durationSeconds || 3600) / 60)} mins • Local GCC Sandbox
                  </span>
                </div>
                <div>
                  {isDebugRunning ? (
                    <span className={styles.badgeLive}>
                      <span className={styles.liveDot} /> LIVE NOW
                    </span>
                  ) : debugEvent?.status === 'READY' ? (
                    <span className={styles.badgeReady}>READY</span>
                  ) : debugEvent?.status === 'PAUSED' ? (
                    <span className={styles.badgePaused}>PAUSED</span>
                  ) : (
                    <span className={styles.badgeMuted}>{debugEvent?.status || 'STANDBY'}</span>
                  )}
                </div>
              </div>

              <ul className={styles.featureList} style={{ marginTop: '14px' }}>
                <li className={styles.featureItem}>
                  <span className={styles.featureIcon}>✓</span>
                  <span>5 Real-world C debugging problems</span>
                </li>
                <li className={styles.featureItem}>
                  <span className={styles.featureIcon}>✓</span>
                  <span>GCC C11 compiler with real-time test verification</span>
                </li>
                <li className={styles.featureItem}>
                  <span className={styles.featureIcon}>✓</span>
                  <span>Monaco interactive code editor & syntax checker</span>
                </li>
              </ul>
            </div>

            <div>
              {isDebugRunning ? (
                <button className={styles.btnSuccess} onClick={() => navigate('/debugging')}>
                  ▶ Enter Debugging Arena →
                </button>
              ) : debugEvent?.status === 'READY' ? (
                <button className={styles.btnDisabled} disabled>
                  ⏳ Standby — Ready to Launch
                </button>
              ) : debugEvent?.status === 'PAUSED' ? (
                <button className={styles.btnDisabled} disabled>
                  ⏸ Arena Paused by Administrator
                </button>
              ) : (
                <button className={styles.btnDisabled} disabled>
                  {debugEvent?.status === 'FINISHED' ? '🏁 Arena Concluded' : '⏳ Standby'}
                </button>
              )}
            </div>
          </div>

          {/* ── Card 2: Technical Quiz Showdown ───────────────────────── */}
          <div
            className={`${styles.eventCard} ${
              quizEvent?.round1Status === 'RUNNING' || quizEvent?.round2Status === 'RUNNING'
                ? styles.eventCardLive
                : ''
            }`}
          >
            <div>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitleBlock}>
                  <h2 className={styles.cardTitle}>⚡ Technical Quiz Showdown</h2>
                  <span className={styles.cardMeta}>
                    Round 1 (Qualifiers) & Round 2 (Top 10 Championship)
                  </span>
                </div>
                <div>
                  {quizEvent?.round1Status === 'RUNNING' ? (
                    <span className={styles.badgeLive}>
                      <span className={styles.liveDot} /> R1 LIVE
                    </span>
                  ) : quizEvent?.round2Status === 'RUNNING' ? (
                    <span className={styles.badgeLive}>
                      <span className={styles.liveDot} /> R2 LIVE
                    </span>
                  ) : quizEvent?.round1Status === 'FINISHED' && quizEvent?.round2Status !== 'FINISHED' ? (
                    <span className={styles.badgeReady}>INTERMISSION</span>
                  ) : quizEvent?.status === 'READY' ? (
                    <span className={styles.badgeReady}>READY</span>
                  ) : (
                    <span className={styles.badgeMuted}>{quizEvent?.status || 'STANDBY'}</span>
                  )}
                </div>
              </div>

              <ul className={styles.featureList} style={{ marginTop: '14px' }}>
                <li className={styles.featureItem}>
                  <span className={styles.featureIcon}>✓</span>
                  <span>Round 1: Rapid Fire, Tech Shuffle & Puzzle Grid</span>
                </li>
                <li className={styles.featureItem}>
                  <span className={styles.featureIcon}>✓</span>
                  <span>Round 2: Head-to-Head Top 10 Tech Championship</span>
                </li>
              </ul>

              {/* Student Qualification / Result Info */}
              {quizEvent?.qualification && (
                <div
                  className={`${styles.qualBox} ${
                    quizEvent.qualification.isQualified ? styles.qualBoxSuccess : styles.qualBoxNotice
                  }`}
                  style={{ marginTop: '10px' }}
                >
                  <div className={styles.qualStatRow}>
                    <span>Round 1 Score: <strong>{quizEvent.qualification.round1Score} pts</strong></span>
                    {quizEvent.qualification.round1Rank > 0 && (
                      <span>Rank: <strong>#{quizEvent.qualification.round1Rank}</strong></span>
                    )}
                  </div>
                  {quizEvent.qualification.isQualified ? (
                    <span>🎉 Qualified for Round 2 Championship!</span>
                  ) : quizEvent.round1Status === 'FINISHED' ? (
                    <span>Round 1 completed. Final tournament awards at closing ceremony.</span>
                  ) : null}
                </div>
              )}
            </div>

            <div>
              {quizEvent?.round1Status === 'RUNNING' ? (
                <button className={styles.btnPrimary} onClick={() => navigate('/quiz')}>
                  ▶ Enter Round 1 Quiz →
                </button>
              ) : quizEvent?.round2Status === 'RUNNING' ? (
                quizEvent.isQualifiedForRound2 ? (
                  <button className={styles.btnSuccess} onClick={() => navigate('/quiz')}>
                    🏆 Enter Round 2 Championship →
                  </button>
                ) : (
                  <button className={styles.btnDisabled} disabled>
                    Round 2 in Progress (Top 10 Only)
                  </button>
                )
              ) : quizEvent?.round1Status === 'FINISHED' ? (
                quizEvent.isQualifiedForRound2 ? (
                  <button className={styles.btnDisabled} disabled>
                    ⏳ Standby — Round 2 Starting Soon
                  </button>
                ) : (
                  <button className={styles.btnDisabled} disabled>
                    Round 1 Completed
                  </button>
                )
              ) : quizEvent?.status === 'READY' ? (
                <button className={styles.btnDisabled} disabled>
                  ⏳ Standby — Ready to Launch
                </button>
              ) : (
                <button className={styles.btnDisabled} disabled>
                  {quizEvent?.status === 'FINISHED' ? '🏁 Quiz Concluded' : '⏳ Standby'}
                </button>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className={styles.footerCredit}>
        <img
          src={eliteLogo}
          alt="ELITE"
          className={styles.eliteLogo}
          width={20}
          height={20}
          loading="lazy"
          decoding="async"
        />
        <span>Organized by <strong>ELITE</strong> — Department of Information Technology</span>
      </footer>
    </div>
  );
}
