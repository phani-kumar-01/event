import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { useConnectionStatus } from '../hooks/useConnectionStatus';
import { useTimer } from '../hooks/useTimer';
import { getSocket } from '../services/socket';
import api from '../services/api';
import ConnectionBadge from '../components/ConnectionBadge';
import styles from './AdminPage.module.css';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Event {
  id: string;
  type: 'DEBUGGING' | 'TECHNICAL_QUIZ';
  name: string;
  startTime: string;
  endTime: string;
  status: 'DRAFT' | 'READY' | 'RUNNING' | 'PAUSED' | 'FINISHED';
  durationSeconds: number;
  currentRound?: number;
  round1Status?: string;
  round2Status?: string;
  round1Duration?: number;
  round2Duration?: number;
  round1Weight?: number;
  round2Weight?: number;
  qualifierCount?: number;
  maxParticipants?: number;
  version: number;
}

interface DebuggingProblem {
  id: string;
  eventId: string;
  title: string;
  description: string;
  buggyCode: string;
  expectedOutput: string;
  testCases: Array<{ input: string; expectedOutput: string }>;
  points: number;
  timeLimit: number;
  order: number;
}

interface QuizChallenge {
  id: string;
  eventId: string;
  round: number;
  type: string;
  title: string;
  subtitle: string;
  description: string;
  order: number;
  points: number;
  timeLimit: number;
  config: string;
  isActive: boolean;
  isLocked: boolean;
  _count?: { questions: number };
}

interface QuizQuestion {
  id: string;
  eventId: string;
  challengeId?: string | null;
  round: number;
  category: string;
  type: string;
  question: string;
  imageUrl?: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctAnswer: string;
  explanation: string;
  points: number;
  order: number;
  challenge?: { title: string; type: string };
}

interface Qualification {
  id: string;
  eventId: string;
  userId: string;
  round1Score: number;
  round1Rank: number;
  round1Time: number;
  isQualified: boolean;
  round2Score: number;
  round2Rank: number;
  round2Time: number;
  finalScore: number;
  finalRank: number;
  user: { id: string; rollNo: string; name: string };
}

interface Student {
  id: string;
  rollNo: string;
  name: string;
  createdAt: string;
}

interface Theme {
  id: string;
  name: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  backgroundColor: string;
  surfaceColor: string;
  textColor: string;
  isActive: boolean;
}

type Tab = 'dashboard' | 'events' | 'debugging' | 'quiz_hub' | 'students' | 'results' | 'appearance';
type QuizSubTab = 'challenges' | 'questions' | 'round1_qualifiers' | 'final_rankings';

// ─── Event Card with Timers ───────────────────────────────────────────────────

function EventCard({
  event,
  onAction,
}: {
  event: Event;
  onAction: (id: string, action: string, body?: Record<string, unknown>) => void;
}) {
  const { formatted, remaining } = useTimer(event.status === 'RUNNING' ? event.endTime : null);

  const statusColors: Record<string, string> = {
    DRAFT: styles.statusDraft,
    READY: styles.statusReady,
    RUNNING: styles.statusRunning,
    PAUSED: styles.statusPaused,
    FINISHED: styles.statusFinished,
  };

  const isQuiz = event.type === 'TECHNICAL_QUIZ';

  return (
    <div
      className={`${styles.eventCard} ${
        event.type === 'DEBUGGING' ? styles.eventCardDebug : styles.eventCardQuiz
      }`}
    >
      <div className={styles.eventCardHeader}>
        <div>
          <h3 className={styles.eventCardName}>{event.name}</h3>
          <div className={styles.eventCardType}>
            {event.type.replace('_', ' ')}
            {isQuiz && (
              <span className={styles.roundTag}>
                {event.currentRound === 2 ? 'Round 2: Top 10' : 'Round 1: 60 Students'}
              </span>
            )}
          </div>
        </div>
        <span className={`${styles.statusBadge} ${statusColors[event.status]}`}>{event.status}</span>
      </div>

      <div className={styles.eventCardBody}>
        <div className={styles.eventInfo}>
          <span>Start: {new Date(event.startTime).toLocaleTimeString()}</span>
          <span>End: {new Date(event.endTime).toLocaleTimeString()}</span>
        </div>
        {event.status === 'RUNNING' && (
          <div className={`${styles.eventTimer} ${remaining < 300 ? styles.eventTimerWarn : ''}`}>
            ⏱ {formatted}
          </div>
        )}
        {event.status === 'PAUSED' && <div className={styles.eventTimerPaused}>⏸ PAUSED</div>}
      </div>

      <div className={styles.eventCardActions}>
        {!isQuiz ? (
          /* Debugging Controls */
          <>
            {event.status === 'DRAFT' && (
              <button className={styles.btnReady} onClick={() => onAction(event.id, 'ready')}>
                Ready
              </button>
            )}
            {event.status === 'READY' && (
              <button className={styles.btnStart} onClick={() => onAction(event.id, 'start')}>
                ▶ Start Debugging
              </button>
            )}
            {event.status === 'RUNNING' && (
              <>
                <button className={styles.btnPause} onClick={() => onAction(event.id, 'pause')}>
                  ⏸ Pause
                </button>
                <button
                  className={styles.btnEnd}
                  onClick={() => {
                    if (confirm('End this event?')) onAction(event.id, 'end');
                  }}
                >
                  ■ End
                </button>
              </>
            )}
            {event.status === 'PAUSED' && (
              <>
                <button className={styles.btnResume} onClick={() => onAction(event.id, 'resume')}>
                  ▶ Resume
                </button>
                <button
                  className={styles.btnEnd}
                  onClick={() => {
                    if (confirm('End this event?')) onAction(event.id, 'end');
                  }}
                >
                  ■ End
                </button>
              </>
            )}
            {event.status === 'FINISHED' && (
              <button className={styles.btnReady} onClick={() => onAction(event.id, 'ready')}>
                ↺ Reset to Ready
              </button>
            )}
          </>
        ) : (
          /* Technical Quiz 2-Round Dedicated Controls */
          <div className={styles.quizControls}>
            {/* Round 1 Flow */}
            <div className={styles.roundControlGroup}>
              <div className={styles.roundControlLabel}>
                Round 1 (60 Students) — <strong>{event.round1Status || 'READY'}</strong>
              </div>
              <div className={styles.btnRow}>
                {event.round1Status !== 'RUNNING' && event.round1Status !== 'FINISHED' && (
                  <button
                    className={styles.btnStart}
                    onClick={() => onAction(event.id, 'start-round1')}
                  >
                    ▶ Start Round 1
                  </button>
                )}
                {event.round1Status === 'RUNNING' && (
                  <>
                    <button
                      className={styles.btnPause}
                      onClick={() => onAction(event.id, 'pause-round1')}
                    >
                      ⏸ Pause
                    </button>
                    <button
                      className={styles.btnEnd}
                      onClick={() => {
                        if (confirm('End Round 1?')) onAction(event.id, 'end-round1');
                      }}
                    >
                      ■ End R1
                    </button>
                  </>
                )}
                {event.round1Status === 'PAUSED' && (
                  <>
                    <button
                      className={styles.btnResume}
                      onClick={() => onAction(event.id, 'resume-round1')}
                    >
                      ▶ Resume
                    </button>
                    <button
                      className={styles.btnEnd}
                      onClick={() => {
                        if (confirm('End Round 1?')) onAction(event.id, 'end-round1');
                      }}
                    >
                      ■ End R1
                    </button>
                  </>
                )}
                <button
                  className={styles.btnSpecial}
                  onClick={() => onAction(event.id, 'qualify-round1')}
                  title="Compute scores and select Top 10 students"
                >
                  ⚡ Finalize Top 10 Qualifiers
                </button>
              </div>
            </div>

            {/* Round 2 Flow */}
            <div className={styles.roundControlGroup}>
              <div className={styles.roundControlLabel}>
                Round 2 (Top 10 Qualifiers) — <strong>{event.round2Status || 'DRAFT'}</strong>
              </div>
              <div className={styles.btnRow}>
                {event.round2Status !== 'RUNNING' && event.round2Status !== 'FINISHED' && (
                  <button
                    className={styles.btnGold}
                    onClick={() => onAction(event.id, 'start-round2')}
                  >
                    🏆 Start Round 2 (Top 10)
                  </button>
                )}
                {event.round2Status === 'RUNNING' && (
                  <>
                    <button
                      className={styles.btnPause}
                      onClick={() => onAction(event.id, 'pause-round2')}
                    >
                      ⏸ Pause
                    </button>
                    <button
                      className={styles.btnEnd}
                      onClick={() => {
                        if (confirm('End Round 2?')) onAction(event.id, 'end-round2');
                      }}
                    >
                      ■ End R2
                    </button>
                  </>
                )}
                {event.round2Status === 'PAUSED' && (
                  <>
                    <button
                      className={styles.btnResume}
                      onClick={() => onAction(event.id, 'resume-round2')}
                    >
                      ▶ Resume
                    </button>
                    <button
                      className={styles.btnEnd}
                      onClick={() => {
                        if (confirm('End Round 2?')) onAction(event.id, 'end-round2');
                      }}
                    >
                      ■ End R2
                    </button>
                  </>
                )}
                <button
                  className={styles.btnChampion}
                  onClick={() => onAction(event.id, 'compute-final-rankings')}
                >
                  👑 Compute Final Rankings (40% R1 + 60% R2)
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>{title}</h3>
          <button className={styles.modalClose} onClick={onClose}>
            ✕
          </button>
        </div>
        <div className={styles.modalBody}>{children}</div>
      </div>
    </div>
  );
}

// ─── Main Admin Page ──────────────────────────────────────────────────────────

export default function AdminPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const connectionStatus = useConnectionStatus();
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [quizSubTab, setQuizSubTab] = useState<QuizSubTab>('challenges');

  // Events
  const [events, setEvents] = useState<Event[]>([]);
  const [eventVersions, setEventVersions] = useState<Record<string, number>>({});

  // Debugging
  const [debugProblems, setDebugProblems] = useState<DebuggingProblem[]>([]);
  const [debugModal, setDebugModal] = useState<Partial<DebuggingProblem> | null>(null);

  // Technical Quiz Challenges & Questions
  const [challenges, setChallenges] = useState<QuizChallenge[]>([]);
  const [challengeModal, setChallengeModal] = useState<Partial<QuizChallenge> | null>(null);

  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [quizModal, setQuizModal] = useState<Partial<QuizQuestion> | null>(null);
  const [selectedRoundFilter, setSelectedRoundFilter] = useState<number>(1);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<string>('');

  // Qualifications & Rankings
  const [round1Qualifiers, setRound1Qualifiers] = useState<Qualification[]>([]);
  const [finalRankings, setFinalRankings] = useState<Qualification[]>([]);

  // Students & Theme
  const [students, setStudents] = useState<Student[]>([]);
  const [studentModal, setStudentModal] = useState(false);
  const [newStudent, setNewStudent] = useState({ rollNo: '', name: '', password: '' });
  const [themes, setThemes] = useState<Theme[]>([]);

  // Results & Errors
  const [results, setResults] = useState<Record<string, unknown[]>>({});
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');

  // ── Load Events ────────────────────────────────────────────────────────
  const loadEvents = useCallback(async () => {
    try {
      const res = await api.get<{ events: Event[] }>('/admin/events');
      setEvents(res.data.events);
      const vMap: Record<string, number> = {};
      res.data.events.forEach((e) => {
        vMap[e.id] = e.version;
      });
      setEventVersions(vMap);
    } catch {
      // Ignore
    }
  }, []);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  // ── Socket.IO ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (events.length === 0) return;
    const socket = getSocket();

    events.forEach((e) => socket.emit('join:event', e.id));

    function handleStateChange(data: {
      eventId: string;
      type: string;
      name: string;
      status: string;
      startTime: string;
      endTime: string;
      version: number;
      currentRound?: number;
      round1Status?: string;
      round2Status?: string;
    }) {
      setEventVersions((prev) => {
        const currentVer = prev[data.eventId] ?? 0;
        if (data.version <= currentVer) return prev;
        setEvents((evts) =>
          evts.map((e) =>
            e.id === data.eventId
              ? {
                  ...e,
                  status: data.status as Event['status'],
                  startTime: data.startTime,
                  endTime: data.endTime,
                  version: data.version,
                  currentRound: data.currentRound || e.currentRound,
                  round1Status: data.round1Status || e.round1Status,
                  round2Status: data.round2Status || e.round2Status,
                }
              : e
          )
        );
        return { ...prev, [data.eventId]: data.version };
      });
    }

    async function handleReconnect() {
      await loadEvents();
      events.forEach((e) => socket.emit('join:event', e.id));
    }

    socket.on('event.state_changed', handleStateChange);
    socket.on('connect', handleReconnect);
    return () => {
      socket.off('event.state_changed', handleStateChange);
      socket.off('connect', handleReconnect);
    };
  }, [events, loadEvents]);

  // ── Event Action Handler ───────────────────────────────────────────────
  async function handleEventAction(eventId: string, action: string, body?: Record<string, unknown>) {
    setActionError('');
    setActionSuccess('');
    try {
      const res = await api.post(`/admin/events/${eventId}/${action}`, body);
      if (res.data.event) {
        setEvents((prev) => prev.map((e) => (e.id === eventId ? res.data.event : e)));
      }
      setActionSuccess(`✓ Action "${action}" completed successfully`);
      loadEvents();

      // If qualification or final rankings action, refresh those views
      if (action.includes('qualify') || action.includes('rankings')) {
        loadQuizHubData();
      }
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Action failed';
      setActionError(msg);
    }
  }

  // ── Load Data for active tabs ──────────────────────────────────────────
  const quizEvent = events.find((e) => e.type === 'TECHNICAL_QUIZ');

  const loadQuizHubData = useCallback(async () => {
    if (!quizEvent) return;

    try {
      // Challenges
      const cRes = await api.get<{ challenges: QuizChallenge[] }>('/admin/quiz-challenges');
      setChallenges(cRes.data.challenges);

      // Questions
      const qRes = await api.get<{ questions: QuizQuestion[] }>(
        `/admin/quiz-questions?round=${selectedRoundFilter}`
      );
      setQuizQuestions(qRes.data.questions);

      // Qualifiers
      const l1Res = await api.get<{ qualifications: Qualification[] }>(
        `/admin/events/${quizEvent.id}/round1-leaderboard`
      );
      setRound1Qualifiers(l1Res.data.qualifications);

      // Final rankings
      const l2Res = await api.get<{ rankings: Qualification[] }>(
        `/admin/events/${quizEvent.id}/final-leaderboard`
      );
      setFinalRankings(l2Res.data.rankings);
    } catch {
      // Ignore
    }
  }, [quizEvent, selectedRoundFilter]);

  useEffect(() => {
    if (activeTab === 'quiz_hub') {
      loadQuizHubData();
    } else if (activeTab === 'debugging') {
      api.get<{ problems: DebuggingProblem[] }>('/admin/debugging-problems')
        .then((r) => setDebugProblems(r.data.problems))
        .catch(() => {});
    } else if (activeTab === 'students') {
      api.get<{ students: Student[] }>('/admin/students')
        .then((r) => setStudents(r.data.students))
        .catch(() => {});
    } else if (activeTab === 'results') {
      api.get<{ results: Record<string, unknown[]> }>('/admin/results')
        .then((r) => setResults(r.data.results))
        .catch(() => {});
    } else if (activeTab === 'appearance') {
      api.get<{ themes: Theme[] }>('/admin/themes')
        .then((r) => setThemes(r.data.themes))
        .catch(() => {});
    }
  }, [activeTab, loadQuizHubData]);

  // ── Challenge CRUD ─────────────────────────────────────────────────────
  async function saveChallenge() {
    if (!challengeModal || !quizEvent) return;
    try {
      const payload = { ...challengeModal, eventId: quizEvent.id };
      if (challengeModal.id) {
        await api.patch(`/admin/quiz-challenges/${challengeModal.id}`, payload);
      } else {
        await api.post('/admin/quiz-challenges', payload);
      }
      setChallengeModal(null);
      loadQuizHubData();
    } catch (err: unknown) {
      alert(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
          'Failed to save challenge'
      );
    }
  }

  async function toggleChallengeActive(challenge: QuizChallenge) {
    try {
      await api.patch(`/admin/quiz-challenges/${challenge.id}`, {
        isActive: !challenge.isActive,
      });
      loadQuizHubData();
    } catch {
      // Ignore
    }
  }

  // ── Question CRUD ──────────────────────────────────────────────────────
  async function saveQuizQuestion() {
    if (!quizModal || !quizEvent) return;
    try {
      const payload = {
        ...quizModal,
        eventId: quizEvent.id,
        round: quizModal.round || selectedRoundFilter,
      };
      if (quizModal.id) {
        await api.patch(`/admin/quiz-questions/${quizModal.id}`, payload);
      } else {
        await api.post('/admin/quiz-questions', payload);
      }
      setQuizModal(null);
      loadQuizHubData();
    } catch (err: unknown) {
      alert(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
          'Failed to save question'
      );
    }
  }

  async function deleteQuizQuestion(id: string) {
    if (!confirm('Delete this question?')) return;
    await api.delete(`/admin/quiz-questions/${id}`).catch(() => {});
    loadQuizHubData();
  }

  // ── Excel Import ───────────────────────────────────────────────────────
  async function handleImportExcel() {
    if (!importFile || !quizEvent) return;
    const formData = new FormData();
    formData.append('file', importFile);
    formData.append('eventId', quizEvent.id);
    formData.append('round', String(selectedRoundFilter));

    try {
      const r = await api.post<{ imported: number; errors?: string[] }>(
        '/admin/quiz-questions/import',
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );
      setImportResult(`✓ Successfully imported ${r.data.imported} questions`);
      setImportFile(null);
      loadQuizHubData();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string; errors?: string[] } } };
      const errs =
        e?.response?.data?.errors?.join('\n') || e?.response?.data?.error || 'Import failed';
      setImportResult('✗ ' + errs);
    }
  }

  // ── Debugging CRUD ─────────────────────────────────────────────────────
  async function saveDebugProblem() {
    if (!debugModal) return;
    try {
      const debugEvent = events.find((e) => e.type === 'DEBUGGING');
      const payload = { ...debugModal, eventId: debugModal.eventId || debugEvent?.id };
      if (debugModal.id) {
        await api.patch(`/admin/debugging-problems/${debugModal.id}`, payload);
      } else {
        await api.post('/admin/debugging-problems', payload);
      }
      setDebugModal(null);
      api.get<{ problems: DebuggingProblem[] }>('/admin/debugging-problems').then((r) =>
        setDebugProblems(r.data.problems)
      );
    } catch (err: unknown) {
      alert(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
          'Failed to save problem'
      );
    }
  }

  async function deleteDebugProblem(id: string) {
    if (!confirm('Delete this problem?')) return;
    await api.delete(`/admin/debugging-problems/${id}`).catch(() => {});
    setDebugProblems((prev) => prev.filter((p) => p.id !== id));
  }

  // ── Students & Theme ───────────────────────────────────────────────────
  async function addStudent() {
    try {
      const r = await api.post<{ user: Student }>('/admin/students', newStudent);
      setStudents((prev) => [...prev, r.data.user]);
      setStudentModal(false);
      setNewStudent({ rollNo: '', name: '', password: '' });
    } catch (err: unknown) {
      alert(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed'
      );
    }
  }

  async function deleteStudent(id: string) {
    if (!confirm('Delete this student?')) return;
    await api.delete(`/admin/students/${id}`).catch(() => {});
    setStudents((prev) => prev.filter((s) => s.id !== id));
  }

  async function activateTheme(themeId: string) {
    try {
      await api.post('/admin/theme/activate', { themeId });
      const r = await api.get<{ themes: Theme[] }>('/admin/themes');
      setThemes(r.data.themes);
    } catch {
      // Ignore
    }
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'dashboard', label: '📊 Live Dashboard' },
    { key: 'quiz_hub', label: '⚡ Technical Quiz (2-Rounds)' },
    { key: 'debugging', label: '🐛 Debugging Problems' },
    { key: 'students', label: '👤 Students (60)' },
    { key: 'results', label: '🏆 Leaderboards' },
    { key: 'appearance', label: '🎨 Theme' },
  ];

  return (
    <div className={styles.page}>
      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <aside className={styles.sidebar}>
        <div className={styles.sidebarLogo}>
          <div className={styles.logoTitle}>SASI</div>
          <div className={styles.logoSub}>Competition Control Center</div>
        </div>
        <nav className={styles.nav}>
          {tabs.map((t) => (
            <button
              key={t.key}
              className={`${styles.navBtn} ${activeTab === t.key ? styles.navBtnActive : ''}`}
              onClick={() => setActiveTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className={styles.sidebarBottom}>
          <ConnectionBadge status={connectionStatus} />
          <button
            className={styles.logoutBtn}
            onClick={() => {
              logout();
              navigate('/');
            }}
          >
            Logout
          </button>
        </div>
      </aside>

      {/* ── Main Content ────────────────────────────────────────────── */}
      <main className={styles.content}>
        {actionError && (
          <div className={styles.globalError}>
            {actionError} <button onClick={() => setActionError('')}>✕</button>
          </div>
        )}
        {actionSuccess && (
          <div className={styles.globalSuccess}>
            {actionSuccess} <button onClick={() => setActionSuccess('')}>✕</button>
          </div>
        )}

        {/* ── DASHBOARD ─────────────────────────────────────────────── */}
        {activeTab === 'dashboard' && (
          <div>
            <div className={styles.pageHeader}>
              <div>
                <h2 className={styles.pageTitle}>Live Event Controller</h2>
                <p className={styles.pageSubtitle}>
                  Control the 2 top-level games: Debugging &amp; Technical Quiz.
                </p>
              </div>
            </div>

            <div className={styles.eventGrid}>
              {events.map((e) => (
                <EventCard key={e.id} event={e} onAction={handleEventAction} />
              ))}
              {events.length === 0 && <p className={styles.empty}>Loading events...</p>}
            </div>
          </div>
        )}

        {/* ── TECHNICAL QUIZ HUB (2-ROUNDS) ─────────────────────────── */}
        {activeTab === 'quiz_hub' && (
          <div>
            <div className={styles.pageHeader}>
              <div>
                <h2 className={styles.pageTitle}>⚡ Technical Quiz Module (2 Rounds)</h2>
                <p className={styles.pageSubtitle}>
                  Round 1 (60 participants) → Top 10 Qualifiers → Round 2 (Championship Final)
                </p>
              </div>
            </div>

            {/* Sub-nav */}
            <div className={styles.subNav}>
              <button
                className={`${styles.subTabBtn} ${
                  quizSubTab === 'challenges' ? styles.subTabActive : ''
                }`}
                onClick={() => setQuizSubTab('challenges')}
              >
                🧩 Challenge Stages
              </button>
              <button
                className={`${styles.subTabBtn} ${
                  quizSubTab === 'questions' ? styles.subTabActive : ''
                }`}
                onClick={() => setQuizSubTab('questions')}
              >
                ❓ Questions Bank
              </button>
              <button
                className={`${styles.subTabBtn} ${
                  quizSubTab === 'round1_qualifiers' ? styles.subTabActive : ''
                }`}
                onClick={() => setQuizSubTab('round1_qualifiers')}
              >
                ⚡ Round 1 Qualifiers (Top 10)
              </button>
              <button
                className={`${styles.subTabBtn} ${
                  quizSubTab === 'final_rankings' ? styles.subTabActive : ''
                }`}
                onClick={() => setQuizSubTab('final_rankings')}
              >
                🏆 Final Championship Standings
              </button>
            </div>

            {/* 1. CHALLENGE STAGES SUBTAB */}
            {quizSubTab === 'challenges' && (
              <div className={styles.tabContent}>
                <div className={styles.tabHeader}>
                  <h3 className={styles.sectionTitle}>Configured Challenges</h3>
                  <button
                    className={styles.btnPrimary}
                    onClick={() =>
                      setChallengeModal({
                        round: 1,
                        type: 'RAPID_FIRE',
                        points: 100,
                        isActive: true,
                        isLocked: false,
                      })
                    }
                  >
                    + Add Challenge
                  </button>
                </div>

                <div className={styles.challengeGrid}>
                  {challenges.map((c) => (
                    <div
                      key={c.id}
                      className={`${styles.challengeCard} ${
                        c.isActive ? styles.cActive : styles.cInactive
                      }`}
                    >
                      <div className={styles.cHeader}>
                        <span className={styles.cRoundBadge}>Round {c.round}</span>
                        <span className={styles.cTypeBadge}>{c.type}</span>
                        <button
                          className={c.isActive ? styles.btnToggleOn : styles.btnToggleOff}
                          onClick={() => toggleChallengeActive(c)}
                        >
                          {c.isActive ? 'Active' : 'Disabled'}
                        </button>
                      </div>
                      <h4 className={styles.cTitle}>{c.title}</h4>
                      <p className={styles.cDesc}>{c.description || c.subtitle}</p>
                      <div className={styles.cFooter}>
                        <span>Points: {c.points}</span>
                        <span>Questions: {c._count?.questions ?? 0}</span>
                        <button
                          className={styles.btnSmall}
                          onClick={() => setChallengeModal({ ...c })}
                        >
                          Edit
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 2. QUESTIONS BANK SUBTAB */}
            {quizSubTab === 'questions' && (
              <div className={styles.tabContent}>
                <div className={styles.tabHeader}>
                  <div className={styles.filterRow}>
                    <button
                      className={`${styles.filterBtn} ${
                        selectedRoundFilter === 1 ? styles.filterActive : ''
                      }`}
                      onClick={() => setSelectedRoundFilter(1)}
                    >
                      Round 1 Questions
                    </button>
                    <button
                      className={`${styles.filterBtn} ${
                        selectedRoundFilter === 2 ? styles.filterActive : ''
                      }`}
                      onClick={() => setSelectedRoundFilter(2)}
                    >
                      Round 2 Questions (Top 10)
                    </button>
                  </div>

                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      className={styles.btnSecondary}
                      onClick={() => window.open('/api/admin/quiz-questions/template', '_blank')}
                    >
                      ⬇ Excel Template
                    </button>
                    <button
                      className={styles.btnPrimary}
                      onClick={() =>
                        setQuizModal({
                          round: selectedRoundFilter,
                          category: 'AI',
                          type: 'MCQ',
                          correctAnswer: 'A',
                          points: 15,
                        })
                      }
                    >
                      + Add Question
                    </button>
                  </div>
                </div>

                {/* Import Box */}
                <div className={styles.importBox}>
                  <strong>Import Questions for Round {selectedRoundFilter}:</strong>
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                  />
                  <button
                    className={styles.btnSecondary}
                    disabled={!importFile}
                    onClick={handleImportExcel}
                  >
                    Upload Excel
                  </button>
                  {importResult && (
                    <span
                      className={importResult.startsWith('✓') ? styles.importOk : styles.importErr}
                    >
                      {importResult}
                    </span>
                  )}
                </div>

                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Category</th>
                        <th>Type</th>
                        <th>Question</th>
                        <th>Correct Answer</th>
                        <th>Points</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quizQuestions.map((q, i) => (
                        <tr key={q.id}>
                          <td>{i + 1}</td>
                          <td>
                            <span className={styles.catBadge}>{q.category}</span>
                          </td>
                          <td>
                            <span className={styles.typeBadge}>{q.type}</span>
                          </td>
                          <td title={q.question}>
                            {q.question.length > 50 ? q.question.slice(0, 50) + '…' : q.question}
                          </td>
                          <td>
                            <span className={styles.correctBadge}>{q.correctAnswer}</span>
                          </td>
                          <td>{q.points}</td>
                          <td>
                            <button
                              className={styles.btnSmall}
                              onClick={() => setQuizModal({ ...q })}
                            >
                              Edit
                            </button>
                            <button
                              className={`${styles.btnSmall} ${styles.btnDanger}`}
                              onClick={() => deleteQuizQuestion(q.id)}
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {quizQuestions.length === 0 && (
                    <p className={styles.empty}>No questions found for this round.</p>
                  )}
                </div>
              </div>
            )}

            {/* 3. ROUND 1 QUALIFIERS SUBTAB */}
            {quizSubTab === 'round1_qualifiers' && (
              <div className={styles.tabContent}>
                <div className={styles.tabHeader}>
                  <h3 className={styles.sectionTitle}>
                    Round 1 Participant Standings ({round1Qualifiers.length} Students)
                  </h3>
                  <button
                    className={styles.btnPrimary}
                    onClick={() => {
                      if (quizEvent) handleEventAction(quizEvent.id, 'qualify-round1');
                    }}
                  >
                    ↻ Re-calculate &amp; Select Top 10
                  </button>
                </div>

                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Rank</th>
                        <th>Roll No</th>
                        <th>Student Name</th>
                        <th>R1 Score</th>
                        <th>Time (s)</th>
                        <th>Round 2 Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {round1Qualifiers.map((q) => (
                        <tr
                          key={q.id}
                          className={q.isQualified ? styles.rowQualified : undefined}
                        >
                          <td>
                            <strong>#{q.round1Rank}</strong>
                          </td>
                          <td>
                            <code>{q.user.rollNo}</code>
                          </td>
                          <td>{q.user.name}</td>
                          <td>
                            <strong>{q.round1Score} pts</strong>
                          </td>
                          <td>{q.round1Time}s</td>
                          <td>
                            {q.isQualified ? (
                              <span className={styles.qualifiedBadge}>
                                ✓ QUALIFIED (Top 10)
                              </span>
                            ) : (
                              <span className={styles.notQualifiedBadge}>
                                Round 1 Finished
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {round1Qualifiers.length === 0 && (
                    <p className={styles.empty}>
                      No Round 1 results yet. Run Round 1 and click "Finalize Top 10 Qualifiers".
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* 4. FINAL RANKINGS SUBTAB */}
            {quizSubTab === 'final_rankings' && (
              <div className={styles.tabContent}>
                <div className={styles.tabHeader}>
                  <h3 className={styles.sectionTitle}>
                    🏆 Tournament Final Rankings (40% R1 + 60% R2)
                  </h3>
                  <button
                    className={styles.btnPrimary}
                    onClick={() => {
                      if (quizEvent) handleEventAction(quizEvent.id, 'compute-final-rankings');
                    }}
                  >
                    ↻ Recompute Final Rankings
                  </button>
                </div>

                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Final Rank</th>
                        <th>Roll No</th>
                        <th>Name</th>
                        <th>R1 Score (40%)</th>
                        <th>R2 Score (60%)</th>
                        <th>Final Weighted Score</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {finalRankings.map((r, i) => (
                        <tr
                          key={r.id}
                          className={i === 0 ? styles.winnerRow : undefined}
                        >
                          <td>
                            <span className={styles.rankIcon}>
                              {i === 0
                                ? '🥇 Champion'
                                : i === 1
                                ? '🥈 1st Runner Up'
                                : i === 2
                                ? '🥉 2nd Runner Up'
                                : `#${r.finalRank || i + 1}`}
                            </span>
                          </td>
                          <td>
                            <code>{r.user.rollNo}</code>
                          </td>
                          <td>
                            <strong>{r.user.name}</strong>
                          </td>
                          <td>{r.round1Score} pts</td>
                          <td>{r.round2Score} pts</td>
                          <td>
                            <strong className={styles.goldText}>{r.finalScore} pts</strong>
                          </td>
                          <td>
                            {r.isQualified ? (
                              <span className={styles.finalistBadge}>Finalist</span>
                            ) : (
                              <span>Round 1</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {finalRankings.length === 0 && (
                    <p className={styles.empty}>
                      Final rankings will appear after Round 2 concludes.
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Challenge Modal */}
            {challengeModal !== null && (
              <Modal
                title={challengeModal.id ? 'Edit Challenge' : 'Add Challenge'}
                onClose={() => setChallengeModal(null)}
              >
                <div className={styles.formGrid}>
                  <label>
                    Round
                    <select
                      className={styles.input}
                      value={challengeModal.round ?? 1}
                      onChange={(e) =>
                        setChallengeModal((p) => ({ ...p!, round: +e.target.value }))
                      }
                    >
                      <option value={1}>Round 1 (60 Students)</option>
                      <option value={2}>Round 2 (Top 10 Qualifiers)</option>
                    </select>
                  </label>

                  <label>
                    Challenge Type
                    <select
                      className={styles.input}
                      value={challengeModal.type || 'RAPID_FIRE'}
                      onChange={(e) =>
                        setChallengeModal((p) => ({ ...p!, type: e.target.value }))
                      }
                    >
                      <option value="RAPID_FIRE">⚡ Rapid Fire</option>
                      <option value="GUESS_THE_TECH">🔍 Guess the Tech</option>
                      <option value="TECH_SHUFFLE">🔀 Tech Shuffle</option>
                      <option value="PUZZLE_GRID">🧩 Puzzle Grid (3x3)</option>
                      <option value="TECH_SHOWDOWN">⚔️ Tech Showdown</option>
                      <option value="TECH_TODAY">📰 Tech Today</option>
                      <option value="REAL_OR_FAKE">🎭 Real or Fake</option>
                      <option value="FINAL_CHALLENGE">👑 Final Challenge</option>
                    </select>
                  </label>

                  <label>
                    Title
                    <input
                      className={styles.input}
                      value={challengeModal.title || ''}
                      onChange={(e) =>
                        setChallengeModal((p) => ({ ...p!, title: e.target.value }))
                      }
                    />
                  </label>

                  <label>
                    Points
                    <input
                      className={styles.input}
                      type="number"
                      value={challengeModal.points ?? 100}
                      onChange={(e) =>
                        setChallengeModal((p) => ({ ...p!, points: +e.target.value }))
                      }
                    />
                  </label>

                  <label className={styles.fullWidth}>
                    Description / Subtitle
                    <input
                      className={styles.input}
                      value={challengeModal.subtitle || challengeModal.description || ''}
                      onChange={(e) =>
                        setChallengeModal((p) => ({
                          ...p!,
                          subtitle: e.target.value,
                          description: e.target.value,
                        }))
                      }
                    />
                  </label>
                </div>

                <div className={styles.modalActions}>
                  <button className={styles.btnSecondary} onClick={() => setChallengeModal(null)}>
                    Cancel
                  </button>
                  <button className={styles.btnPrimary} onClick={saveChallenge}>
                    Save Challenge
                  </button>
                </div>
              </Modal>
            )}

            {/* Question Modal */}
            {quizModal !== null && (
              <Modal
                title={quizModal.id ? 'Edit Question' : 'Add Question'}
                onClose={() => setQuizModal(null)}
              >
                <div className={styles.formGrid}>
                  <label>
                    Round
                    <select
                      className={styles.input}
                      value={quizModal.round ?? selectedRoundFilter}
                      onChange={(e) =>
                        setQuizModal((p) => ({ ...p!, round: +e.target.value }))
                      }
                    >
                      <option value={1}>Round 1</option>
                      <option value={2}>Round 2 (Top 10)</option>
                    </select>
                  </label>

                  <label>
                    Challenge Stage
                    <select
                      className={styles.input}
                      value={quizModal.challengeId || ''}
                      onChange={(e) =>
                        setQuizModal((p) => ({ ...p!, challengeId: e.target.value || null }))
                      }
                    >
                      <option value="">-- General / Any --</option>
                      {challenges
                        .filter((c) => c.round === (quizModal.round || selectedRoundFilter))
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.title}
                          </option>
                        ))}
                    </select>
                  </label>

                  <label>
                    Question Type
                    <select
                      className={styles.input}
                      value={quizModal.type || 'MCQ'}
                      onChange={(e) =>
                        setQuizModal((p) => ({ ...p!, type: e.target.value }))
                      }
                    >
                      <option value="MCQ">Multiple Choice (MCQ)</option>
                      <option value="REAL_OR_FAKE">Real or Fake (Fact vs Myth)</option>
                      <option value="SHUFFLE_ORDER">Tech Shuffle Sequence</option>
                    </select>
                  </label>

                  <label>
                    Category
                    <input
                      className={styles.input}
                      value={quizModal.category || 'AI'}
                      onChange={(e) =>
                        setQuizModal((p) => ({ ...p!, category: e.target.value }))
                      }
                    />
                  </label>

                  <label className={styles.fullWidth}>
                    Question Prompt
                    <textarea
                      className={styles.textarea}
                      rows={3}
                      value={quizModal.question || ''}
                      onChange={(e) =>
                        setQuizModal((p) => ({ ...p!, question: e.target.value }))
                      }
                    />
                  </label>

                  <label className={styles.fullWidth}>
                    Image URL (Optional)
                    <input
                      className={styles.input}
                      value={quizModal.imageUrl || ''}
                      placeholder="https://..."
                      onChange={(e) =>
                        setQuizModal((p) => ({ ...p!, imageUrl: e.target.value }))
                      }
                    />
                  </label>

                  {quizModal.type !== 'REAL_OR_FAKE' && (
                    <>
                      <label>
                        Option A
                        <input
                          className={styles.input}
                          value={quizModal.optionA || ''}
                          onChange={(e) =>
                            setQuizModal((p) => ({ ...p!, optionA: e.target.value }))
                          }
                        />
                      </label>
                      <label>
                        Option B
                        <input
                          className={styles.input}
                          value={quizModal.optionB || ''}
                          onChange={(e) =>
                            setQuizModal((p) => ({ ...p!, optionB: e.target.value }))
                          }
                        />
                      </label>
                      <label>
                        Option C
                        <input
                          className={styles.input}
                          value={quizModal.optionC || ''}
                          onChange={(e) =>
                            setQuizModal((p) => ({ ...p!, optionC: e.target.value }))
                          }
                        />
                      </label>
                      <label>
                        Option D
                        <input
                          className={styles.input}
                          value={quizModal.optionD || ''}
                          onChange={(e) =>
                            setQuizModal((p) => ({ ...p!, optionD: e.target.value }))
                          }
                        />
                      </label>
                    </>
                  )}

                  <label>
                    Correct Answer
                    {quizModal.type === 'REAL_OR_FAKE' ? (
                      <select
                        className={styles.input}
                        value={quizModal.correctAnswer || 'REAL'}
                        onChange={(e) =>
                          setQuizModal((p) => ({ ...p!, correctAnswer: e.target.value }))
                        }
                      >
                        <option value="REAL">REAL</option>
                        <option value="FAKE">FAKE</option>
                      </select>
                    ) : quizModal.type === 'SHUFFLE_ORDER' ? (
                      <input
                        className={styles.input}
                        value={quizModal.correctAnswer || ''}
                        placeholder='["1. First", "2. Second", "3. Third"]'
                        onChange={(e) =>
                          setQuizModal((p) => ({ ...p!, correctAnswer: e.target.value }))
                        }
                      />
                    ) : (
                      <select
                        className={styles.input}
                        value={quizModal.correctAnswer || 'A'}
                        onChange={(e) =>
                          setQuizModal((p) => ({ ...p!, correctAnswer: e.target.value }))
                        }
                      >
                        <option value="A">A</option>
                        <option value="B">B</option>
                        <option value="C">C</option>
                        <option value="D">D</option>
                      </select>
                    )}
                  </label>

                  <label>
                    Points
                    <input
                      className={styles.input}
                      type="number"
                      value={quizModal.points ?? 15}
                      onChange={(e) =>
                        setQuizModal((p) => ({ ...p!, points: +e.target.value }))
                      }
                    />
                  </label>

                  <label className={styles.fullWidth}>
                    Explanation
                    <textarea
                      className={styles.textarea}
                      rows={2}
                      value={quizModal.explanation || ''}
                      onChange={(e) =>
                        setQuizModal((p) => ({ ...p!, explanation: e.target.value }))
                      }
                    />
                  </label>
                </div>

                <div className={styles.modalActions}>
                  <button className={styles.btnSecondary} onClick={() => setQuizModal(null)}>
                    Cancel
                  </button>
                  <button className={styles.btnPrimary} onClick={saveQuizQuestion}>
                    Save Question
                  </button>
                </div>
              </Modal>
            )}
          </div>
        )}

        {/* ── DEBUGGING PROBLEMS TAB ────────────────────────────────── */}
        {activeTab === 'debugging' && (
          <div>
            <div className={styles.tabHeader}>
              <h2 className={styles.pageTitle}>Debugging Problems</h2>
              <button
                className={styles.btnPrimary}
                onClick={() => {
                  const debugEvent = events.find((e) => e.type === 'DEBUGGING');
                  setDebugModal({
                    eventId: debugEvent?.id,
                    points: 100,
                    timeLimit: 5,
                    testCases: [],
                  });
                }}
              >
                + Add Problem
              </button>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Title</th>
                    <th>Points</th>
                    <th>Time Limit</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {debugProblems.map((p, i) => (
                    <tr key={p.id}>
                      <td>{i + 1}</td>
                      <td>{p.title}</td>
                      <td>{p.points}</td>
                      <td>{p.timeLimit}s</td>
                      <td>
                        <button
                          className={styles.btnSmall}
                          onClick={() => setDebugModal({ ...p })}
                        >
                          Edit
                        </button>
                        <button
                          className={`${styles.btnSmall} ${styles.btnDanger}`}
                          onClick={() => deleteDebugProblem(p.id)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {debugProblems.length === 0 && <p className={styles.empty}>No problems yet.</p>}
            </div>

            {debugModal !== null && (
              <Modal
                title={debugModal.id ? 'Edit Problem' : 'Add Problem'}
                onClose={() => setDebugModal(null)}
              >
                <div className={styles.formGrid}>
                  <label>
                    Title
                    <input
                      className={styles.input}
                      value={debugModal.title || ''}
                      onChange={(e) =>
                        setDebugModal((p) => ({ ...p!, title: e.target.value }))
                      }
                    />
                  </label>
                  <label>
                    Points
                    <input
                      className={styles.input}
                      type="number"
                      value={debugModal.points ?? 100}
                      onChange={(e) =>
                        setDebugModal((p) => ({ ...p!, points: +e.target.value }))
                      }
                    />
                  </label>
                  <label>
                    Time Limit (seconds)
                    <input
                      className={styles.input}
                      type="number"
                      value={debugModal.timeLimit ?? 5}
                      onChange={(e) =>
                        setDebugModal((p) => ({ ...p!, timeLimit: +e.target.value }))
                      }
                    />
                  </label>
                  <label className={styles.fullWidth}>
                    Description
                    <textarea
                      className={styles.textarea}
                      rows={3}
                      value={debugModal.description || ''}
                      onChange={(e) =>
                        setDebugModal((p) => ({ ...p!, description: e.target.value }))
                      }
                    />
                  </label>
                  <label className={styles.fullWidth}>
                    Buggy C Code
                    <textarea
                      className={styles.textareaCode}
                      rows={10}
                      value={debugModal.buggyCode || ''}
                      onChange={(e) =>
                        setDebugModal((p) => ({ ...p!, buggyCode: e.target.value }))
                      }
                    />
                  </label>
                  <label className={styles.fullWidth}>
                    Expected Output
                    <textarea
                      className={styles.textarea}
                      rows={2}
                      value={debugModal.expectedOutput || ''}
                      onChange={(e) =>
                        setDebugModal((p) => ({ ...p!, expectedOutput: e.target.value }))
                      }
                    />
                  </label>
                </div>
                <div className={styles.modalActions}>
                  <button className={styles.btnSecondary} onClick={() => setDebugModal(null)}>
                    Cancel
                  </button>
                  <button className={styles.btnPrimary} onClick={saveDebugProblem}>
                    Save
                  </button>
                </div>
              </Modal>
            )}
          </div>
        )}

        {/* ── STUDENTS TAB ──────────────────────────────────────────── */}
        {activeTab === 'students' && (
          <div>
            <div className={styles.tabHeader}>
              <h2 className={styles.pageTitle}>Registered Students ({students.length})</h2>
              <button className={styles.btnPrimary} onClick={() => setStudentModal(true)}>
                + Add Student
              </button>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Roll No</th>
                    <th>Name</th>
                    <th>Joined</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <code>{s.rollNo}</code>
                      </td>
                      <td>{s.name}</td>
                      <td>{new Date(s.createdAt).toLocaleDateString()}</td>
                      <td>
                        <button
                          className={`${styles.btnSmall} ${styles.btnDanger}`}
                          onClick={() => deleteStudent(s.id)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {students.length === 0 && <p className={styles.empty}>No students registered yet.</p>}
            </div>

            {studentModal && (
              <Modal title="Add Student" onClose={() => setStudentModal(false)}>
                <div className={styles.formGrid}>
                  <label>
                    Roll Number
                    <input
                      className={styles.input}
                      value={newStudent.rollNo}
                      placeholder="e.g. CS061"
                      onChange={(e) =>
                        setNewStudent((p) => ({ ...p, rollNo: e.target.value.toUpperCase() }))
                      }
                    />
                  </label>
                  <label>
                    Full Name
                    <input
                      className={styles.input}
                      value={newStudent.name}
                      onChange={(e) => setNewStudent((p) => ({ ...p, name: e.target.value }))}
                    />
                  </label>
                  <label>
                    Password
                    <input
                      className={styles.input}
                      type="password"
                      value={newStudent.password}
                      onChange={(e) => setNewStudent((p) => ({ ...p, password: e.target.value }))}
                    />
                  </label>
                </div>
                <div className={styles.modalActions}>
                  <button className={styles.btnSecondary} onClick={() => setStudentModal(false)}>
                    Cancel
                  </button>
                  <button className={styles.btnPrimary} onClick={addStudent}>
                    Add
                  </button>
                </div>
              </Modal>
            )}
          </div>
        )}

        {/* ── RESULTS TAB ───────────────────────────────────────────── */}
        {activeTab === 'results' && (
          <div>
            <h2 className={styles.pageTitle}>Leaderboards &amp; Standings</h2>
            <div className={styles.resultsGrid}>
              {['DEBUGGING', 'TECHNICAL_QUIZ'].map((type) => {
                const rows = (results[type] || []) as Array<{
                  rollNo: string;
                  name: string;
                  totalPoints: number;
                  round1Score?: number;
                  round2Score?: number;
                  isQualified?: boolean;
                  finalRank?: number;
                }>;
                return (
                  <div key={type} className={styles.leaderboard}>
                    <h3 className={styles.leaderboardTitle}>{type.replace('_', ' ')}</h3>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Rank</th>
                          <th>Roll No</th>
                          <th>Name</th>
                          <th>Points</th>
                          {type === 'TECHNICAL_QUIZ' && <th>Status</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, i) => (
                          <tr key={r.rollNo}>
                            <td>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</td>
                            <td>
                              <code>{r.rollNo}</code>
                            </td>
                            <td>{r.name}</td>
                            <td>
                              <strong>{r.totalPoints}</strong>
                            </td>
                            {type === 'TECHNICAL_QUIZ' && (
                              <td>
                                {r.isQualified ? (
                                  <span className={styles.qualifiedBadge}>Finalist</span>
                                ) : (
                                  <span>Round 1</span>
                                )}
                              </td>
                            )}
                          </tr>
                        ))}
                        {rows.length === 0 && (
                          <tr>
                            <td colSpan={5} className={styles.empty}>
                              No submissions recorded yet
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── APPEARANCE TAB ────────────────────────────────────────── */}
        {activeTab === 'appearance' && (
          <div>
            <h2 className={styles.pageTitle}>Appearance &amp; Theme</h2>
            <div className={styles.themeGrid}>
              {themes.map((t) => (
                <div
                  key={t.id}
                  className={`${styles.themeCard} ${t.isActive ? styles.themeCardActive : ''}`}
                >
                  <div className={styles.themePreview}>
                    <div
                      style={{
                        background: t.primaryColor,
                        flex: 1,
                        borderRadius: '4px 0 0 4px',
                      }}
                    />
                    <div style={{ background: t.secondaryColor, flex: 1 }} />
                    <div style={{ background: t.accentColor, flex: 1 }} />
                    <div
                      style={{
                        background: t.backgroundColor,
                        flex: 1,
                        borderRadius: '0 4px 4px 0',
                      }}
                    />
                  </div>
                  <div className={styles.themeName}>{t.name}</div>
                  {t.isActive ? (
                    <span className={styles.activeLabel}>✓ Active</span>
                  ) : (
                    <button className={styles.btnSmall} onClick={() => activateTheme(t.id)}>
                      Activate
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
