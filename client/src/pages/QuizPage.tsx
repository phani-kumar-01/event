import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { useTimer } from '../hooks/useTimer';
import { useConnectionStatus } from '../hooks/useConnectionStatus';
import { getSocket } from '../services/socket';
import api from '../services/api';
import ConnectionBadge from '../components/ConnectionBadge';
import styles from './QuizPage.module.css';

interface Event {
  id: string;
  type: string;
  name: string;
  status: string;
  startTime: string;
  endTime: string;
  version: number;
}

interface Question {
  id: string;
  question: string;
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
  isCorrect: boolean;
  pointsAwarded: number;
  explanation?: string;
}

type Option = 'A' | 'B' | 'C' | 'D';

export default function QuizPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const connectionStatus = useConnectionStatus();

  const [event, setEvent] = useState<Event | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, AnswerRecord>>({});
  const [selectedOption, setSelectedOption] = useState<Option | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [eventVersion, setEventVersion] = useState(0);
  const [showResult, setShowResult] = useState(false);

  const { formatted: timeFormatted, remaining } = useTimer(event?.status === 'RUNNING' ? event.endTime : null);

  // ── Fetch event + questions ────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      try {
        const res = await api.get<{ event: Event | null }>('/current-event');
        const cur = res.data.event;

        if (!cur) { navigate('/waiting'); return; }
        if (cur.type !== 'TECHNICAL_QUIZ') { navigate('/debugging'); return; }

        setEvent(cur);
        setEventVersion(cur.version);

        const qRes = await api.get<{ questions: Question[] }>(`/events/${cur.id}/quiz-questions`);
        setQuestions(qRes.data.questions);

        const aRes = await api.get<{ answers: AnswerRecord[] }>(`/events/${cur.id}/my-answers`);
        const aMap: Record<string, AnswerRecord> = {};
        aRes.data.answers.forEach((a) => { aMap[a.questionId] = a; });
        setAnswers(aMap);

        // Set selected for first unanswered question
        const firstUnanswered = qRes.data.questions.findIndex((q) => !aMap[q.id]);
        if (firstUnanswered >= 0) setCurrentIndex(firstUnanswered);

        const socket = getSocket();
        socket.emit('join:event', cur.id);
      } catch {
        navigate('/');
      }
    }
    load();
  }, [navigate]);

  // ── Socket.IO: state changes ───────────────────────────────────────────
  useEffect(() => {
    const socket = getSocket();

    function handleStateChange(data: {
      eventId: string;
      status: string;
      endTime: string;
      version: number;
    }) {
      if (!event || data.eventId !== event.id) return;
      if (data.version <= eventVersion) return;
      setEventVersion(data.version);
      setEvent((prev) => prev ? { ...prev, status: data.status, endTime: data.endTime } : prev);
    }

    async function handleReconnect() {
      if (!event) return;
      try {
        const res = await api.get<{ event: Event }>(`/events/${event.id}`);
        setEvent(res.data.event);
        setEventVersion(res.data.event.version);
        socket.emit('join:event', event.id);
      } catch { /* ignore */ }
    }

    socket.on('event.state_changed', handleStateChange);
    socket.on('connect', handleReconnect);
    return () => {
      socket.off('event.state_changed', handleStateChange);
      socket.off('connect', handleReconnect);
    };
  }, [event, eventVersion]);

  // ── Load previous answer when navigating between questions ────────────
  useEffect(() => {
    const q = questions[currentIndex];
    if (q && answers[q.id]) {
      setSelectedOption(answers[q.id].selectedAnswer as Option);
    } else {
      setSelectedOption(null);
    }
    setShowResult(false);
  }, [currentIndex, questions, answers]);

  async function handleSubmitAnswer() {
    const q = questions[currentIndex];
    if (!q || !selectedOption || !event || event.status !== 'RUNNING') return;
    setSubmitting(true);
    try {
      const res = await api.post<{ answer: AnswerRecord }>(`/events/${event.id}/answers`, {
        questionId: q.id,
        selectedAnswer: selectedOption,
      });
      setAnswers((prev) => ({ ...prev, [q.id]: res.data.answer }));
      setShowResult(true);
    } catch (err: unknown) {
      alert((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  }

  const currentQuestion = questions[currentIndex];
  const currentAnswer = currentQuestion ? answers[currentQuestion.id] : undefined;
  const eventActive = event?.status === 'RUNNING';
  const totalAnswered = Object.keys(answers).length;
  const totalPoints = Object.values(answers).reduce((s, a) => s + a.pointsAwarded, 0);

  const options: { key: Option; label: string }[] = [
    { key: 'A', label: currentQuestion?.optionA || '' },
    { key: 'B', label: currentQuestion?.optionB || '' },
    { key: 'C', label: currentQuestion?.optionC || '' },
    { key: 'D', label: currentQuestion?.optionD || '' },
  ];

  return (
    <div className={styles.page}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.siteTitle}>SASI Engineers' Day</h1>
          <span className={styles.eventBadge}>Technical Quiz</span>
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
          <button className={styles.logoutBtn} onClick={logout}>Logout</button>
        </div>
      </header>

      <div className={styles.layout}>
        {/* Question navigator sidebar */}
        <aside className={styles.sidebar}>
          <div className={styles.scoreBox}>
            <div className={styles.scoreLabel}>Score</div>
            <div className={styles.scoreValue}>{totalPoints} pts</div>
            <div className={styles.scoreProgress}>{totalAnswered}/{questions.length} answered</div>
          </div>
          <div className={styles.questionGrid}>
            {questions.map((q, i) => (
              <button
                key={q.id}
                className={`${styles.gridBtn} ${i === currentIndex ? styles.gridBtnActive : ''} ${
                  answers[q.id]
                    ? answers[q.id].isCorrect
                      ? styles.gridBtnCorrect
                      : styles.gridBtnWrong
                    : ''
                }`}
                onClick={() => setCurrentIndex(i)}
              >
                {i + 1}
              </button>
            ))}
          </div>
        </aside>

        {/* Question Panel */}
        <main className={styles.main}>
          {!eventActive && (
            <div className={styles.notRunning}>
              {event?.status === 'PAUSED' && '⏸ Quiz is paused. Please wait...'}
              {event?.status === 'READY' && '🕐 Quiz has not started yet.'}
              {event?.status === 'FINISHED' && '🏁 Quiz has ended. Final Score: ' + totalPoints + ' points'}
              {event?.status === 'DRAFT' && '🕐 Quiz is being prepared.'}
            </div>
          )}

          {currentQuestion && (
            <div className={styles.questionCard}>
              <div className={styles.questionMeta}>
                <span className={styles.questionNum}>Question {currentIndex + 1} of {questions.length}</span>
                <span className={styles.questionPts}>{currentQuestion.points} pts</span>
              </div>

              <p className={styles.questionText}>{currentQuestion.question}</p>

              <div className={styles.options}>
                {options.map(({ key, label }) => {
                  const isSelected = selectedOption === key;
                  const isSubmitted = !!currentAnswer;
                  const isCorrectOption = isSubmitted && currentAnswer.isCorrect && currentAnswer.selectedAnswer === key;
                  const isWrongOption = isSubmitted && !currentAnswer.isCorrect && currentAnswer.selectedAnswer === key;

                  return (
                    <button
                      key={key}
                      className={`${styles.option} ${isSelected ? styles.optionSelected : ''} ${
                        isCorrectOption ? styles.optionCorrect : ''
                      } ${isWrongOption ? styles.optionWrong : ''}`}
                      onClick={() => {
                        if (!isSubmitted && eventActive) setSelectedOption(key);
                      }}
                      disabled={isSubmitted || !eventActive}
                    >
                      <span className={styles.optionKey}>{key}</span>
                      <span className={styles.optionLabel}>{label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Explanation after answer */}
              {showResult && currentAnswer && currentAnswer.explanation && (
                <div className={`${styles.explanation} ${currentAnswer.isCorrect ? styles.explanationCorrect : styles.explanationWrong}`}>
                  <strong>{currentAnswer.isCorrect ? '✓ Correct!' : '✗ Incorrect.'}</strong>
                  {' '}{currentAnswer.explanation}
                </div>
              )}

              <div className={styles.questionActions}>
                <button
                  className={styles.prevBtn}
                  disabled={currentIndex === 0}
                  onClick={() => setCurrentIndex((i) => i - 1)}
                >
                  ← Previous
                </button>

                {!currentAnswer && (
                  <button
                    className={styles.submitAnswerBtn}
                    disabled={!selectedOption || submitting || !eventActive}
                    onClick={handleSubmitAnswer}
                  >
                    {submitting ? 'Submitting...' : 'Submit Answer'}
                  </button>
                )}

                {currentAnswer && (
                  <span className={`${styles.answeredBadge} ${currentAnswer.isCorrect ? styles.correct : styles.wrong}`}>
                    {currentAnswer.isCorrect ? '✓ Correct' : '✗ Wrong'}
                  </span>
                )}

                <button
                  className={styles.nextBtn}
                  disabled={currentIndex === questions.length - 1}
                  onClick={() => setCurrentIndex((i) => i + 1)}
                >
                  Next →
                </button>
              </div>
            </div>
          )}

          {questions.length === 0 && (
            <div className={styles.empty}>No questions available yet.</div>
          )}
        </main>
      </div>
    </div>
  );
}
