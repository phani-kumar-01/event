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
  const { logout } = useAuth();
  const navigate = useNavigate();
  const connectionStatus = useConnectionStatus();

  const [event, setEvent] = useState<EventData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isLocked, setIsLocked] = useState(false);
  const [lockReason, setLockReason] = useState<string | null>(null);

  const loadEvent = useCallback(async () => {
    try {
      const res = await api.get<{
        event: EventData | null;
        locked?: boolean;
        reason?: string;
      }>('/current-event');

      const cur = res.data.event;
      const locked = !!res.data.locked || !!cur?.locked;
      const reason = res.data.reason || cur?.reason || null;

      setIsLocked(locked);
      setLockReason(reason);
      setEvent(cur);

      if (cur) {
        // Auto-navigate if competition is running and student is eligible
        if (cur.type === 'DEBUGGING' && cur.status === 'RUNNING') {
          navigate('/debugging');
          return;
        }

        if (cur.type === 'TECHNICAL_QUIZ') {
          // Round 1 running -> go to quiz
          if (cur.round1Status === 'RUNNING') {
            navigate('/quiz');
            return;
          }

          // Round 2 running and user is qualified -> go to quiz
          if (cur.round2Status === 'RUNNING' && cur.isQualifiedForRound2) {
            navigate('/quiz');
            return;
          }
        }

        const socket = getSocket();
        socket.emit('join:event', cur.id);
      }
    } catch {
      // Ignore network errors on polling/fetching
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    loadEvent();
  }, [loadEvent]);

  // Listen for socket events to auto-navigate or update states
  useEffect(() => {
    const socket = getSocket();

    function handleStateChange() {
      // Re-fetch event info on state changes (round transitions, qualify runs, etc.)
      loadEvent();
    }

    socket.on('event.state_changed', handleStateChange);
    socket.on('connect', loadEvent);

    return () => {
      socket.off('event.state_changed', handleStateChange);
      socket.off('connect', loadEvent);
    };
  }, [loadEvent]);

  // Determine which screen state to show
  const isQuizEvent = event?.type === 'TECHNICAL_QUIZ';
  const round1Finished = event?.round1Status === 'FINISHED';
  const isQualified = !!event?.isQualifiedForRound2;
  const round2Running = event?.round2Status === 'RUNNING';

  const isLockedOut =
    isLocked ||
    lockReason === 'not_qualified' ||
    (isQuizEvent && round1Finished && (event?.hasQualifications ?? false) && !isQualified);

  const isQualifiedWaiting = isQuizEvent && isQualified && !round2Running;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <img
            src={sasiLogo}
            alt="SASI Institute of Technology & Engineering"
            className={styles.headerLogo}
          />
          {event && (
            <span className={styles.eventBadge}>
              {event.type === 'DEBUGGING' ? '💻 C Debugging Arena' : '⚡ Technical Quiz'}
            </span>
          )}
        </div>
        <div className={styles.headerRight}>
          <ConnectionBadge status={connectionStatus} />
          <button className={styles.logoutBtn} onClick={logout}>
            Logout
          </button>
        </div>
      </header>

      <main className={styles.container}>
        {loading ? (
          <div className={styles.card}>
            <div className={styles.icon}>⏳</div>
            <h2 className={styles.title}>Loading Status...</h2>
            <p className={styles.sub}>Connecting to competition server</p>
          </div>
        ) : isLockedOut ? (
          /* ─── State 1: Locked out / Did not qualify for Round 2 ─── */
          <div className={`${styles.card} ${styles.cardLocked}`}>
            <div className={styles.icon}>🏁</div>
            <h2 className={styles.title}>Thanks for playing — you didn't qualify for Round 2</h2>
            <p className={styles.msg}>
              Thank you for participating in the SASI Engineers' Day Technical Quiz!
            </p>

            {event?.qualification && (
              <div className={styles.statsBox}>
                <div className={styles.statItem}>
                  <span className={styles.statLabel}>Round 1 Score</span>
                  <span className={styles.statValue}>{event.qualification.round1Score} pts</span>
                </div>
                {event.qualification.round1Rank > 0 && (
                  <div className={styles.statItem}>
                    <span className={styles.statLabel}>Round 1 Rank</span>
                    <span className={styles.statValue}>#{event.qualification.round1Rank}</span>
                  </div>
                )}
              </div>
            )}

            <div className={styles.noticeBox}>
              <strong>Round 2: Tech Championship</strong> is reserved for the <strong>Top 10 Qualifiers</strong>.
              Final tournament standings and certificates will be presented at the closing ceremony.
            </div>

            <div className={styles.actions}>
              <button className={styles.refreshBtn} onClick={() => loadEvent()}>
                ↻ Refresh Status
              </button>
            </div>
          </div>
        ) : isQualifiedWaiting ? (
          /* ─── State 2: Qualified & waiting for admin to start Round 2 ─── */
          <div className={`${styles.card} ${styles.cardQualified}`}>
            <div className={styles.icon}>🏆</div>
            <div className={styles.badgeSuccess}>🎉 Finalist Qualified!</div>
            <h2 className={styles.title}>Round 2 starting soon</h2>
            <p className={styles.msg}>
              Waiting for the administrator to start Round 2 (Tech Championship).
            </p>

            {event?.qualification && (
              <div className={styles.statsBox}>
                <div className={styles.statItem}>
                  <span className={styles.statLabel}>Round 1 Score</span>
                  <span className={styles.statValue}>{event.qualification.round1Score} pts</span>
                </div>
                {event.qualification.round1Rank > 0 && (
                  <div className={styles.statItem}>
                    <span className={styles.statLabel}>Round 1 Rank</span>
                    <span className={styles.statValue}>#{event.qualification.round1Rank}</span>
                  </div>
                )}
              </div>
            )}

            <div className={styles.pulseIndicator}>
              <span className={styles.pulseDot}></span>
              <span>Please standby — you will be automatically redirected when Round 2 begins.</span>
            </div>

            <div className={styles.actions}>
              <button className={styles.refreshBtn} onClick={() => loadEvent()}>
                ↻ Check Now
              </button>
            </div>
          </div>
        ) : (
          /* ─── State 3: Generic waiting / No competition running ─── */
          <div className={styles.card}>
            <div className={styles.icon}>🕐</div>
            <h2 className={styles.title}>SASI Engineers' Day</h2>
            <p className={styles.msg}>No competition is currently running.</p>
            <p className={styles.sub}>
              Please wait for the competition to begin, or contact the administrator.
            </p>
            <div className={styles.actions}>
              <button className={styles.refreshBtn} onClick={() => loadEvent()}>
                ↻ Refresh
              </button>
            </div>
          </div>
        )}
      </main>

      <footer className={styles.footerCredit}>
        <img
          src={eliteLogo}
          alt="ELITE - Dept of Information Technology"
          className={styles.eliteLogo}
        />
        <div className={styles.creditText}>
          <span>Organized by <strong>ELITE</strong></span>
          <span className={styles.deptSubtext}>Department of Information Technology</span>
        </div>
      </footer>
    </div>
  );
}
