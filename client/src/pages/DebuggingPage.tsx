import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import { useAuth } from '../state/AuthContext';
import { useTimer } from '../hooks/useTimer';
import { useConnectionStatus } from '../hooks/useConnectionStatus';
import { getSocket } from '../services/socket';
import api from '../services/api';
import ConnectionBadge from '../components/ConnectionBadge';
import sasiLogo from '../assets/branding/sasi-logo.png';
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

interface TestCaseItem {
  input: string;
  expectedOutput: string;
}

interface Problem {
  id: string;
  title: string;
  description?: string;
  buggyCode: string;
  expectedOutput: string;
  sampleInput?: string;
  sampleTestCases?: TestCaseItem[];
  points: number;
  timeLimit: number;
  order: number;
}

interface Submission {
  id: string;
  problemId: string;
  result: 'ACCEPTED' | 'WRONG_ANSWER' | 'COMPILE_ERROR' | 'TIME_LIMIT_EXCEEDED' | 'RUNTIME_ERROR';
  pointsAwarded: number;
  submittedAt: string;
}

interface TestCaseResult {
  name: string;
  type: 'SAMPLE' | 'HIDDEN';
  status: 'PASSED' | 'FAILED' | 'TIME_LIMIT_EXCEEDED' | 'RUNTIME_ERROR';
  timeMs: number;
  input?: string;
  expectedOutput?: string;
  actualOutput?: string;
  error?: string;
}

interface SubmissionResult {
  result: 'ACCEPTED' | 'WRONG_ANSWER' | 'COMPILE_ERROR' | 'TIME_LIMIT_EXCEEDED' | 'RUNTIME_ERROR';
  compileOutput?: string;
  runOutput?: string;
  pointsAwarded: number;
  passedCases: number;
  totalCases: number;
  testCases?: TestCaseResult[];
  nextProblemId?: string;
}

interface RunResult {
  success: boolean;
  output: string;
  error?: string;
  compileOutput?: string;
  testCases?: TestCaseResult[];
}

export default function DebuggingPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const connectionStatus = useConnectionStatus();

  const [event, setEvent] = useState<Event | null>(null);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [codeMap, setCodeMap] = useState<Record<string, string>>({});
  const [solvedProblemIds, setSolvedProblemIds] = useState<Set<string>>(new Set());
  const [eventVersion, setEventVersion] = useState(0);

  const [running, setRunning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [activeConsoleTab, setActiveConsoleTab] = useState<'TESTS' | 'TERMINAL'>('TESTS');
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [submitResult, setSubmitResult] = useState<SubmissionResult | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 4500);
  }, []);

  const [serverRemaining, setServerRemaining] = useState<number | null>(null);
  const isEventRunning = event?.status === 'RUNNING';
  const { formatted: localTimeFormatted, remaining: localRemaining } = useTimer(isEventRunning ? event?.endTime : null);

  const displayRemaining = serverRemaining !== null ? serverRemaining : localRemaining;
  const timeFormatted =
    serverRemaining !== null
      ? `${String(Math.floor(serverRemaining / 60)).padStart(2, '0')}:${String(serverRemaining % 60).padStart(2, '0')}`
      : localTimeFormatted;

  // ── Fetch current event, problems & submissions with progress sync ──────────
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

      const [probRes, subRes, progressRes] = await Promise.all([
        api.get<{ problems: Problem[] }>(`/events/${currentEvent.id}/debugging-problems`),
        api.get<{ submissions: Submission[] }>(`/events/${currentEvent.id}/my-submissions`).catch(() => ({ data: { submissions: [] } })),
        api.get<{ solvedProblemIds: string[] }>('/debugging/progress').catch(() => ({ data: { solvedProblemIds: [] } })),
      ]);

      const fetchedProblems = probRes.data.problems;
      setProblems(fetchedProblems);

      // Determine solved problems by combining submissions & progress sync
      const solvedSet = new Set<string>();
      (subRes.data.submissions || []).forEach((s) => {
        if (s.result === 'ACCEPTED') {
          solvedSet.add(s.problemId);
        }
      });
      (progressRes.data.solvedProblemIds || []).forEach((id) => solvedSet.add(id));
      setSolvedProblemIds(solvedSet);

      // Initialize code map with buggyCode if not yet set
      setCodeMap((prev) => {
        const updated = { ...prev };
        fetchedProblems.forEach((p) => {
          if (updated[p.id] === undefined) {
            updated[p.id] = p.buggyCode;
          }
        });
        return updated;
      });

      // Select first unsolved problem or 0
      if (fetchedProblems.length > 0) {
        let firstUnsolvedIndex = 0;
        for (let i = 0; i < fetchedProblems.length; i++) {
          if (!solvedSet.has(fetchedProblems[i].id)) {
            firstUnsolvedIndex = i;
            break;
          }
        }
        setSelectedIndex(firstUnsolvedIndex);
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

  // ── Socket.IO: event state changes, problem solved & server timer ticks ────
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

    function handleProblemSolved(data: {
      userId: string;
      eventId: string;
      problemId: string;
      nextProblemId?: string;
      pointsAwarded: number;
    }) {
      if (data.userId === user?.id) {
        setSolvedProblemIds((prev) => new Set([...prev, data.problemId]));
      }
    }

    function handleTimerTick(data: { eventId: string; remainingSeconds: number }) {
      if (event && data.eventId === event.id) {
        setServerRemaining(data.remainingSeconds);
      }
    }

    async function handleReconnect() {
      if (!event) return;
      await loadEventAndProblems();
      socket.emit('join:event', event.id);
    }

    socket.on('event.state_changed', handleStateChange);
    socket.on('debugging:problem_solved', handleProblemSolved);
    socket.on('PROBLEM_SOLVED', handleProblemSolved);
    socket.on('timer:tick', handleTimerTick);
    socket.on('connect', handleReconnect);

    return () => {
      socket.off('event.state_changed', handleStateChange);
      socket.off('debugging:problem_solved', handleProblemSolved);
      socket.off('PROBLEM_SOLVED', handleProblemSolved);
      socket.off('timer:tick', handleTimerTick);
      socket.off('connect', handleReconnect);
    };
  }, [event, eventVersion, loadEventAndProblems, navigate, user?.id]);

  // ── Problem status and progression rules ──────────────────────────────────
  function isProblemLocked(index: number): boolean {
    if (index === 0) return false;
    const prevProblem = problems[index - 1];
    if (!prevProblem) return true;
    return !solvedProblemIds.has(prevProblem.id);
  }

  function getProblemStatus(index: number): 'SOLVED' | 'ACTIVE' | 'LOCKED' | 'UNLOCKED' {
    const prob = problems[index];
    if (!prob) return 'LOCKED';
    if (solvedProblemIds.has(prob.id)) {
      return index === selectedIndex ? 'ACTIVE' : 'SOLVED';
    }
    if (isProblemLocked(index)) {
      return 'LOCKED';
    }
    return index === selectedIndex ? 'ACTIVE' : 'UNLOCKED';
  }

  function selectProblem(index: number) {
    if (isProblemLocked(index)) return;
    setSelectedIndex(index);
    setRunResult(null);
    setSubmitResult(null);
    setActiveConsoleTab('TESTS');
  }

  const currentProblem = problems[selectedIndex];
  const currentCode = currentProblem ? (codeMap[currentProblem.id] ?? currentProblem.buggyCode) : '';

  function handleCodeChange(newCode: string | undefined) {
    if (!currentProblem) return;
    setCodeMap((prev) => ({
      ...prev,
      [currentProblem.id]: newCode || '',
    }));
  }

  // ── Run Sample (Local Test Case Evaluation) ──────────────────────────────
  async function handleRunSample() {
    if (!event || (event.status !== 'RUNNING' && user?.role !== 'ADMIN') || !currentProblem) return;
    setRunning(true);
    setRunResult(null);
    setActiveConsoleTab('TESTS');

    try {
      const res = await api.post<RunResult>('/debugging/execute', {
        problemId: currentProblem.id,
        sourceCode: currentCode,
        mode: 'RUN',
      });
      setRunResult(res.data);
    } catch (err: unknown) {
      setRunResult({
        success: false,
        output: '',
        error:
          (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
          'Execution failed or timed out (2.0s sandbox limit)',
      });
    } finally {
      setRunning(false);
    }
  }

  // ── Submit Solution (Both Sample + Hidden Test Cases) ────────────────────
  async function confirmAndSubmit() {
    if (!event || (event.status !== 'RUNNING' && user?.role !== 'ADMIN') || !currentProblem || submitting) return;
    setSubmitting(true);
    setSubmitResult(null);
    setConfirmModalOpen(false);
    setActiveConsoleTab('TESTS');

    try {
      const res = await api.post<{ success: boolean; message?: string; submission: SubmissionResult; nextProblemId?: string }>(
        '/debugging/execute',
        {
          problemId: currentProblem.id,
          sourceCode: currentCode,
          mode: 'SUBMIT',
        }
      );

      const submission = res.data.submission;
      setSubmitResult(submission);

      if (submission.result === 'ACCEPTED' || res.data.success) {
        setSolvedProblemIds((prev) => new Set([...prev, currentProblem.id]));

        const nextIdx = selectedIndex + 1;
        if (nextIdx < problems.length) {
          showToast(`🎉 Correct Output! Problem #${nextIdx + 1} Unlocked.`, 'success');
          // Auto-switch to newly unlocked problem
          setTimeout(() => {
            setSelectedIndex(nextIdx);
            setRunResult(null);
            setSubmitResult(null);
          }, 800);
        } else {
          showToast('🎉 All debugging problems solved! Outstanding performance!', 'success');
        }
      }
    } catch (err: unknown) {
      const respData = (err as { response?: { data?: { error?: string; submission?: SubmissionResult } } })?.response?.data;
      if (respData?.submission) {
        setSubmitResult(respData.submission);
      }
      const msg = respData?.error || 'Submission failed: Output mismatch or execution error.';
      showToast(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  }

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
            ⏱ TIME LIMIT EXCEEDED
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

  const isCurrentSolved = currentProblem ? solvedProblemIds.has(currentProblem.id) : false;
  const hasNextProblem = selectedIndex + 1 < problems.length;
  const isNextUnlocked = hasNextProblem && !isProblemLocked(selectedIndex + 1);

  // Active test cases to display
  const activeTestCases: TestCaseResult[] = submitResult?.testCases || runResult?.testCases || [];

  return (
    <div className={styles.page}>
      {/* ── Toast Alert Banner ────────────────────────────────────────────── */}
      {toast && (
        <div
          className={`${styles.toastBanner} ${
            toast.type === 'success' ? styles.toastSuccess : styles.toastError
          }`}
        >
          <span>{toast.message}</span>
        </div>
      )}

      {/* ── Persistent Top Bar ────────────────────────────────────────────── */}
      <header className={styles.topbar}>
        <div className={styles.topbarLeft}>
          <div className={styles.brandTitle}>
            <img
              src={sasiLogo}
              alt="SASI Institute of Technology & Engineering"
              className={styles.headerLogo}
            />
            <span className={styles.brandSlash}>/</span>
            <span className={styles.brandSubtext}>C DEBUGGING ARENA</span>
          </div>
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
                isEventRunning && displayRemaining < 300 ? styles.timerValueUrgent : ''
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
        {/* ── Minimalist Problem Navigator (Left Panel) ───────────────────── */}
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <span className={styles.sidebarTitle}>PROBLEMS</span>
            <span className={styles.solvedCountBadge}>
              {solvedProblemIds.size}/{problems.length} SOLVED
            </span>
          </div>

          <ul className={styles.problemList}>
            {problems.map((p, i) => {
              const status = getProblemStatus(i);
              const locked = status === 'LOCKED';
              const isActive = i === selectedIndex;
              const isSolved = solvedProblemIds.has(p.id);

              return (
                <li key={p.id}>
                  <button
                    className={`${styles.problemBtn} ${isActive ? styles.problemBtnActive : ''} ${
                      locked ? styles.problemBtnLocked : ''
                    } ${isSolved ? styles.problemBtnSolved : ''}`}
                    onClick={() => selectProblem(i)}
                    disabled={locked}
                    title={locked ? `Locked: Solve Problem #${i} to unlock` : p.title}
                  >
                    <div className={styles.problemBtnLeft}>
                      <span className={styles.problemNum}>#{i + 1}</span>
                      <span className={styles.problemTitleText}>{p.title}</span>
                    </div>

                    <div className={styles.problemBtnRight}>
                      <span className={styles.problemPoints}>{p.points}p</span>
                      {isSolved ? (
                        <span className={styles.statusSolvedBadge} title="Passed all test cases">✓</span>
                      ) : locked ? (
                        <span className={styles.statusLockedBadge} title="Locked">🔒</span>
                      ) : isActive ? (
                        <span className={styles.statusActiveBadge} title="Currently active">●</span>
                      ) : (
                        <span className={styles.statusUnlockedBadge} title="Unlocked">○</span>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* ── Primary Full-Width Code Editor Stage ─────────────────────────── */}
        <main className={styles.primaryStage}>
          {currentProblem ? (
            <div className={styles.editorWorkspace}>
              {/* Problem Sub-Header Bar */}
              <div className={styles.editorTopBar}>
                <div className={styles.editorTopBarLeft}>
                  <span className={styles.editorProblemNum}>Problem #{selectedIndex + 1}</span>
                  <span className={styles.editorProblemTitle}>{currentProblem.title}</span>
                  <span className={styles.editorPointsBadge}>{currentProblem.points} Points</span>
                  {isCurrentSolved && (
                    <span className={styles.solvedIndicatorBadge}>✓ Solved (+{currentProblem.points} pts)</span>
                  )}
                </div>
                <div className={styles.editorTopBarRight}>
                  <span className={styles.langBadge}>C / GCC</span>
                  <span className={styles.timeoutBadge}>⏱ 5.0s Timeout</span>
                </div>
              </div>

              {/* Monaco Code Editor taking full primary space */}
              <div className={styles.editorContainer}>
                <Editor
                  height="100%"
                  language="c"
                  value={currentCode}
                  onChange={handleCodeChange}
                  theme="vs-dark"
                  options={{
                    minimap: { enabled: false },
                    fontSize: 14,
                    fontFamily: 'Cascadia Code, Fira Code, Consolas, monospace',
                    scrollBeyondLastLine: false,
                    wordWrap: 'on',
                    readOnly: !isEventRunning,
                    automaticLayout: true,
                    lineNumbers: 'on',
                    renderLineHighlight: 'all',
                    cursorBlinking: 'smooth',
                    tabSize: 2,
                  }}
                />
              </div>

              {/* ── Compact "Sample Target" & Action Bar ───────────────────── */}
              <div className={styles.sampleTargetBar}>
                <div className={styles.targetOutputs}>
                  {currentProblem.sampleInput && currentProblem.sampleInput.trim() !== '' && (
                    <div className={styles.targetItem}>
                      <span className={styles.targetLabel}>Sample Input:</span>
                      <code className={styles.targetValue}>{currentProblem.sampleInput}</code>
                    </div>
                  )}
                  <div className={styles.targetItem}>
                    <span className={styles.targetLabel}>Expected Output:</span>
                    <code className={styles.targetValue}>{currentProblem.expectedOutput}</code>
                  </div>
                </div>

                <div className={styles.actionBtnGroup}>
                  <button
                    className={styles.runSampleBtn}
                    onClick={handleRunSample}
                    disabled={!isEventRunning || running || submitting}
                    title="Test your code output against sample target"
                  >
                    {running ? '▶ Running Sample...' : '▶ Run Sample'}
                  </button>
                  <button
                    className={styles.submitSolutionBtn}
                    onClick={() => setConfirmModalOpen(true)}
                    disabled={!isEventRunning || submitting}
                    title="Evaluate code against hidden server test cases"
                  >
                    {submitting ? 'Submitting...' : '✓ Submit Solution'}
                  </button>
                  {isCurrentSolved && hasNextProblem && isNextUnlocked && (
                    <button
                      className={styles.nextProblemBtn}
                      onClick={() => selectProblem(selectedIndex + 1)}
                      title="Advance to next problem"
                    >
                      Next Problem →
                    </button>
                  )}
                </div>
              </div>

              {/* ── Compact Console / Test Case Runner Panel ──────────────── */}
              <div className={styles.consolePanel}>
                <div className={styles.consoleHeader}>
                  <div className={styles.consoleHeaderLeft}>
                    <div className={styles.consoleTabGroup}>
                      <button
                        className={`${styles.consoleTabBtn} ${activeConsoleTab === 'TESTS' ? styles.consoleTabBtnActive : ''}`}
                        onClick={() => setActiveConsoleTab('TESTS')}
                      >
                        🧪 Test Cases {activeTestCases.length > 0 && `(${activeTestCases.length})`}
                      </button>
                      <button
                        className={`${styles.consoleTabBtn} ${activeConsoleTab === 'TERMINAL' ? styles.consoleTabBtnActive : ''}`}
                        onClick={() => setActiveConsoleTab('TERMINAL')}
                      >
                        📟 Terminal Output
                      </button>
                    </div>

                    {submitResult && (
                      <span className={styles.caseSummaryText}>
                        ({submitResult.passedCases}/{submitResult.totalCases} passed)
                      </span>
                    )}
                  </div>

                  <div className={styles.consoleHeaderRight}>
                    {submitResult && renderVerdictBadge(submitResult.result)}
                  </div>
                </div>

                <div className={styles.consoleContent}>
                  {/* ── Tab 1: Test Cases Runner UI ── */}
                  {activeConsoleTab === 'TESTS' && (
                    <>
                      {activeTestCases.length > 0 ? (
                        <div className={styles.testCasesList}>
                          {activeTestCases.map((tc, idx) => {
                            const isPassed = tc.status === 'PASSED';
                            const isHidden = tc.type === 'HIDDEN';

                            return (
                              <div
                                key={idx}
                                className={`${styles.testCaseCard} ${isPassed ? styles.testCaseCardPassed : styles.testCaseCardFailed}`}
                              >
                                <div className={styles.testCaseCardTop}>
                                  <div className={styles.testCaseMeta}>
                                    <span className={isHidden ? styles.tagHidden : styles.tagSample}>
                                      {isHidden ? 'HIDDEN' : 'SAMPLE'}
                                    </span>
                                    <span className={styles.testCaseName}>{tc.name}</span>
                                  </div>

                                  <div className={styles.testCaseStatus}>
                                    <span
                                      className={`${styles.caseStatusBadge} ${
                                        isPassed ? styles.caseStatusPassed : styles.caseStatusFailed
                                      }`}
                                    >
                                      {isPassed ? `✓ PASSED [${tc.timeMs}ms]` : `✗ ${tc.status} [${tc.timeMs}ms]`}
                                    </span>
                                  </div>
                                </div>

                                {/* Sample Test Case Details */}
                                {!isHidden && (tc.actualOutput !== undefined || tc.expectedOutput !== undefined) && (
                                  <div className={styles.testCaseBody}>
                                    {tc.input && (
                                      <div className={styles.caseDataRow}>
                                        <span className={styles.caseDataLabel}>Input:</span>
                                        <code className={styles.caseDataCode}>{tc.input}</code>
                                      </div>
                                    )}
                                    <div className={styles.caseDataRow}>
                                      <span className={styles.caseDataLabel}>Expected:</span>
                                      <code className={styles.caseDataCode}>{tc.expectedOutput}</code>
                                    </div>
                                    <div className={styles.caseDataRow}>
                                      <span className={styles.caseDataLabel}>Actual:</span>
                                      <code className={`${styles.caseDataCode} ${isPassed ? styles.codeMatch : styles.codeMismatch}`}>
                                        {tc.actualOutput || '(no stdout output)'}
                                      </code>
                                    </div>
                                  </div>
                                )}

                                {/* Hidden Test Case Notice */}
                                {isHidden && (
                                  <div className={styles.hiddenCaseNotice}>
                                    🔒 Server validation test case executed securely. Inputs and outputs are hidden.
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className={styles.consolePlaceholder}>
                          Click <strong>▶ Run Sample</strong> to evaluate sample test cases, or click <strong>✓ Submit Solution</strong> to run all sample and hidden test cases.
                        </div>
                      )}
                    </>
                  )}

                  {/* ── Tab 2: Terminal Output UI ── */}
                  {activeConsoleTab === 'TERMINAL' && (
                    <div className={styles.terminalContainer}>
                      {runResult && (
                        <div className={styles.outputSection}>
                          <div className={styles.outputSectionHeader}>
                            {runResult.success ? '✓ Stdout Output:' : '✗ Execution Error:'}
                          </div>
                          <pre className={styles.consoleTerminal}>
                            {runResult.output || runResult.error || '(no stdout output)'}
                          </pre>
                        </div>
                      )}

                      {submitResult && (
                        <div className={styles.outputSection}>
                          <div className={styles.outputSectionHeader}>
                            Evaluation Summary ({submitResult.passedCases}/{submitResult.totalCases} passed):
                          </div>
                          <pre className={styles.consoleTerminal}>
                            {submitResult.compileOutput || submitResult.runOutput || 'All test cases passed.'}
                          </pre>
                        </div>
                      )}

                      {!runResult && !submitResult && (
                        <div className={styles.consolePlaceholder}>
                          No raw terminal output generated yet.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className={styles.noProblemSelected}>
              <h3>No problem selected or loaded.</h3>
            </div>
          )}
        </main>
      </div>

      {/* ── Confirm Submit Modal ──────────────────────────────────────────── */}
      {confirmModalOpen && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <span className={styles.modalTitle}>Confirm Solution Submission</span>
              <button className={styles.modalCloseBtn} onClick={() => setConfirmModalOpen(false)}>
                ×
              </button>
            </div>
            <div className={styles.modalBody}>
              <p>
                Submit your solution for{' '}
                <strong>
                  Problem #{selectedIndex + 1}: {currentProblem?.title}
                </strong>
                ?
              </p>
              <p style={{ fontSize: 'var(--font-size-micro)', color: 'var(--admin-text-muted)' }}>
                Your code will be evaluated against all sample and hidden server test cases. Once passed, Problem #{selectedIndex + 2} will be automatically unlocked!
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
