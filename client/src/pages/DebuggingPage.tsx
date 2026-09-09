import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import { useAuth } from '../state/AuthContext';
import { useTimer } from '../hooks/useTimer';
import { useConnectionStatus } from '../hooks/useConnectionStatus';
import { getSocket } from '../services/socket';
import api from '../services/api';
import ConnectionBadge from '../components/ConnectionBadge';
import styles from './DebuggingPage.module.css';

interface Event {
  id: string;
  type: string;
  name: string;
  status: string;
  startTime: string;
  endTime: string;
  version: number;
}

interface Problem {
  id: string;
  title: string;
  description: string;
  buggyCode: string;
  expectedOutput: string;
  points: number;
  timeLimit: number;
  order: number;
}

interface SubmissionResult {
  result: string;
  compileOutput: string;
  runOutput: string;
  pointsAwarded: number;
  passedCases: number;
  totalCases: number;
}

interface RunResult {
  success: boolean;
  output: string;
  error: string;
}

export default function DebuggingPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const connectionStatus = useConnectionStatus();

  const [event, setEvent] = useState<Event | null>(null);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [code, setCode] = useState('');
  const [eventVersion, setEventVersion] = useState(0);

  const [running, setRunning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [submitResult, setSubmitResult] = useState<SubmissionResult | null>(null);

  const { formatted: timeFormatted, remaining } = useTimer(event?.status === 'RUNNING' ? event.endTime : null);

  // ── Fetch current event and problems ─────────────────────────────────────
  useEffect(() => {
    async function load() {
      try {
        const res = await api.get<{ event: Event | null }>('/current-event');
        const currentEvent = res.data.event;

        if (!currentEvent) {
          navigate('/waiting');
          return;
        }

        if (currentEvent.type !== 'DEBUGGING') {
          navigate('/quiz');
          return;
        }

        setEvent(currentEvent);
        setEventVersion(currentEvent.version);

        const probRes = await api.get<{ problems: Problem[] }>(
          `/events/${currentEvent.id}/debugging-problems`
        );
        setProblems(probRes.data.problems);
        if (probRes.data.problems.length > 0) {
          setCode(probRes.data.problems[0].buggyCode);
        }

        // Join socket room
        const socket = getSocket();
        socket.emit('join:event', currentEvent.id);
      } catch {
        navigate('/');
      }
    }
    load();
  }, [navigate]);

  // ── Socket.IO: event state changes ───────────────────────────────────────
  useEffect(() => {
    const socket = getSocket();

    function handleStateChange(data: {
      eventId: string;
      type: string;
      status: string;
      startTime: string;
      endTime: string;
      version: number;
    }) {
      if (!event || data.eventId !== event.id) return;
      // Version guard: ignore stale events
      if (data.version <= eventVersion) return;

      setEventVersion(data.version);
      setEvent((prev) =>
        prev ? { ...prev, status: data.status, endTime: data.endTime, startTime: data.startTime } : prev
      );

      // If event ended, update UI
      if (data.status === 'FINISHED') {
        setEvent((prev) => prev ? { ...prev, status: 'FINISHED' } : prev);
      }
    }

    // On reconnect, re-fetch authoritative state
    async function handleReconnect() {
      if (!event) return;
      try {
        const res = await api.get<{ event: Event }>(`/events/${event.id}`);
        setEvent(res.data.event);
        setEventVersion(res.data.event.version);
        socket.emit('join:event', event.id);
      } catch {
        // Ignore
      }
    }

    socket.on('event.state_changed', handleStateChange);
    socket.on('connect', handleReconnect);

    return () => {
      socket.off('event.state_changed', handleStateChange);
      socket.off('connect', handleReconnect);
    };
  }, [event, eventVersion]);

  // ── Auto-navigate when event type changes (to Quiz) ──────────────────────
  useEffect(() => {
    if (!event) return;

    async function checkEventTransition() {
      try {
        const res = await api.get<{ event: Event | null }>('/current-event');
        const cur = res.data.event;
        if (!cur) return;
        if (cur.type === 'TECHNICAL_QUIZ') {
          navigate('/quiz');
        }
      } catch {
        // Ignore
      }
    }

    // Check every 30 seconds for event transitions
    const interval = setInterval(checkEventTransition, 30000);
    return () => clearInterval(interval);
  }, [event, navigate]);

  function selectProblem(index: number) {
    setSelectedIndex(index);
    setCode(problems[index]?.buggyCode || '');
    setRunResult(null);
    setSubmitResult(null);
  }

  async function handleRun() {
    if (!event || event.status !== 'RUNNING') return;
    setRunning(true);
    setRunResult(null);
    try {
      const res = await api.post<RunResult>(`/events/${event.id}/run-code`, { code });
      setRunResult(res.data);
    } catch (err: unknown) {
      setRunResult({
        success: false,
        output: '',
        error: (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Run failed',
      });
    } finally {
      setRunning(false);
    }
  }

  async function handleSubmit() {
    if (!event || event.status !== 'RUNNING' || !problems[selectedIndex]) return;
    setSubmitting(true);
    setSubmitResult(null);
    try {
      const res = await api.post<{ submission: SubmissionResult }>(`/events/${event.id}/submit-code`, {
        problemId: problems[selectedIndex].id,
        code,
      });
      setSubmitResult(res.data.submission);
    } catch (err: unknown) {
      alert(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Submission failed'
      );
    } finally {
      setSubmitting(false);
    }
  }

  const currentProblem = problems[selectedIndex];
  const eventActive = event?.status === 'RUNNING';

  return (
    <div className={styles.page}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.siteTitle}>SASI Engineers' Day</h1>
          <span className={styles.eventBadge}>Debugging Competition</span>
        </div>
        <div className={styles.headerRight}>
          {event && (
            <div className={styles.timer}>
              <span className={styles.timerLabel}>Time Remaining</span>
              <span className={`${styles.timerValue} ${remaining < 300 ? styles.timerWarning : ''}`}>
                {event.status === 'RUNNING' ? timeFormatted : event.status}
              </span>
            </div>
          )}
          <ConnectionBadge status={connectionStatus} />
          <button className={styles.logoutBtn} onClick={logout}>
            Logout
          </button>
        </div>
      </header>

      {/* ── Main Layout ─────────────────────────────────────────────────── */}
      <div className={styles.layout}>
        {/* Problem Sidebar */}
        <aside className={styles.sidebar}>
          <h2 className={styles.sidebarTitle}>Problems</h2>
          <ul className={styles.problemList}>
            {problems.map((p, i) => (
              <li key={p.id}>
                <button
                  className={`${styles.problemBtn} ${i === selectedIndex ? styles.problemBtnActive : ''}`}
                  onClick={() => selectProblem(i)}
                >
                  <span className={styles.problemNum}>#{i + 1}</span>
                  <span className={styles.problemTitle}>{p.title}</span>
                  <span className={styles.problemPoints}>{p.points}pts</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* Main Panel */}
        <main className={styles.main}>
          {!eventActive && (
            <div className={styles.notRunning}>
              {event?.status === 'PAUSED' && '⏸ Competition is paused. Please wait...'}
              {event?.status === 'READY' && '🕐 Competition has not started yet.'}
              {event?.status === 'FINISHED' && '🏁 Competition has ended. Thank you for participating!'}
              {event?.status === 'DRAFT' && '🕐 Competition is being prepared.'}
            </div>
          )}

          {currentProblem && (
            <>
              {/* Problem Description */}
              <section className={styles.problemSection}>
                <h2 className={styles.problemH2}>
                  Problem {selectedIndex + 1}: {currentProblem.title}
                  <span className={styles.pts}>{currentProblem.points} points</span>
                </h2>
                <p className={styles.description}>{currentProblem.description}</p>
                <div className={styles.expectedOutput}>
                  <strong>Expected Output:</strong>
                  <pre className={styles.pre}>{currentProblem.expectedOutput}</pre>
                </div>
              </section>

              {/* Code Editor */}
              <section className={styles.editorSection}>
                <div className={styles.editorHeader}>
                  <span className={styles.langBadge}>C</span>
                  <span className={styles.editorHint}>Edit the code below to fix the bug</span>
                </div>
                <div className={styles.editorContainer}>
                  <Editor
                    height="380px"
                    language="c"
                    value={code}
                    onChange={(v) => setCode(v || '')}
                    theme="vs-dark"
                    options={{
                      minimap: { enabled: false },
                      fontSize: 14,
                      fontFamily: 'Cascadia Code, Fira Code, Consolas, monospace',
                      scrollBeyondLastLine: false,
                      wordWrap: 'on',
                      readOnly: !eventActive,
                    }}
                  />
                </div>

                <div className={styles.actions}>
                  <button
                    className={styles.runBtn}
                    onClick={handleRun}
                    disabled={!eventActive || running}
                  >
                    {running ? '▶ Running...' : '▶ Run Code'}
                  </button>
                  <button
                    className={styles.submitBtn}
                    onClick={handleSubmit}
                    disabled={!eventActive || submitting}
                  >
                    {submitting ? 'Submitting...' : '✓ Submit'}
                  </button>
                </div>
              </section>

              {/* Output Panel */}
              {runResult && (
                <section className={styles.outputSection}>
                  <h3 className={styles.outputTitle}>
                    {runResult.success ? '✓ Output' : '✗ Error'}
                  </h3>
                  <pre className={`${styles.output} ${runResult.success ? styles.outputOk : styles.outputErr}`}>
                    {runResult.output || runResult.error || '(no output)'}
                  </pre>
                </section>
              )}

              {submitResult && (
                <section className={styles.outputSection}>
                  <h3 className={`${styles.outputTitle} ${styles[submitResult.result.toLowerCase().replace(/_/g, '-')]}`}>
                    {submitResult.result === 'ACCEPTED' && '🎉 ACCEPTED'}
                    {submitResult.result === 'WRONG_ANSWER' && '✗ WRONG ANSWER'}
                    {submitResult.result === 'COMPILE_ERROR' && '✗ COMPILE ERROR'}
                    {submitResult.result === 'TIME_LIMIT_EXCEEDED' && '⏱ TIME LIMIT EXCEEDED'}
                    {submitResult.result === 'RUNTIME_ERROR' && '✗ RUNTIME ERROR'}
                    {submitResult.result === 'ACCEPTED' && ` — ${submitResult.pointsAwarded} points`}
                    {submitResult.totalCases > 0 &&
                      ` (${submitResult.passedCases}/${submitResult.totalCases} test cases)`}
                  </h3>
                  {(submitResult.compileOutput || submitResult.runOutput) && (
                    <pre className={`${styles.output} ${submitResult.result === 'ACCEPTED' ? styles.outputOk : styles.outputErr}`}>
                      {submitResult.compileOutput || submitResult.runOutput}
                    </pre>
                  )}
                </section>
              )}
            </>
          )}

          {problems.length === 0 && (
            <div className={styles.empty}>No problems available yet.</div>
          )}
        </main>
      </div>
    </div>
  );
}
