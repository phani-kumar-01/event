import React, { useEffect, useState, useCallback } from 'react';
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
  durationSeconds: number;
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
  result: 'ACCEPTED' | 'WRONG_ANSWER' | 'COMPILE_ERROR' | 'TIME_LIMIT_EXCEEDED' | 'RUNTIME_ERROR';
  compileOutput?: string;
  runOutput?: string;
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
  const { logout } = useAuth();
  const navigate = useNavigate();
  const connectionStatus = useConnectionStatus();

  const [event, setEvent] = useState<Event | null>(null);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [code, setCode] = useState('');
  const [eventVersion, setEventVersion] = useState(0);

  const [running, setRunning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [submitResult, setSubmitResult] = useState<SubmissionResult | null>(null);

  const isEventRunning = event?.status === 'RUNNING';
  const { formatted: timeFormatted, remaining } = useTimer(isEventRunning ? event?.endTime : null);

  // ── Fetch current event and problems ─────────────────────────────────────
  const loadEventAndProblems = useCallback(async () => {
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

      const socket = getSocket();
      socket.emit('join:event', currentEvent.id);
    } catch {
      navigate('/');
    }
  }, [navigate]);

  useEffect(() => {
    loadEventAndProblems();
  }, [loadEventAndProblems]);

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
      if (data.version <= eventVersion) return;

      setEventVersion(data.version);
      setEvent((prev) =>
        prev
          ? {
              ...prev,
              status: data.status,
              endTime: data.endTime,
              startTime: data.startTime,
              version: data.version,
            }
          : prev
      );

      if (data.type === 'TECHNICAL_QUIZ') {
        navigate('/quiz');
      }
    }

    async function handleReconnect() {
      if (!event) return;
      await loadEventAndProblems();
      socket.emit('join:event', event.id);
    }

    socket.on('event.state_changed', handleStateChange);
    socket.on('connect', handleReconnect);

    return () => {
      socket.off('event.state_changed', handleStateChange);
      socket.off('connect', handleReconnect);
    };
  }, [event, eventVersion, loadEventAndProblems, navigate]);

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
        error:
          (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
          'Execution failed or timed out (5.0s limit)',
      });
    } finally {
      setRunning(false);
    }
  }

  async function confirmAndSubmit() {
    if (!event || event.status !== 'RUNNING' || !problems[selectedIndex] || submitting) return;
    setSubmitting(true);
    setSubmitResult(null);
    setConfirmModalOpen(false);

    try {
      const res = await api.post<{ submission: SubmissionResult }>(
        `/events/${event.id}/submit-code`,
        {
          problemId: problems[selectedIndex].id,
          code,
        }
      );
      setSubmitResult(res.data.submission);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Submission failed';
      alert(msg);
    } finally {
      setSubmitting(false);
    }
  }

  const currentProblem = problems[selectedIndex];

  const renderVerdictBadge = (result: SubmissionResult['result']) => {
    switch (result) {
      case 'ACCEPTED':
        return (
          <span className={`${styles.verdictBadge} ${styles.verdictAccepted}`}>
            ✓ ACCEPTED ({submitResult?.pointsAwarded} pts)
          </span>
        );
      case 'WRONG_ANSWER':
        return (
          <span className={`${styles.verdictBadge} ${styles.verdictWrongAnswer}`}>
            ✗ WRONG ANSWER
          </span>
        );
      case 'COMPILE_ERROR':
        return (
          <span className={`${styles.verdictBadge} ${styles.verdictCompileError}`}>
            ⚠️ COMPILE ERROR
          </span>
        );
      case 'TIME_LIMIT_EXCEEDED':
        return (
          <span className={`${styles.verdictBadge} ${styles.verdictTimeLimit}`}>
            ⏱ TIME LIMIT EXCEEDED (5s Limit)
          </span>
        );
      case 'RUNTIME_ERROR':
        return (
          <span className={`${styles.verdictBadge} ${styles.verdictRuntimeError}`}>
            💥 RUNTIME ERROR
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className={styles.page}>
      {/* ── Persistent Top Bar ────────────────────────────────────────────── */}
      <header className={styles.topbar}>
        <div className={styles.topbarLeft}>
          <span className={styles.brandTitle}>
            <span>⚡ SASI</span>
            <span>// C DEBUGGING ARENA</span>
          </span>
          <span className={styles.eventPill}>
            {isEventRunning && <span className={styles.liveDot} />}
            <span>{event?.status || 'STANDBY'}</span>
          </span>
        </div>

        <div className={styles.topbarCenter}>
          <div className={styles.timerBlock}>
            <span className={styles.timerLabel}>Time Remaining:</span>
            <span
              className={`${styles.timerValue} ${
                isEventRunning && remaining < 300 ? styles.timerValueUrgent : ''
              }`}
            >
              {isEventRunning
                ? timeFormatted
                : `${Math.floor((event?.durationSeconds || 1800) / 60)}:00`}
            </span>
          </div>
        </div>

        <div className={styles.topbarRight}>
          <ConnectionBadge status={connectionStatus} />
          <button className={styles.logoutBtn} onClick={logout}>
            Logout
          </button>
        </div>
      </header>

      {/* ── Main Layout ───────────────────────────────────────────────────── */}
      <div className={styles.layout}>
        {/* Left Sidebar: Problem Selector */}
        <aside className={styles.sidebar}>
          <div className={styles.sidebarTitle}>Problem Statements</div>
          <ul className={styles.problemList}>
            {problems.map((p, i) => (
              <li key={p.id}>
                <button
                  className={`${styles.problemBtn} ${i === selectedIndex ? styles.problemBtnActive : ''}`}
                  onClick={() => selectProblem(i)}
                >
                  <span className={styles.problemNum}>#{i + 1}</span>
                  <span className={styles.problemTitleText}>{p.title}</span>
                  <span className={styles.problemPoints}>{p.points}p</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* Split View */}
        <div className={styles.mainSplit}>
          {/* ── Left Column: Problem Details & Constraints ────────────────── */}
          <div className={styles.problemColumn}>
            {currentProblem ? (
              <>
                <div className={styles.card}>
                  <div className={styles.problemHeader}>
                    <h2 className={styles.problemTitle}>
                      #{selectedIndex + 1}. {currentProblem.title}
                    </h2>
                    <span className={styles.pointsBadge}>{currentProblem.points} Points</span>
                  </div>

                  <p className={styles.description}>{currentProblem.description}</p>

                  <div className={styles.outputBlock}>
                    <span className={styles.sectionLabel}>Expected Output</span>
                    <pre className={styles.codeBlock}>{currentProblem.expectedOutput}</pre>
                  </div>
                </div>

                <div className={styles.constraintsNote}>
                  <span>⏱</span>
                  <span>
                    <strong>Sandbox Execution Limit:</strong> Each execution is capped at 5.0 seconds.
                    Infinite loops will trigger a Time Limit Exceeded verdict.
                  </span>
                </div>
              </>
            ) : (
              <div className={styles.card}>
                <p>No problem selected.</p>
              </div>
            )}
          </div>

          {/* ── Right Column: Monaco Code Editor & Console Output ──────────── */}
          <div className={styles.editorColumn}>
            <div className={styles.editorCard}>
              <div className={styles.editorHeader}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className={styles.langBadge}>C / GCC</span>
                  <span style={{ fontSize: 'var(--font-size-micro)', color: '#94a3b8' }}>
                    Fix the buggy code to match expected output
                  </span>
                </div>
                <div className={styles.timeoutNotice}>
                  <span>⏱ 5.0s Timeout</span>
                </div>
              </div>

              <div className={styles.editorContainer}>
                <Editor
                  height="340px"
                  language="c"
                  value={code}
                  onChange={(v) => setCode(v || '')}
                  theme="vs-dark"
                  options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    fontFamily: 'Cascadia Code, Fira Code, Consolas, monospace',
                    scrollBeyondLastLine: false,
                    wordWrap: 'on',
                    readOnly: !isEventRunning,
                    automaticLayout: true,
                  }}
                />
              </div>

              <div className={styles.actionBar}>
                <div style={{ fontSize: 'var(--font-size-micro)', color: '#94a3b8' }}>
                  {submitting ? 'Processing submission with test cases...' : 'Ready to test or submit'}
                </div>
                <div className={styles.actionBtnGroup}>
                  <button
                    className={styles.runBtn}
                    onClick={handleRun}
                    disabled={!isEventRunning || running || submitting}
                  >
                    {running ? '▶ Running...' : '▶ Run Code'}
                  </button>
                  <button
                    className={styles.submitBtn}
                    onClick={() => setConfirmModalOpen(true)}
                    disabled={!isEventRunning || submitting}
                  >
                    {submitting ? 'Submitting...' : '✓ Submit Solution'}
                  </button>
                </div>
              </div>
            </div>

            {/* Console / Terminal Results Panel */}
            <div className={styles.consoleCard}>
              <div className={styles.consoleHeader}>
                <span className={styles.consoleTitle}>Console Output &amp; Verdicts</span>
                {submitResult && renderVerdictBadge(submitResult.result)}
              </div>

              {/* Run Code Output */}
              {runResult && (
                <div>
                  <div style={{ fontSize: 'var(--font-size-micro)', color: '#94a3b8', marginBottom: '0.25rem' }}>
                    {runResult.success ? '✓ Preview Output (stdout):' : '✗ Execution Error (stderr):'}
                  </div>
                  <pre className={styles.consoleTerminal}>
                    {runResult.output || runResult.error || '(no stdout output)'}
                  </pre>
                </div>
              )}

              {/* Submit Code Output */}
              {submitResult && (
                <div>
                  <div style={{ fontSize: 'var(--font-size-micro)', color: '#94a3b8', marginBottom: '0.25rem' }}>
                    {submitResult.result === 'ACCEPTED'
                      ? `Passed all test cases (${submitResult.passedCases}/${submitResult.totalCases})`
                      : `Evaluation Output (${submitResult.passedCases}/${submitResult.totalCases} test cases passed):`}
                  </div>
                  {(submitResult.compileOutput || submitResult.runOutput) && (
                    <pre className={styles.consoleTerminal}>
                      {submitResult.compileOutput || submitResult.runOutput}
                    </pre>
                  )}
                </div>
              )}

              {!runResult && !submitResult && (
                <div style={{ fontSize: 'var(--font-size-micro)', color: '#64748b', fontStyle: 'italic' }}>
                  Run your code to test against sample outputs, or click Submit when ready.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Confirm Submit Modal ──────────────────────────────────────────── */}
      {confirmModalOpen && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <span className={styles.modalTitle}>Confirm Submission</span>
              <button className={styles.modalCloseBtn} onClick={() => setConfirmModalOpen(false)}>
                ×
              </button>
            </div>
            <div className={styles.modalBody}>
              <p>
                Are you ready to submit your solution for{' '}
                <strong>
                  Problem #{selectedIndex + 1}: {currentProblem?.title}
                </strong>
                ?
              </p>
              <p style={{ fontSize: 'var(--font-size-micro)', color: 'var(--admin-text-muted)' }}>
                Your code will be evaluated against all hidden server test cases.
              </p>
            </div>
            <div className={styles.modalFooter}>
              <button className={styles.btnSecondary} onClick={() => setConfirmModalOpen(false)}>
                Cancel
              </button>
              <button
                className={styles.btnPrimary}
                disabled={submitting}
                onClick={confirmAndSubmit}
              >
                {submitting ? 'Submitting...' : 'Confirm & Submit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
