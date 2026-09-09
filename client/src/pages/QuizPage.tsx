import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { useTimer } from '../hooks/useTimer';
import { useConnectionStatus } from '../hooks/useConnectionStatus';
import { getSocket } from '../services/socket';
import api from '../services/api';
import ConnectionBadge from '../components/ConnectionBadge';
import SlidingPuzzle from '../components/SlidingPuzzle';
import TechShuffle from '../components/TechShuffle';
import styles from './QuizPage.module.css';

// ─── Types ───────────────────────────────────────────────────────────────────

interface EventData {
  id: string;
  type: string;
  name: string;
  status: string;
  startTime: string;
  endTime: string;
  version: number;
  durationSeconds?: number;
  currentRound: number;
  round1Status: string;
  round2Status: string;
  isQualifiedForRound2: boolean;
  locked?: boolean;
  reason?: string;
  hasQualifications?: boolean;
  qualification?: {
    isQualified: boolean;
    round1Score: number;
    round1Rank: number;
    round2Score: number;
    finalScore: number;
    finalRank: number;
  } | null;
}

interface Challenge {
  id: string;
  round: number;
  type: string;
  title: string;
  subtitle: string;
  description: string;
  order: number;
  points: number;
  timeLimit: number;
  config: Record<string, unknown>;
  questionCount: number;
  isActive?: boolean;
  isLocked?: boolean;
  progress: {
    answered: number;
    isCompleted: boolean;
  };
}

interface Question {
  id: string;
  challengeId?: string;
  round: number;
  category: string;
  type: string;
  question: string;
  imageUrl?: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  points: number;
  order: number;
}

interface AnswerRecord {
  questionId: string;
  selectedAnswer: string;
  isCorrect?: boolean;
  pointsAwarded?: number;
  round: number;
}

export default function QuizPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const connectionStatus = useConnectionStatus();

  // Event & Rounds state
  const [event, setEvent] = useState<EventData | null>(null);
  const [eventVersion, setEventVersion] = useState(0);

  // Challenges & Questions
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [activeChallengeId, setActiveChallengeId] = useState<string>('');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);

  // Student Answers & Submissions
  const [answers, setAnswers] = useState<Record<string, AnswerRecord>>({});
  const [selectedOption, setSelectedOption] = useState<string>('');
  const [shuffleOrder, setShuffleOrder] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [puzzleCompleted, setPuzzleCompleted] = useState(false);

  const isEventRunning = event?.status === 'RUNNING';
  const { formatted: timeFormatted, remaining } = useTimer(isEventRunning ? event?.endTime : null);

  // ── 1. Fetch current event & check state ──────────────────────────────────
  const loadCurrentEvent = useCallback(async () => {
    try {
      const res = await api.get<{
        event: EventData | null;
        locked?: boolean;
        reason?: string;
      }>('/current-event');

      const cur = res.data.event;
      const isLocked =
        res.data.locked ||
        cur?.locked ||
        (cur?.type === 'TECHNICAL_QUIZ' &&
          cur?.round1Status === 'FINISHED' &&
          !cur?.isQualifiedForRound2);

      if (!cur) {
        navigate('/waiting');
        return;
      }

      if (isLocked) {
        navigate('/waiting');
        return;
      }

      if (cur.type === 'DEBUGGING') {
        navigate('/debugging');
        return;
      }

      if (
        cur.type === 'TECHNICAL_QUIZ' &&
        cur.round1Status === 'FINISHED' &&
        cur.isQualifiedForRound2 &&
        cur.round2Status !== 'RUNNING'
      ) {
        navigate('/waiting');
        return;
      }

      setEvent(cur);
      setEventVersion(cur.version);

      const socket = getSocket();
      socket.emit('join:event', cur.id);
    } catch {
      navigate('/');
    }
  }, [navigate]);

  useEffect(() => {
    loadCurrentEvent();
  }, [loadCurrentEvent]);

  // ── 2. Socket.IO live updates ───────────────────────────────────────────
  useEffect(() => {
    const socket = getSocket();

    function handleStateChange(data: {
      eventId: string;
      status: string;
      endTime: string;
      version: number;
      currentRound?: number;
      round1Status?: string;
      round2Status?: string;
      type?: string;
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
              currentRound: data.currentRound || prev.currentRound,
              round1Status: data.round1Status || prev.round1Status,
              round2Status: data.round2Status || prev.round2Status,
              version: data.version,
            }
          : prev
      );

      // Transition check
      if (data.type === 'DEBUGGING') {
        navigate('/debugging');
      }
    }

    async function handleReconnect() {
      if (!event) return;
      await loadCurrentEvent();
      socket.emit('join:event', event.id);
    }

    socket.on('event.state_changed', handleStateChange);
    socket.on('connect', handleReconnect);

    return () => {
      socket.off('event.state_changed', handleStateChange);
      socket.off('connect', handleReconnect);
    };
  }, [event, eventVersion, loadCurrentEvent, navigate]);

  // ── 3. Fetch challenges for current active round ─────────────────────────
  const activeRound = event?.currentRound || 1;

  const loadChallengesAndAnswers = useCallback(async () => {
    if (!event) return;

    try {
      const cRes = await api.get<{ challenges: Challenge[] }>(
        `/events/${event.id}/quiz-challenges?round=${activeRound}`
      );
      setChallenges(cRes.data.challenges);

      if (cRes.data.challenges.length > 0 && !activeChallengeId) {
        setActiveChallengeId(cRes.data.challenges[0].id);
      }

      const aRes = await api.get<{ answers: AnswerRecord[] }>(
        `/events/${event.id}/my-answers?round=${activeRound}`
      );
      const aMap: Record<string, AnswerRecord> = {};
      aRes.data.answers.forEach((a) => {
        aMap[a.questionId] = a;
      });
      setAnswers(aMap);

      const pzRes = await api.get<{ puzzle: { isSolved: boolean } | null }>(
        `/events/${event.id}/my-puzzle`
      );
      setPuzzleCompleted(!!pzRes.data.puzzle?.isSolved);
    } catch {
      // Ignore
    }
  }, [event, activeRound, activeChallengeId]);

  useEffect(() => {
    if (event) {
      loadChallengesAndAnswers();
    }
  }, [event, activeRound, loadChallengesAndAnswers]);

  // ── 4. Fetch questions for active challenge ──────────────────────────────
  const currentChallenge = useMemo(() => {
    return challenges.find((c) => c.id === activeChallengeId) || challenges[0];
  }, [challenges, activeChallengeId]);

  useEffect(() => {
    if (!event || !currentChallenge || currentChallenge.type === 'PUZZLE_GRID') {
      setQuestions([]);
      setQuestionIndex(0);
      return;
    }

    async function fetchQuestions() {
      try {
        const res = await api.get<{ questions: Question[] }>(
          `/events/${event!.id}/quiz-questions?challengeId=${currentChallenge!.id}&round=${activeRound}`
        );
        setQuestions(res.data.questions);
        setQuestionIndex(0);
      } catch {
        setQuestions([]);
      }
    }

    fetchQuestions();
  }, [event, currentChallenge, activeRound]);

  const currentQuestion = questions[questionIndex];
  const currentAnswer = currentQuestion ? answers[currentQuestion.id] : undefined;

  // Initialize selected option or shuffle order when question changes
  useEffect(() => {
    if (!currentQuestion) {
      setSelectedOption('');
      setShuffleOrder([]);
      return;
    }

    const prevAnswer = answers[currentQuestion.id];
    if (prevAnswer) {
      setSelectedOption(prevAnswer.selectedAnswer);
      if (currentQuestion.type === 'SHUFFLE_ORDER') {
        try {
          setShuffleOrder(JSON.parse(prevAnswer.selectedAnswer));
        } catch {
          setShuffleOrder([
            currentQuestion.optionA,
            currentQuestion.optionB,
            currentQuestion.optionC,
            currentQuestion.optionD,
          ].filter(Boolean));
        }
      }
    } else {
      setSelectedOption('');
      if (currentQuestion.type === 'SHUFFLE_ORDER') {
        setShuffleOrder([
          currentQuestion.optionA,
          currentQuestion.optionB,
          currentQuestion.optionC,
          currentQuestion.optionD,
        ].filter(Boolean));
      }
    }
  }, [currentQuestion, answers]);

  // ── 5. Submit Question Answer ────────────────────────────────────────────
  async function handleSubmitAnswer(choiceOverride?: string) {
    if (!event || !currentQuestion || !isEventRunning) return;

    let answerToSubmit = choiceOverride || selectedOption;
    if (currentQuestion.type === 'SHUFFLE_ORDER') {
      answerToSubmit = JSON.stringify(shuffleOrder);
    }

    if (!answerToSubmit) return;

    setSubmitting(true);
    try {
      const res = await api.post<{ answer: AnswerRecord }>(`/events/${event.id}/answers`, {
        questionId: currentQuestion.id,
        selectedAnswer: answerToSubmit,
      });

      setAnswers((prev) => ({ ...prev, [currentQuestion.id]: res.data.answer }));
      loadChallengesAndAnswers();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Failed to submit answer';
      alert(msg);
    } finally {
      setSubmitting(false);
    }
  }

  // ── 6. Handle Puzzle Complete ────────────────────────────────────────────
  async function handlePuzzleComplete(result: {
    moves: number;
    timeTakenSeconds: number;
    isSolved: boolean;
    initialState: string;
  }) {
    if (!event || !currentChallenge) return;
    try {
      await api.post(`/events/${event.id}/puzzle-submit`, {
        challengeId: currentChallenge.id,
        moves: result.moves,
        timeTakenSeconds: result.timeTakenSeconds,
        isSolved: result.isSolved,
        initialState: result.initialState,
      });
      setPuzzleCompleted(true);
      loadChallengesAndAnswers();
    } catch {
      // Ignore
    }
  }

  // ── 7. Challenge-Specific Theme Rendering ─────────────────────────────────
  const renderChallengeHeader = () => {
    if (!currentChallenge) return null;

    switch (currentChallenge.type) {
      case 'RAPID_FIRE':
        return (
          <div className={`${styles.challengeBanner} ${styles.bannerRapidFire}`}>
            <span>⚡ RAPID FIRE — Speed &amp; Accuracy Round</span>
            <span>{currentChallenge.points} pts max</span>
          </div>
        );
      case 'GUESS_THE_TECH':
        return (
          <div className={`${styles.challengeBanner} ${styles.bannerGuessTech}`}>
            <span>🔍 GUESS THE TECH — Analyze Clues &amp; Architecture</span>
            <span>{currentChallenge.points} pts max</span>
          </div>
        );
      case 'TECH_SHUFFLE':
        return (
          <div className={`${styles.challengeBanner} ${styles.bannerTechShuffle}`}>
            <span>🔀 TECH SHUFFLE — Reorder The Sequence Workflow</span>
            <span>{currentChallenge.points} pts max</span>
          </div>
        );
      case 'PUZZLE_GRID':
        return (
          <div className={`${styles.challengeBanner} ${styles.bannerPuzzleGrid}`}>
            <span>🧩 PUZZLE GRID — 3x3 Neural Processor Matrix</span>
            <span>{currentChallenge.points} pts max</span>
          </div>
        );
      case 'TECH_SHOWDOWN':
        return (
          <div className={`${styles.challengeBanner} ${styles.bannerTechShowdown}`}>
            <span>⚔️ TECH SHOWDOWN — Head-to-Head Architectural Duel</span>
            <span>{currentChallenge.points} pts max</span>
          </div>
        );
      case 'TECH_TODAY':
        return (
          <div className={`${styles.challengeBanner} ${styles.bannerTechToday}`}>
            <span>📰 TECH TODAY — Modern Frameworks &amp; Real-World Tech</span>
            <span>{currentChallenge.points} pts max</span>
          </div>
        );
      case 'REAL_OR_FAKE':
        return (
          <div className={`${styles.challengeBanner} ${styles.bannerRealOrFake}`}>
            <span>🎭 REAL OR FAKE — Tech Fact vs AI Hallucination</span>
            <span>{currentChallenge.points} pts max</span>
          </div>
        );
      case 'FINAL_CHALLENGE':
        return (
          <div className={`${styles.challengeBanner} ${styles.bannerFinalChallenge}`}>
            <span>👑 FINAL CHALLENGE — Championship Decider</span>
            <span>{currentChallenge.points} pts max</span>
          </div>
        );
      default:
        return (
          <div className={styles.challengeBanner}>
            <span>⚡ {currentChallenge.title}</span>
            <span>{currentChallenge.points} pts max</span>
          </div>
        );
    }
  };

  // ── 8. Render Intermission / Not Qualified Screen ─────────────────────────
  if (activeRound === 2 && event && !event.isQualifiedForRound2) {
    return (
      <div className={styles.page}>
        <header className={styles.topbar}>
          <div className={styles.topbarLeft}>
            <span className={styles.brandTitle}>
              <span>⚡ SASI</span>
              <span>// TECHNICAL QUIZ</span>
            </span>
          </div>
          <div className={styles.topbarRight}>
            <ConnectionBadge status={connectionStatus} />
            <button className={styles.logoutBtn} onClick={logout}>
              Logout
            </button>
          </div>
        </header>

        <div className={styles.standbyCard}>
          <div className={styles.standbyIcon}>🏁</div>
          <h2 className={styles.standbyTitle}>Round 1 Completed!</h2>
          <p className={styles.standbyMsg}>
            Thank you for participating in the SASI Engineers' Day Technical Quiz.
          </p>
          <div className={styles.standbyBadge}>
            <span>🔒 Round 2 Championship is reserved for Top 10 Qualifiers</span>
          </div>
          <button
            className={styles.logoutBtn}
            style={{ padding: '0.5rem 1.25rem', marginTop: '0.5rem' }}
            onClick={() => window.location.reload()}
          >
            ↻ Refresh Status
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* ── Persistent Top Bar ────────────────────────────────────────────── */}
      <header className={styles.topbar}>
        <div className={styles.topbarLeft}>
          <span className={styles.brandTitle}>
            <span>⚡ SASI</span>
            <span>// TECHNICAL QUIZ</span>
          </span>
          <span className={styles.eventPill}>
            {isEventRunning && <span className={styles.liveDot} />}
            <span>{event?.status || 'STANDBY'}</span>
          </span>
          <span className={styles.roundPill}>
            {activeRound === 1 ? 'Round 1: Qualifiers' : 'Round 2: Championship (Top 10)'}
          </span>
        </div>

        <div className={styles.topbarCenter}>
          <div className={styles.timerBlock}>
            <span className={styles.timerLabel}>Time:</span>
            <span
              className={`${styles.timerValue} ${
                isEventRunning && remaining < 300 ? styles.timerValueUrgent : ''
              }`}
            >
              {isEventRunning ? timeFormatted : `${Math.floor((event?.durationSeconds || 1800) / 60)}:00`}
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
        {/* ── Left Sidebar: Challenge Stages ──────────────────────────────── */}
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <span className={styles.sidebarTitle}>Challenge Stages</span>
            <span className={styles.sidebarSub}>Round {activeRound}</span>
          </div>

          <nav className={styles.challengeNav}>
            {challenges.map((c) => {
              const isActive = c.id === activeChallengeId;
              const isDone = c.progress.isCompleted || (c.type === 'PUZZLE_GRID' && puzzleCompleted);

              return (
                <button
                  key={c.id}
                  type="button"
                  className={`${styles.challengeBtn} ${isActive ? styles.challengeBtnActive : ''} ${
                    isDone ? styles.challengeBtnDone : ''
                  }`}
                  onClick={() => {
                    setActiveChallengeId(c.id);
                  }}
                  disabled={c.isLocked}
                >
                  <div className={styles.challengeBtnTop}>
                    <span className={styles.challengeTitle}>{c.title}</span>
                    <span className={styles.statusPill}>
                      {isDone ? '✓ Completed' : isActive ? '● Active' : `${c.points} pts`}
                    </span>
                  </div>
                  <div className={styles.challengeSubtitle}>{c.subtitle || c.description}</div>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* ── Main Stage Area ─────────────────────────────────────────────── */}
        <main className={styles.main}>
          {!isEventRunning && (
            <div className={styles.statusNotice}>
              {event?.status === 'PAUSED' && '⏸ Technical Quiz is paused by Admin. Stand by...'}
              {event?.status === 'READY' && '🕐 Round is ready to start. Get ready!'}
              {event?.status === 'FINISHED' &&
                '🏁 Round has ended. The admin will verify results shortly.'}
              {event?.status === 'DRAFT' && '🕐 Competition is being initialized.'}
            </div>
          )}

          {/* 1. Puzzle Challenge Display */}
          {currentChallenge?.type === 'PUZZLE_GRID' && (
            <section className={styles.gameSection} key={currentChallenge.id}>
              {renderChallengeHeader()}
              <SlidingPuzzle
                challengeId={currentChallenge.id}
                points={currentChallenge.points}
                timeLimit={currentChallenge.timeLimit}
                config={currentChallenge.config as { title?: string; image?: string; shuffleMoves?: number }}
                onComplete={handlePuzzleComplete}
                isReadOnly={!isEventRunning}
              />
            </section>
          )}

          {/* 2. Interactive Questions Display */}
          {currentChallenge?.type !== 'PUZZLE_GRID' && currentQuestion && (
            <section className={styles.gameSection} key={currentQuestion.id}>
              {renderChallengeHeader()}

              <div className={styles.questionHeader}>
                <div className={styles.questionMeta}>
                  <span className={styles.categoryBadge}>{currentQuestion.category}</span>
                  <span className={styles.stageProgress}>
                    Question {questionIndex + 1} of {questions.length}
                  </span>
                </div>
                <span className={styles.pointsBadge}>{currentQuestion.points} pts</span>
              </div>

              {/* Visual image if provided */}
              {currentQuestion.imageUrl && (
                <div className={styles.imageContainer}>
                  <img
                    src={currentQuestion.imageUrl}
                    alt="Visual Clue"
                    className={styles.questionImage}
                  />
                </div>
              )}

              {/* Question Text */}
              <h2 className={styles.questionPrompt}>{currentQuestion.question}</h2>

              {/* Input Type Variants */}
              {currentQuestion.type === 'SHUFFLE_ORDER' ? (
                /* Tech Shuffle Sequence Sorter */
                <TechShuffle
                  items={[
                    currentQuestion.optionA,
                    currentQuestion.optionB,
                    currentQuestion.optionC,
                    currentQuestion.optionD,
                  ].filter(Boolean)}
                  initialOrder={shuffleOrder}
                  onOrderChange={(newOrder) => setShuffleOrder(newOrder)}
                  disabled={!isEventRunning || submitting}
                />
              ) : currentQuestion.type === 'REAL_OR_FAKE' ? (
                /* Real or Fake Big 2-Button Choice */
                <div className={styles.realFakeGrid}>
                  {['REAL', 'FAKE'].map((choice) => {
                    const isSelected = selectedOption === choice;
                    return (
                      <button
                        key={choice}
                        type="button"
                        className={`${styles.realFakeBtn} ${
                          choice === 'REAL' ? styles.realBtn : styles.fakeBtn
                        } ${isSelected ? styles.realFakeSelected : ''}`}
                        onClick={() => {
                          setSelectedOption(choice);
                          handleSubmitAnswer(choice);
                        }}
                        disabled={!isEventRunning || submitting}
                      >
                        <span className={styles.rfIcon}>{choice === 'REAL' ? '🟢' : '🔴'}</span>
                        <span>{choice}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                /* Standard Multiple Choice (A, B, C, D) */
                <div className={styles.optionsGrid}>
                  {[
                    { key: 'A', text: currentQuestion.optionA },
                    { key: 'B', text: currentQuestion.optionB },
                    { key: 'C', text: currentQuestion.optionC },
                    { key: 'D', text: currentQuestion.optionD },
                  ]
                    .filter((opt) => !!opt.text)
                    .map((opt) => {
                      const isSelected = selectedOption === opt.key;

                      return (
                        <button
                          key={opt.key}
                          type="button"
                          className={`${styles.optionCard} ${isSelected ? styles.optionSelected : ''}`}
                          onClick={() => {
                            if (isEventRunning) {
                              setSelectedOption(opt.key);
                              handleSubmitAnswer(opt.key);
                            }
                          }}
                          disabled={!isEventRunning || submitting}
                        >
                          <span className={styles.optKey}>{opt.key}</span>
                          <span className={styles.optText}>{opt.text}</span>
                        </button>
                      );
                    })}
                </div>
              )}

              {/* Bottom Question Controls */}
              <div className={styles.questionFooter}>
                <button
                  type="button"
                  className={styles.navBtn}
                  disabled={questionIndex === 0}
                  onClick={() => setQuestionIndex((i) => i - 1)}
                >
                  ← Previous
                </button>

                <div>
                  {currentAnswer ? (
                    <span className={styles.savedStatus}>✓ Answer Saved</span>
                  ) : (
                    <span className={styles.unansweredStatus}>Select an answer to record</span>
                  )}
                </div>

                <button
                  type="button"
                  className={styles.navBtn}
                  disabled={questionIndex === questions.length - 1}
                  onClick={() => setQuestionIndex((i) => i + 1)}
                >
                  Next →
                </button>
              </div>

              {/* Direct Question Index Selector */}
              <div className={styles.indexGrid}>
                {questions.map((q, idx) => {
                  const hasAnswered = !!answers[q.id];
                  const isCurrent = idx === questionIndex;
                  return (
                    <button
                      key={q.id}
                      type="button"
                      className={`${styles.idxBtn} ${isCurrent ? styles.idxCurrent : ''} ${
                        hasAnswered ? styles.idxAnswered : ''
                      }`}
                      onClick={() => setQuestionIndex(idx)}
                    >
                      {idx + 1}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {currentChallenge?.type !== 'PUZZLE_GRID' && questions.length === 0 && (
            <div className={styles.standbyCard}>
              <h3 className={styles.standbyTitle}>No questions configured for this challenge stage yet.</h3>
              <p className={styles.standbyMsg}>Please select another challenge from the left sidebar.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
