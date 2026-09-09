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

interface QuizQuestion {
  id: string;
  eventId: string;
  question: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctAnswer: string;
  explanation: string;
  points: number;
  order: number;
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

type Tab = 'dashboard' | 'events' | 'debugging' | 'quiz' | 'students' | 'results' | 'appearance';

// ─── Event Card with Timer ────────────────────────────────────────────────────

function EventCard({ event, onAction }: { event: Event; onAction: (id: string, action: string) => void }) {
  const { formatted, remaining } = useTimer(event.status === 'RUNNING' ? event.endTime : null);

  const statusColors: Record<string, string> = {
    DRAFT: styles.statusDraft,
    READY: styles.statusReady,
    RUNNING: styles.statusRunning,
    PAUSED: styles.statusPaused,
    FINISHED: styles.statusFinished,
  };

  return (
    <div className={`${styles.eventCard} ${event.type === 'DEBUGGING' ? styles.eventCardDebug : styles.eventCardQuiz}`}>
      <div className={styles.eventCardHeader}>
        <div>
          <h3 className={styles.eventCardName}>{event.name}</h3>
          <div className={styles.eventCardType}>{event.type.replace('_', ' ')}</div>
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
        {event.status === 'PAUSED' && (
          <div className={styles.eventTimerPaused}>⏸ PAUSED</div>
        )}
      </div>

      <div className={styles.eventCardActions}>
        {event.status === 'DRAFT' && (
          <button className={styles.btnReady} onClick={() => onAction(event.id, 'ready')}>Ready</button>
        )}
        {event.status === 'READY' && (
          <button className={styles.btnStart} onClick={() => onAction(event.id, 'start')}>▶ Start</button>
        )}
        {event.status === 'RUNNING' && (
          <>
            <button className={styles.btnPause} onClick={() => onAction(event.id, 'pause')}>⏸ Pause</button>
            <button className={styles.btnEnd} onClick={() => { if (confirm('End this event?')) onAction(event.id, 'end'); }}>■ End</button>
          </>
        )}
        {event.status === 'PAUSED' && (
          <>
            <button className={styles.btnResume} onClick={() => onAction(event.id, 'resume')}>▶ Resume</button>
            <button className={styles.btnEnd} onClick={() => { if (confirm('End this event?')) onAction(event.id, 'end'); }}>■ End</button>
          </>
        )}
        {event.status === 'FINISHED' && (
          <span className={styles.finishedLabel}>Competition ended</span>
        )}
      </div>
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>{title}</h3>
          <button className={styles.modalClose} onClick={onClose}>✕</button>
        </div>
        <div className={styles.modalBody}>{children}</div>
      </div>
    </div>
  );
}

// ─── Main AdminPage ───────────────────────────────────────────────────────────

export default function AdminPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const connectionStatus = useConnectionStatus();
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');

  // Events state
  const [events, setEvents] = useState<Event[]>([]);
  const [eventVersions, setEventVersions] = useState<Record<string, number>>({});

  // Debugging problems
  const [debugProblems, setDebugProblems] = useState<DebuggingProblem[]>([]);
  const [debugModal, setDebugModal] = useState<Partial<DebuggingProblem> | null>(null);

  // Quiz questions
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [quizModal, setQuizModal] = useState<Partial<QuizQuestion> | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<string>('');

  // Students
  const [students, setStudents] = useState<Student[]>([]);
  const [studentModal, setStudentModal] = useState(false);
  const [newStudent, setNewStudent] = useState({ rollNo: '', name: '', password: '' });

  // Results
  const [results, setResults] = useState<Record<string, unknown[]>>({});

  // Themes
  const [themes, setThemes] = useState<Theme[]>([]);

  // Loading/error
  const [actionError, setActionError] = useState('');

  // ── Load events ────────────────────────────────────────────────────────
  const loadEvents = useCallback(async () => {
    try {
      const res = await api.get<{ events: Event[] }>('/admin/events');
      setEvents(res.data.events);
      const vMap: Record<string, number> = {};
      res.data.events.forEach(e => { vMap[e.id] = e.version; });
      setEventVersions(vMap);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  // ── Socket.IO ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (events.length === 0) return;
    const socket = getSocket();

    // Join all event rooms
    events.forEach(e => socket.emit('join:event', e.id));

    function handleStateChange(data: {
      eventId: string; type: string; name: string; status: string;
      startTime: string; endTime: string; version: number;
    }) {
      setEventVersions(prev => {
        const currentVer = prev[data.eventId] ?? 0;
        if (data.version <= currentVer) return prev;
        setEvents(evts => evts.map(e =>
          e.id === data.eventId
            ? { ...e, status: data.status as Event['status'], startTime: data.startTime, endTime: data.endTime, version: data.version }
            : e
        ));
        return { ...prev, [data.eventId]: data.version };
      });
    }

    async function handleReconnect() {
      await loadEvents();
      events.forEach(e => socket.emit('join:event', e.id));
    }

    socket.on('event.state_changed', handleStateChange);
    socket.on('connect', handleReconnect);
    return () => {
      socket.off('event.state_changed', handleStateChange);
      socket.off('connect', handleReconnect);
    };
  }, [events, loadEvents]);

  // ── Event actions ──────────────────────────────────────────────────────
  async function handleEventAction(eventId: string, action: string) {
    setActionError('');
    try {
      const res = await api.post<{ event: Event }>(`/admin/events/${eventId}/${action}`);
      setEvents(prev => prev.map(e => e.id === eventId ? res.data.event : e));
      setEventVersions(prev => ({ ...prev, [eventId]: res.data.event.version }));
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Action failed';
      setActionError(msg);
    }
  }

  // ── Load tab data on tab switch ────────────────────────────────────────
  useEffect(() => {
    if (activeTab === 'debugging') {
      api.get<{ problems: DebuggingProblem[] }>('/admin/debugging-problems')
        .then(r => setDebugProblems(r.data.problems)).catch(() => {});
    } else if (activeTab === 'quiz') {
      api.get<{ questions: QuizQuestion[] }>('/admin/quiz-questions')
        .then(r => setQuizQuestions(r.data.questions)).catch(() => {});
    } else if (activeTab === 'students') {
      api.get<{ students: Student[] }>('/admin/students')
        .then(r => setStudents(r.data.students)).catch(() => {});
    } else if (activeTab === 'results') {
      api.get<{ results: Record<string, unknown[]> }>('/admin/results')
        .then(r => setResults(r.data.results)).catch(() => {});
    } else if (activeTab === 'appearance') {
      api.get<{ themes: Theme[] }>('/admin/themes')
        .then(r => setThemes(r.data.themes)).catch(() => {});
    }
  }, [activeTab]);

  // ── Debugging CRUD ─────────────────────────────────────────────────────
  async function saveDebugProblem() {
    if (!debugModal) return;
    try {
      const debugEvent = events.find(e => e.type === 'DEBUGGING');
      const payload = { ...debugModal, eventId: debugModal.eventId || debugEvent?.id };
      if (debugModal.id) {
        const r = await api.patch<{ problem: DebuggingProblem }>(`/admin/debugging-problems/${debugModal.id}`, payload);
        setDebugProblems(prev => prev.map(p => p.id === debugModal.id ? r.data.problem : p));
      } else {
        const r = await api.post<{ problem: DebuggingProblem }>('/admin/debugging-problems', payload);
        setDebugProblems(prev => [...prev, r.data.problem]);
      }
      setDebugModal(null);
    } catch (err: unknown) {
      alert((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Save failed');
    }
  }

  async function deleteDebugProblem(id: string) {
    if (!confirm('Delete this problem?')) return;
    await api.delete(`/admin/debugging-problems/${id}`).catch(() => {});
    setDebugProblems(prev => prev.filter(p => p.id !== id));
  }

  // ── Quiz CRUD ──────────────────────────────────────────────────────────
  async function saveQuizQuestion() {
    if (!quizModal) return;
    try {
      const quizEvent = events.find(e => e.type === 'TECHNICAL_QUIZ');
      const payload = { ...quizModal, eventId: quizModal.eventId || quizEvent?.id };
      if (quizModal.id) {
        const r = await api.patch<{ question: QuizQuestion }>(`/admin/quiz-questions/${quizModal.id}`, payload);
        setQuizQuestions(prev => prev.map(q => q.id === quizModal.id ? r.data.question : q));
      } else {
        const r = await api.post<{ question: QuizQuestion }>('/admin/quiz-questions', payload);
        setQuizQuestions(prev => [...prev, r.data.question]);
      }
      setQuizModal(null);
    } catch (err: unknown) {
      alert((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Save failed');
    }
  }

  async function deleteQuizQuestion(id: string) {
    if (!confirm('Delete this question?')) return;
    await api.delete(`/admin/quiz-questions/${id}`).catch(() => {});
    setQuizQuestions(prev => prev.filter(q => q.id !== id));
  }

  async function handleImportExcel() {
    if (!importFile) return;
    const quizEvent = events.find(e => e.type === 'TECHNICAL_QUIZ');
    if (!quizEvent) { alert('No quiz event found'); return; }
    const formData = new FormData();
    formData.append('file', importFile);
    formData.append('eventId', quizEvent.id);
    try {
      const r = await api.post<{ imported: number; errors?: string[] }>('/admin/quiz-questions/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setImportResult(`✓ Imported ${r.data.imported} questions`);
      setImportFile(null);
      const qRes = await api.get<{ questions: QuizQuestion[] }>('/admin/quiz-questions');
      setQuizQuestions(qRes.data.questions);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string; errors?: string[] } } };
      const errs = e?.response?.data?.errors?.join('\n') || e?.response?.data?.error || 'Import failed';
      setImportResult('✗ ' + errs);
    }
  }

  async function downloadTemplate() {
    window.open('/api/admin/quiz-questions/template', '_blank');
  }

  // ── Students ───────────────────────────────────────────────────────────
  async function addStudent() {
    try {
      const r = await api.post<{ user: Student }>('/admin/students', newStudent);
      setStudents(prev => [...prev, r.data.user]);
      setStudentModal(false);
      setNewStudent({ rollNo: '', name: '', password: '' });
    } catch (err: unknown) {
      alert((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed');
    }
  }

  async function deleteStudent(id: string) {
    if (!confirm('Delete this student?')) return;
    await api.delete(`/admin/students/${id}`).catch(() => {});
    setStudents(prev => prev.filter(s => s.id !== id));
  }

  // ── Theme ──────────────────────────────────────────────────────────────
  async function activateTheme(themeId: string) {
    try {
      await api.post('/admin/theme/activate', { themeId });
      const r = await api.get<{ themes: Theme[] }>('/admin/themes');
      setThemes(r.data.themes);
    } catch { /* ignore */ }
  }

  // ── Helpers ────────────────────────────────────────────────────────────
  const tabs: { key: Tab; label: string }[] = [
    { key: 'dashboard', label: '📊 Dashboard' },
    { key: 'events', label: '🗓 Events' },
    { key: 'debugging', label: '🐛 Debugging Qs' },
    { key: 'quiz', label: '❓ Quiz Qs' },
    { key: 'students', label: '👤 Students' },
    { key: 'results', label: '🏆 Results' },
    { key: 'appearance', label: '🎨 Appearance' },
  ];

  return (
    <div className={styles.page}>
      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <aside className={styles.sidebar}>
        <div className={styles.sidebarLogo}>
          <div className={styles.logoTitle}>SASI</div>
          <div className={styles.logoSub}>Admin Panel</div>
        </div>
        <nav className={styles.nav}>
          {tabs.map(t => (
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
          <button className={styles.logoutBtn} onClick={() => { logout(); navigate('/'); }}>Logout</button>
        </div>
      </aside>

      {/* ── Main Content ────────────────────────────────────────────── */}
      <main className={styles.content}>
        {actionError && (
          <div className={styles.globalError}>{actionError} <button onClick={() => setActionError('')}>✕</button></div>
        )}

        {/* ── DASHBOARD ─────────────────────────────────────────────── */}
        {activeTab === 'dashboard' && (
          <div>
            <h2 className={styles.pageTitle}>Dashboard</h2>
            <div className={styles.eventGrid}>
              {events.map(e => (
                <EventCard key={e.id} event={e} onAction={handleEventAction} />
              ))}
              {events.length === 0 && <p className={styles.empty}>Loading events...</p>}
            </div>
          </div>
        )}

        {/* ── EVENTS ────────────────────────────────────────────────── */}
        {activeTab === 'events' && (
          <div>
            <h2 className={styles.pageTitle}>Events Schedule</h2>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Type</th><th>Name</th><th>Start Time</th><th>End Time</th><th>Status</th><th>Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map(e => (
                    <tr key={e.id}>
                      <td><span className={styles.typeBadge}>{e.type.replace('_',' ')}</span></td>
                      <td>{e.name}</td>
                      <td>{new Date(e.startTime).toLocaleString()}</td>
                      <td>{new Date(e.endTime).toLocaleString()}</td>
                      <td><span className={`${styles.statusBadge} ${styles['status'+e.status]}`}>{e.status}</span></td>
                      <td>{Math.floor(e.durationSeconds/60)} min</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── DEBUGGING QUESTIONS ───────────────────────────────────── */}
        {activeTab === 'debugging' && (
          <div>
            <div className={styles.tabHeader}>
              <h2 className={styles.pageTitle}>Debugging Problems</h2>
              <button className={styles.btnPrimary} onClick={() => {
                const debugEvent = events.find(e => e.type === 'DEBUGGING');
                setDebugModal({ eventId: debugEvent?.id, points: 100, timeLimit: 5, testCases: [] });
              }}>+ Add Problem</button>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr><th>#</th><th>Title</th><th>Points</th><th>Time Limit</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {debugProblems.map((p, i) => (
                    <tr key={p.id}>
                      <td>{i + 1}</td>
                      <td>{p.title}</td>
                      <td>{p.points}</td>
                      <td>{p.timeLimit}s</td>
                      <td>
                        <button className={styles.btnSmall} onClick={() => setDebugModal({ ...p })}>Edit</button>
                        <button className={`${styles.btnSmall} ${styles.btnDanger}`} onClick={() => deleteDebugProblem(p.id)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {debugProblems.length === 0 && <p className={styles.empty}>No problems yet.</p>}
            </div>

            {debugModal !== null && (
              <Modal title={debugModal.id ? 'Edit Problem' : 'Add Problem'} onClose={() => setDebugModal(null)}>
                <div className={styles.formGrid}>
                  <label>Title
                    <input className={styles.input} value={debugModal.title || ''} onChange={e => setDebugModal(p => ({...p!, title: e.target.value}))} />
                  </label>
                  <label>Points
                    <input className={styles.input} type="number" value={debugModal.points ?? 100} onChange={e => setDebugModal(p => ({...p!, points: +e.target.value}))} />
                  </label>
                  <label>Time Limit (seconds)
                    <input className={styles.input} type="number" value={debugModal.timeLimit ?? 5} onChange={e => setDebugModal(p => ({...p!, timeLimit: +e.target.value}))} />
                  </label>
                  <label className={styles.fullWidth}>Description
                    <textarea className={styles.textarea} rows={3} value={debugModal.description || ''} onChange={e => setDebugModal(p => ({...p!, description: e.target.value}))} />
                  </label>
                  <label className={styles.fullWidth}>Buggy C Code
                    <textarea className={styles.textareaCode} rows={10} value={debugModal.buggyCode || ''} onChange={e => setDebugModal(p => ({...p!, buggyCode: e.target.value}))} />
                  </label>
                  <label className={styles.fullWidth}>Expected Output
                    <textarea className={styles.textarea} rows={2} value={debugModal.expectedOutput || ''} onChange={e => setDebugModal(p => ({...p!, expectedOutput: e.target.value}))} />
                  </label>
                  <label className={styles.fullWidth}>Test Cases (JSON: [{'{'}input, expectedOutput{'}'}])
                    <textarea
                      className={styles.textarea}
                      rows={3}
                      value={JSON.stringify(debugModal.testCases || [], null, 2)}
                      onChange={e => {
                        try { setDebugModal(p => ({...p!, testCases: JSON.parse(e.target.value)})); }
                        catch { /* invalid JSON, ignore */ }
                      }}
                    />
                  </label>
                </div>
                <div className={styles.modalActions}>
                  <button className={styles.btnSecondary} onClick={() => setDebugModal(null)}>Cancel</button>
                  <button className={styles.btnPrimary} onClick={saveDebugProblem}>Save</button>
                </div>
              </Modal>
            )}
          </div>
        )}

        {/* ── QUIZ QUESTIONS ────────────────────────────────────────── */}
        {activeTab === 'quiz' && (
          <div>
            <div className={styles.tabHeader}>
              <h2 className={styles.pageTitle}>Quiz Questions</h2>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className={styles.btnSecondary} onClick={downloadTemplate}>⬇ Template</button>
                <button className={styles.btnPrimary} onClick={() => {
                  const quizEvent = events.find(e => e.type === 'TECHNICAL_QUIZ');
                  setQuizModal({ eventId: quizEvent?.id, correctAnswer: 'A', points: 10, explanation: '' });
                }}>+ Add Question</button>
              </div>
            </div>

            {/* Excel Import */}
            <div className={styles.importBox}>
              <strong>Import from Excel:</strong>
              <input type="file" accept=".xlsx,.xls" onChange={e => setImportFile(e.target.files?.[0] || null)} />
              <button className={styles.btnSecondary} disabled={!importFile} onClick={handleImportExcel}>Upload</button>
              {importResult && <span className={importResult.startsWith('✓') ? styles.importOk : styles.importErr}>{importResult}</span>}
            </div>

            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr><th>#</th><th>Question</th><th>Correct</th><th>Points</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {quizQuestions.map((q, i) => (
                    <tr key={q.id}>
                      <td>{i + 1}</td>
                      <td title={q.question}>{q.question.length > 60 ? q.question.slice(0, 60) + '…' : q.question}</td>
                      <td><span className={styles.correctBadge}>{q.correctAnswer}</span></td>
                      <td>{q.points}</td>
                      <td>
                        <button className={styles.btnSmall} onClick={() => setQuizModal({ ...q })}>Edit</button>
                        <button className={`${styles.btnSmall} ${styles.btnDanger}`} onClick={() => deleteQuizQuestion(q.id)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {quizQuestions.length === 0 && <p className={styles.empty}>No questions yet.</p>}
            </div>

            {quizModal !== null && (
              <Modal title={quizModal.id ? 'Edit Question' : 'Add Question'} onClose={() => setQuizModal(null)}>
                <div className={styles.formGrid}>
                  <label className={styles.fullWidth}>Question
                    <textarea className={styles.textarea} rows={3} value={quizModal.question || ''} onChange={e => setQuizModal(p => ({...p!, question: e.target.value}))} />
                  </label>
                  <label>Option A<input className={styles.input} value={quizModal.optionA || ''} onChange={e => setQuizModal(p => ({...p!, optionA: e.target.value}))} /></label>
                  <label>Option B<input className={styles.input} value={quizModal.optionB || ''} onChange={e => setQuizModal(p => ({...p!, optionB: e.target.value}))} /></label>
                  <label>Option C<input className={styles.input} value={quizModal.optionC || ''} onChange={e => setQuizModal(p => ({...p!, optionC: e.target.value}))} /></label>
                  <label>Option D<input className={styles.input} value={quizModal.optionD || ''} onChange={e => setQuizModal(p => ({...p!, optionD: e.target.value}))} /></label>
                  <label>Correct Answer
                    <select className={styles.input} value={quizModal.correctAnswer || 'A'} onChange={e => setQuizModal(p => ({...p!, correctAnswer: e.target.value}))}>
                      <option value="A">A</option><option value="B">B</option>
                      <option value="C">C</option><option value="D">D</option>
                    </select>
                  </label>
                  <label>Points
                    <input className={styles.input} type="number" value={quizModal.points ?? 10} onChange={e => setQuizModal(p => ({...p!, points: +e.target.value}))} />
                  </label>
                  <label className={styles.fullWidth}>Explanation
                    <textarea className={styles.textarea} rows={2} value={quizModal.explanation || ''} onChange={e => setQuizModal(p => ({...p!, explanation: e.target.value}))} />
                  </label>
                </div>
                <div className={styles.modalActions}>
                  <button className={styles.btnSecondary} onClick={() => setQuizModal(null)}>Cancel</button>
                  <button className={styles.btnPrimary} onClick={saveQuizQuestion}>Save</button>
                </div>
              </Modal>
            )}
          </div>
        )}

        {/* ── STUDENTS ──────────────────────────────────────────────── */}
        {activeTab === 'students' && (
          <div>
            <div className={styles.tabHeader}>
              <h2 className={styles.pageTitle}>Students</h2>
              <button className={styles.btnPrimary} onClick={() => setStudentModal(true)}>+ Add Student</button>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr><th>Roll No</th><th>Name</th><th>Joined</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {students.map(s => (
                    <tr key={s.id}>
                      <td><code>{s.rollNo}</code></td>
                      <td>{s.name}</td>
                      <td>{new Date(s.createdAt).toLocaleDateString()}</td>
                      <td>
                        <button className={`${styles.btnSmall} ${styles.btnDanger}`} onClick={() => deleteStudent(s.id)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {students.length === 0 && <p className={styles.empty}>No students yet.</p>}
            </div>

            {studentModal && (
              <Modal title="Add Student" onClose={() => setStudentModal(false)}>
                <div className={styles.formGrid}>
                  <label>Roll Number
                    <input className={styles.input} value={newStudent.rollNo} placeholder="e.g. CS006"
                      onChange={e => setNewStudent(p => ({...p, rollNo: e.target.value.toUpperCase()}))} />
                  </label>
                  <label>Full Name
                    <input className={styles.input} value={newStudent.name} onChange={e => setNewStudent(p => ({...p, name: e.target.value}))} />
                  </label>
                  <label>Password
                    <input className={styles.input} type="password" value={newStudent.password} onChange={e => setNewStudent(p => ({...p, password: e.target.value}))} />
                  </label>
                </div>
                <div className={styles.modalActions}>
                  <button className={styles.btnSecondary} onClick={() => setStudentModal(false)}>Cancel</button>
                  <button className={styles.btnPrimary} onClick={addStudent}>Add</button>
                </div>
              </Modal>
            )}
          </div>
        )}

        {/* ── RESULTS ───────────────────────────────────────────────── */}
        {activeTab === 'results' && (
          <div>
            <h2 className={styles.pageTitle}>Results &amp; Leaderboards</h2>
            <div className={styles.resultsGrid}>
              {['DEBUGGING', 'TECHNICAL_QUIZ'].map(type => {
                const rows = (results[type] || []) as Array<{ rollNo: string; name: string; totalPoints: number; answeredCount?: number }>;
                return (
                  <div key={type} className={styles.leaderboard}>
                    <h3 className={styles.leaderboardTitle}>{type.replace('_', ' ')}</h3>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Rank</th><th>Roll No</th><th>Name</th><th>Points</th>
                          {type === 'TECHNICAL_QUIZ' && <th>Answered</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, i) => (
                          <tr key={r.rollNo}>
                            <td>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</td>
                            <td><code>{r.rollNo}</code></td>
                            <td>{r.name}</td>
                            <td><strong>{r.totalPoints}</strong></td>
                            {type === 'TECHNICAL_QUIZ' && <td>{r.answeredCount ?? 0}</td>}
                          </tr>
                        ))}
                        {rows.length === 0 && (
                          <tr><td colSpan={5} className={styles.empty}>No submissions yet</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
            <button className={styles.btnSecondary} onClick={() => {
              api.get<{ results: Record<string, unknown[]> }>('/admin/results')
                .then(r => setResults(r.data.results)).catch(() => {});
            }}>↻ Refresh</button>
          </div>
        )}

        {/* ── APPEARANCE ────────────────────────────────────────────── */}
        {activeTab === 'appearance' && (
          <div>
            <h2 className={styles.pageTitle}>Appearance</h2>
            <div className={styles.themeGrid}>
              {themes.map(t => (
                <div key={t.id} className={`${styles.themeCard} ${t.isActive ? styles.themeCardActive : ''}`}>
                  <div className={styles.themePreview}>
                    <div style={{ background: t.primaryColor, flex: 1, borderRadius: '4px 0 0 4px' }} />
                    <div style={{ background: t.secondaryColor, flex: 1 }} />
                    <div style={{ background: t.accentColor, flex: 1 }} />
                    <div style={{ background: t.backgroundColor, flex: 1, borderRadius: '0 4px 4px 0' }} />
                  </div>
                  <div className={styles.themeName}>{t.name}</div>
                  {t.isActive
                    ? <span className={styles.activeLabel}>✓ Active</span>
                    : <button className={styles.btnSmall} onClick={() => activateTheme(t.id)}>Activate</button>
                  }
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
