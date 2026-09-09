import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '../state/AuthContext';
import { useConnectionStatus } from '../hooks/useConnectionStatus';
import { useTimer } from '../hooks/useTimer';
import { getSocket } from '../services/socket';
import api from '../services/api';
import ConnectionBadge from '../components/ConnectionBadge';
import sasiLogo from '../assets/branding/sasi-logo.png';
import eliteLogo from '../assets/branding/elite-logo.jpg';
import styles from './AdminPage.module.css';

// ─── Interfaces ──────────────────────────────────────────────────────────────

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
  version: number;
}

interface DebuggingProblem {
  id: string;
  title: string;
  description: string;
  buggyCode: string;
  expectedOutput: string;
  points: number;
  timeLimit: number;
  testCases?: Array<{ input: string; expectedOutput: string }>;
  eventId?: string;
}

interface QuizChallenge {
  id: string;
  title: string;
  subtitle?: string;
  description?: string;
  round: number;
  type: string;
  points: number;
  timeLimit?: number;
  timerMode?: string;
  timePerQuestionSec?: number;
  config?: string;
  isActive: boolean;
  orderIndex?: number;
}

interface QuizQuestion {
  id: string;
  challengeId?: string | null;
  round: number;
  category: string;
  type: string;
  question: string;
  imageUrl?: string;
  optionA?: string;
  optionB?: string;
  optionC?: string;
  optionD?: string;
  correctAnswer: string;
  correctSequence?: string;
  points: number;
  explanation?: string;
}

interface Qualification {
  id: string;
  round1Rank: number;
  round1Score: number;
  round1Time: number;
  round2Score: number;
  round2Time: number;
  finalRank?: number;
  finalScore?: number;
  isQualified: boolean;
  user: { rollNo: string; name: string };
}

interface Student {
  id: string;
  rollNo: string;
  name: string;
  createdAt: string;
}

type Tab = 'control_room' | 'leaderboard' | 'quiz_hub' | 'debugging' | 'students';
type LeaderboardFilter = 'active' | 'round1' | 'round2' | 'final' | 'debugging';

function getStageBadgeMeta(type: string): { icon: string; tintClass: string } {
  switch (type) {
    case 'RAPID_FIRE':
      return { icon: '⚡', tintClass: styles.badgeTintAmber };
    case 'GUESS_THE_TECH':
      return { icon: '🔍', tintClass: styles.badgeTintBlue };
    case 'TECH_SHUFFLE':
      return { icon: '🔀', tintClass: styles.badgeTintPurple };
    case 'PUZZLE_GRID':
      return { icon: '🧩', tintClass: styles.badgeTintGreen };
    case 'TECH_SHOWDOWN':
      return { icon: '⚔️', tintClass: styles.badgeTintRed };
    case 'TECH_TODAY':
      return { icon: '📰', tintClass: styles.badgeTintBlue };
    case 'REAL_OR_FAKE':
      return { icon: '⚖️', tintClass: styles.badgeTintAmber };
    case 'FINAL_CHALLENGE':
      return { icon: '🏆', tintClass: styles.badgeTintRed };
    default:
      return { icon: '🎯', tintClass: styles.badgeTintBlue };
  }
}

function getRecommendedQuestions(type: string): { min: number; label: string } {
  switch (type) {
    case 'RAPID_FIRE':
      return { min: 10, label: 'recommend 10+ for a 5 min stage' };
    case 'GUESS_THE_TECH':
      return { min: 8, label: 'recommend 8+ for a 5 min stage' };
    case 'TECH_SHUFFLE':
      return { min: 6, label: 'recommend 6+ for a 5 min stage' };
    case 'PUZZLE_GRID':
      return { min: 1, label: '3x3 sliding matrix' };
    case 'TECH_SHOWDOWN':
      return { min: 8, label: 'recommend 8+ for championship' };
    case 'TECH_TODAY':
      return { min: 8, label: 'recommend 8+ for contemporary tech' };
    case 'REAL_OR_FAKE':
      return { min: 10, label: 'recommend 10+ for rapid binary round' };
    case 'FINAL_CHALLENGE':
      return { min: 5, label: 'recommend 5+ for final decider' };
    default:
      return { min: 6, label: 'recommend 6+' };
  }
}

export default function AdminPage() {
  const { logout } = useAuth();
  const connectionStatus = useConnectionStatus();

  // Navigation tab state
  const [activeTab, setActiveTab] = useState<Tab>('control_room');
  const [leaderboardFilter, setLeaderboardFilter] = useState<LeaderboardFilter>('active');

  // Events state
  const [events, setEvents] = useState<Event[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [actionError, setActionError] = useState<string>('');
  const [actionSuccess, setActionSuccess] = useState<string>('');
  const [actionLoading, setActionLoading] = useState<boolean>(false);

  // Leaderboard data
  const [round1Leaderboard, setRound1Leaderboard] = useState<Qualification[]>([]);
  const [finalLeaderboard, setFinalLeaderboard] = useState<Qualification[]>([]);
  const [rawResults, setRawResults] = useState<Record<string, unknown[]>>({});
  const [sortField, setSortField] = useState<'rank' | 'score' | 'rollNo' | 'time'>('rank');
  const [sortAsc, setSortAsc] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Confirmation modal for Round 1 -> Round 2 Qualify
  const [qualifyModalOpen, setQualifyModalOpen] = useState<boolean>(false);
  const [qualifyPreviewList, setQualifyPreviewList] = useState<Qualification[]>([]);

  // Quiz Management
  const [challenges, setChallenges] = useState<QuizChallenge[]>([]);
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [selectedRoundFilter, setSelectedRoundFilter] = useState<number>(1);
  const [challengeModal, setChallengeModal] = useState<Partial<QuizChallenge> | null>(null);
  const [quizModal, setQuizModal] = useState<Partial<QuizQuestion> | null>(null);
  const [importStatus, setImportStatus] = useState<string>('');
  const [imageUploading, setImageUploading] = useState<boolean>(false);
  const [imageUploadError, setImageUploadError] = useState<string>('');
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [modalFormError, setModalFormError] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Debugging Management
  const [problems, setProblems] = useState<DebuggingProblem[]>([]);
  const [debugModal, setDebugModal] = useState<Partial<DebuggingProblem> | null>(null);

  // Students
  const [students, setStudents] = useState<Student[]>([]);
  const [studentModal, setStudentModal] = useState<boolean>(false);
  const [newStudent, setNewStudent] = useState({ rollNo: '', name: '', password: '' });

  // ── 1. Load Events ─────────────────────────────────────────────────────────
  const loadEvents = useCallback(async () => {
    try {
      const res = await api.get<{ events: Event[] }>('/admin/events');
      setEvents(res.data.events);
      if (res.data.events.length > 0 && !selectedEventId) {
        const active =
          res.data.events.find((e) => e.status === 'RUNNING' || e.status === 'PAUSED') ||
          res.data.events.find((e) => e.status === 'READY') ||
          res.data.events[0];
        setSelectedEventId(active.id);
      }
    } catch {
      // Ignore
    }
  }, [selectedEventId]);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const currentEvent = useMemo(() => {
    return (
      events.find((e) => e.id === selectedEventId) ||
      events.find((e) => e.status === 'RUNNING') ||
      events[0]
    );
  }, [events, selectedEventId]);

  const isLiveRunning = currentEvent?.status === 'RUNNING';
  const { formatted: timerFormatted, remaining: timerRemaining } = useTimer(
    isLiveRunning ? currentEvent?.endTime : null
  );

  // ── 2. Socket.IO Live Updates ──────────────────────────────────────────────
  const loadLeaderboards = useCallback(async () => {
    if (!currentEvent) return;
    try {
      const resultsRes = await api.get<{ results: Record<string, unknown[]> }>('/admin/results');
      setRawResults(resultsRes.data.results || {});

      if (currentEvent.type === 'TECHNICAL_QUIZ') {
        const [l1Res, l2Res] = await Promise.all([
          api.get<{ qualifications: Qualification[] }>(
            `/admin/events/${currentEvent.id}/round1-leaderboard`
          ).catch(() => ({ data: { qualifications: [] } })),
          api.get<{ rankings: Qualification[] }>(
            `/admin/events/${currentEvent.id}/final-leaderboard`
          ).catch(() => ({ data: { rankings: [] } })),
        ]);
        setRound1Leaderboard(l1Res.data.qualifications || []);
        setFinalLeaderboard(l2Res.data.rankings || []);
      }
    } catch {
      // Ignore
    }
  }, [currentEvent]);

  useEffect(() => {
    loadLeaderboards();
  }, [loadLeaderboards]);

  useEffect(() => {
    const socket = getSocket();
    if (currentEvent) {
      socket.emit('join:event', currentEvent.id);
    }
    socket.emit('join:admin');

    function handleStateChange() {
      loadEvents();
      loadLeaderboards();
    }

    socket.on('event.state_changed', handleStateChange);
    socket.on('event.round_changed', handleStateChange);
    socket.on('connect', () => {
      loadEvents();
      loadLeaderboards();
    });

    return () => {
      socket.off('event.state_changed', handleStateChange);
      socket.off('event.round_changed', handleStateChange);
    };
  }, [currentEvent, loadEvents, loadLeaderboards]);

  useEffect(() => {
    if (!isLiveRunning) return;
    const interval = setInterval(() => {
      loadLeaderboards();
    }, 4000);
    return () => clearInterval(interval);
  }, [isLiveRunning, loadLeaderboards]);

  // ── 3. Load Tab Data ───────────────────────────────────────────────────────
  const loadTabData = useCallback(async () => {
    try {
      if (activeTab === 'quiz_hub') {
        const [cRes, qRes] = await Promise.all([
          api.get<{ challenges: QuizChallenge[] }>('/admin/quiz-challenges'),
          api.get<{ questions: QuizQuestion[] }>(
            `/admin/quiz-questions?round=${selectedRoundFilter}`
          ),
        ]);
        setChallenges(cRes.data.challenges);
        setQuizQuestions(qRes.data.questions);
      } else if (activeTab === 'debugging') {
        const res = await api.get<{ problems: DebuggingProblem[] }>('/admin/debugging-problems');
        setProblems(res.data.problems);
      } else if (activeTab === 'students') {
        const res = await api.get<{ students: Student[] }>('/admin/students');
        setStudents(res.data.students);
      }
    } catch {
      // Ignore
    }
  }, [activeTab, selectedRoundFilter]);

  useEffect(() => {
    loadTabData();
    api.get<{ students: Student[] }>('/admin/students').then((r) => setStudents(r.data.students)).catch(() => {});
  }, [activeTab, loadTabData]);

  // ── 4. Unified Event Actions ───────────────────────────────────────────────
  async function handleEventAction(action: string, body?: Record<string, unknown>) {
    if (!currentEvent) return;
    setActionError('');
    setActionSuccess('');
    setActionLoading(true);

    try {
      const res = await api.post(`/admin/events/${currentEvent.id}/${action}`, body);
      if (res.data.event) {
        setEvents((prev) => prev.map((e) => (e.id === currentEvent.id ? res.data.event : e)));
      }
      setActionSuccess(`✓ Action completed: ${action.replace('-', ' ')}`);
      await loadEvents();
      await loadLeaderboards();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Action failed';
      setActionError(msg);
    } finally {
      setActionLoading(false);
    }
  }

  // ── 5. Open Qualify Preview Modal ──────────────────────────────────────────
  async function openQualifyModal() {
    if (!currentEvent) return;
    setActionError('');
    try {
      const res = await api.get<{ qualifications: Qualification[] }>(
        `/admin/events/${currentEvent.id}/round1-leaderboard`
      );
      if (res.data.qualifications && res.data.qualifications.length > 0) {
        setQualifyPreviewList(res.data.qualifications.slice(0, 10));
      } else {
        const qualRes = await api.post<{ qualifications: Qualification[] }>(
          `/admin/events/${currentEvent.id}/qualify-round1`,
          { topCount: 10 }
        );
        setQualifyPreviewList(qualRes.data.qualifications.filter((q) => q.isQualified));
      }
      setQualifyModalOpen(true);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Failed to prepare qualifiers preview';
      setActionError(msg);
    }
  }

  async function confirmQualifyRound1() {
    if (!currentEvent) return;
    setActionLoading(true);
    try {
      await api.post(`/admin/events/${currentEvent.id}/qualify-round1`, { topCount: 10 });
      setActionSuccess('✓ Top 10 Qualifiers successfully promoted and locked in for Round 2!');
      setQualifyModalOpen(false);
      await loadEvents();
      await loadLeaderboards();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Failed to lock in qualifiers';
      setActionError(msg);
    } finally {
      setActionLoading(false);
    }
  }

  // ── 6. Leaderboard Sorting and Filtering ───────────────────────────────────
  const activeLeaderboardData = useMemo(() => {
    let list: Array<{
      id: string;
      rank: number;
      rollNo: string;
      name: string;
      score: number;
      time: number;
      isQualified: boolean;
      statusText: string;
    }> = [];

    if (currentEvent?.type === 'TECHNICAL_QUIZ') {
      const isR2 =
        leaderboardFilter === 'round2' ||
        leaderboardFilter === 'final' ||
        (leaderboardFilter === 'active' && currentEvent.currentRound === 2);

      if (isR2 && finalLeaderboard.length > 0) {
        list = finalLeaderboard.map((q) => ({
          id: q.id,
          rank: q.finalRank || q.round1Rank,
          rollNo: q.user.rollNo,
          name: q.user.name,
          score: q.finalScore ?? q.round2Score ?? q.round1Score,
          time: (q.round2Time || 0) + (q.round1Time || 0),
          isQualified: q.isQualified,
          statusText: q.isQualified ? 'Round 2 Finalist' : 'Round 1 Only',
        }));
      } else if (round1Leaderboard.length > 0) {
        list = round1Leaderboard.map((q) => ({
          id: q.id,
          rank: q.round1Rank,
          rollNo: q.user.rollNo,
          name: q.user.name,
          score: q.round1Score,
          time: q.round1Time,
          isQualified: q.isQualified,
          statusText: q.isQualified ? 'Qualified Top 10' : 'Participant',
        }));
      } else {
        const raw = (rawResults['TECHNICAL_QUIZ'] as Array<Record<string, unknown>>) || [];
        list = raw.map((item, idx) => ({
          id: String(item.id || item.rollNo || idx),
          rank: Number(item.finalRank || item.round1Rank || idx + 1),
          rollNo: String(item.rollNo || ''),
          name: String(item.name || ''),
          score: Number(item.totalPoints || item.round1Score || 0),
          time: 0,
          isQualified: !!item.isQualified,
          statusText: item.isQualified ? 'Qualified' : 'Participant',
        }));
      }
    } else {
      const raw = (rawResults['DEBUGGING'] as Array<Record<string, unknown>>) || [];
      list = raw.map((item, idx) => ({
        id: String(item.id || item.rollNo || idx),
        rank: idx + 1,
        rollNo: String(item.rollNo || ''),
        name: String(item.name || ''),
        score: Number(item.totalPoints || 0),
        time: 0,
        isQualified: true,
        statusText: 'Active',
      }));
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (item) =>
          item.rollNo.toLowerCase().includes(q) || item.name.toLowerCase().includes(q)
      );
    }

    return list.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'score') cmp = b.score - a.score;
      else if (sortField === 'rollNo') cmp = a.rollNo.localeCompare(b.rollNo);
      else if (sortField === 'time') cmp = a.time - b.time;
      else cmp = a.rank - b.rank;

      return sortAsc ? cmp : -cmp;
    });
  }, [
    currentEvent,
    leaderboardFilter,
    round1Leaderboard,
    finalLeaderboard,
    rawResults,
    searchQuery,
    sortField,
    sortAsc,
  ]);

  // ── 7. Quiz & Debugging CRUD Handlers ─────────────────────────────────────
  async function saveChallenge() {
    if (!challengeModal) return;
    try {
      if (challengeModal.id) {
        await api.patch(`/admin/quiz-challenges/${challengeModal.id}`, challengeModal);
      } else {
        await api.post('/admin/quiz-challenges', challengeModal);
      }
      setChallengeModal(null);
      loadTabData();
    } catch {
      alert('Failed to save challenge');
    }
  }

  async function deleteChallenge(id: string) {
    if (!confirm('Are you sure you want to delete this challenge?')) return;
    try {
      await api.delete(`/admin/quiz-challenges/${id}`);
      loadTabData();
    } catch {
      alert('Failed to delete challenge');
    }
  }

  async function handleQuestionImageUpload(file: File) {
    if (!file) return;
    setImageUploadError('');
    setModalFormError('');
    setImageUploading(true);

    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
    if (!validTypes.includes(file.type.toLowerCase())) {
      setImageUploadError('Invalid format. Only JPG, PNG, and WEBP images are supported.');
      setImageUploading(false);
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setImageUploadError('File is too large. Maximum size is 5MB.');
      setImageUploading(false);
      return;
    }

    try {
      const formData = new FormData();
      formData.append('image', file);
      const res = await api.post<{ imageUrl: string }>('/admin/quiz-questions/upload-image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setQuizModal((prev) => (prev ? { ...prev, imageUrl: res.data.imageUrl } : prev));
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Failed to upload image. Please try again.';
      setImageUploadError(msg);
    } finally {
      setImageUploading(false);
    }
  }

  async function saveQuizQuestion() {
    if (!quizModal) return;
    setModalFormError('');
    setImageUploadError('');

    const targetChallenge = challenges.find((c) => c.id === quizModal.challengeId);
    const isGuessTheTech = targetChallenge?.type === 'GUESS_THE_TECH' || quizModal.type === 'GUESS_IMAGE';

    if (isGuessTheTech && (!quizModal.imageUrl || !quizModal.imageUrl.trim())) {
      setModalFormError('Image is required for GUESS_THE_TECH challenge questions. Please upload a clue image.');
      return;
    }

    const isShuffle = quizModal.type === 'SHUFFLE_ORDER' || quizModal.type === 'TECH_SHUFFLE';
    const payload: Partial<QuizQuestion> = { ...quizModal };

    if (isShuffle) {
      let seqArray: string[] = [quizModal.optionA, quizModal.optionB, quizModal.optionC, quizModal.optionD].filter(Boolean) as string[];
      if (quizModal.correctAnswer && quizModal.correctAnswer.startsWith('[')) {
        try {
          seqArray = JSON.parse(quizModal.correctAnswer);
        } catch {
          // ignore
        }
      }
      payload.correctAnswer = JSON.stringify(seqArray);
      payload.correctSequence = JSON.stringify(seqArray);
    }

    try {
      if (quizModal.id) {
        await api.patch(`/admin/quiz-questions/${quizModal.id}`, payload);
      } else {
        await api.post('/admin/quiz-questions', payload);
      }
      setQuizModal(null);
      setModalFormError('');
      loadTabData();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Failed to save question';
      setModalFormError(msg);
    }
  }

  async function deleteQuizQuestion(id: string) {
    if (!confirm('Are you sure you want to delete this question?')) return;
    try {
      await api.delete(`/admin/quiz-questions/${id}`);
      loadTabData();
    } catch {
      alert('Failed to delete question');
    }
  }

  async function handleImportExcel(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('round', String(selectedRoundFilter));
    try {
      setImportStatus('Importing...');
      const res = await api.post('/admin/quiz-questions/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setImportStatus(`Imported ${res.data.count} questions!`);
      loadTabData();
      setTimeout(() => setImportStatus(''), 4000);
    } catch {
      setImportStatus('Import failed');
    }
  }

  async function saveDebugProblem() {
    if (!debugModal) return;
    try {
      if (debugModal.id) {
        await api.patch(`/admin/debugging-problems/${debugModal.id}`, debugModal);
      } else {
        await api.post('/admin/debugging-problems', debugModal);
      }
      setDebugModal(null);
      loadTabData();
    } catch {
      alert('Failed to save problem');
    }
  }

  async function deleteDebugProblem(id: string) {
    if (!confirm('Delete this problem?')) return;
    try {
      await api.delete(`/admin/debugging-problems/${id}`);
      loadTabData();
    } catch {
      alert('Failed to delete problem');
    }
  }

  async function addStudent() {
    try {
      await api.post('/admin/students', newStudent);
      setStudentModal(false);
      setNewStudent({ rollNo: '', name: '', password: '' });
      loadTabData();
    } catch {
      alert('Failed to add student');
    }
  }

  async function deleteStudent(id: string) {
    if (!confirm('Delete student?')) return;
    try {
      await api.delete(`/admin/students/${id}`);
      loadTabData();
    } catch {
      alert('Failed to delete student');
    }
  }

  // ── 8. Single Action State Calculation ─────────────────────────────────────
  const isQuiz = currentEvent?.type === 'TECHNICAL_QUIZ';
  const hasQualifiersPromoted = round1Leaderboard.some((q) => q.isQualified);

  const renderSingleActionGroup = () => {
    if (!currentEvent) {
      return <span>Select an event to manage</span>;
    }

    // 1. DRAFT STATE
    if (currentEvent.status === 'DRAFT') {
      return (
        <button
          className={styles.btnPrimary}
          disabled={actionLoading}
          onClick={() => handleEventAction('ready')}
        >
          {actionLoading ? 'Updating...' : 'Set Event to Ready'}
        </button>
      );
    }

    // 2. READY STATE (Waiting to start)
    if (currentEvent.status === 'READY') {
      if (isQuiz) {
        return (
          <button
            className={styles.btnPrimary}
            disabled={actionLoading}
            onClick={() => handleEventAction('start-round1')}
          >
            {actionLoading ? 'Starting...' : '🚀 Start Round 1 (All Students)'}
          </button>
        );
      }
      return (
        <button
          className={styles.btnPrimary}
          disabled={actionLoading}
          onClick={() => handleEventAction('start')}
        >
          {actionLoading ? 'Starting...' : '🚀 Start Competition'}
        </button>
      );
    }

    // 3. RUNNING STATE
    if (currentEvent.status === 'RUNNING') {
      if (isQuiz) {
        if (currentEvent.currentRound === 1) {
          return (
            <div className={styles.primaryActionGroup}>
              <button
                className={styles.btnWarning}
                disabled={actionLoading}
                onClick={() => handleEventAction('pause-round1')}
              >
                ⏸ Pause Round 1
              </button>
              <button
                className={styles.btnDangerOutline}
                disabled={actionLoading}
                onClick={() => {
                  if (confirm('End Round 1 for all participants now?')) {
                    handleEventAction('end-round1');
                  }
                }}
              >
                ⏹ End Round 1
              </button>
            </div>
          );
        } else {
          return (
            <div className={styles.primaryActionGroup}>
              <button
                className={styles.btnWarning}
                disabled={actionLoading}
                onClick={() => handleEventAction('pause-round2')}
              >
                ⏸ Pause Round 2
              </button>
              <button
                className={styles.btnDangerOutline}
                disabled={actionLoading}
                onClick={() => {
                  if (confirm('End Round 2 and finalize Championship now?')) {
                    handleEventAction('end-round2');
                  }
                }}
              >
                ⏹ End Round 2
              </button>
            </div>
          );
        }
      } else {
        return (
          <div className={styles.primaryActionGroup}>
            <button
              className={styles.btnWarning}
              disabled={actionLoading}
              onClick={() => handleEventAction('pause')}
            >
              ⏸ Pause Competition
            </button>
            <button
              className={styles.btnDangerOutline}
              disabled={actionLoading}
              onClick={() => {
                if (confirm('End Debugging Arena competition now?')) {
                  handleEventAction('end');
                }
              }}
            >
              ⏹ End Competition
            </button>
          </div>
        );
      }
    }

    // 4. PAUSED STATE
    if (currentEvent.status === 'PAUSED') {
      if (isQuiz) {
        const isR1 = currentEvent.currentRound === 1;
        return (
          <div className={styles.primaryActionGroup}>
            <button
              className={styles.btnPrimary}
              disabled={actionLoading}
              onClick={() => handleEventAction(isR1 ? 'resume-round1' : 'resume-round2')}
            >
              ▶ Resume {isR1 ? 'Round 1' : 'Round 2'}
            </button>
            <button
              className={styles.btnDangerOutline}
              disabled={actionLoading}
              onClick={() => {
                if (confirm(`End ${isR1 ? 'Round 1' : 'Round 2'} now?`)) {
                  handleEventAction(isR1 ? 'end-round1' : 'end-round2');
                }
              }}
            >
              ⏹ End {isR1 ? 'Round 1' : 'Round 2'}
            </button>
          </div>
        );
      }
      return (
        <div className={styles.primaryActionGroup}>
          <button
            className={styles.btnPrimary}
            disabled={actionLoading}
            onClick={() => handleEventAction('resume')}
          >
            ▶ Resume Competition
          </button>
          <button
            className={styles.btnDangerOutline}
            disabled={actionLoading}
            onClick={() => {
              if (confirm('End competition now?')) {
                handleEventAction('end');
              }
            }}
          >
            ⏹ End Competition
          </button>
        </div>
      );
    }

    // 5. FINISHED / TRANSITION STATES (Quiz Round 1 Finished vs Round 2 Finished)
    if (isQuiz) {
      if (currentEvent.round1Status === 'FINISHED' && (!currentEvent.round2Status || currentEvent.round2Status === 'NOT_STARTED')) {
        if (!hasQualifiersPromoted) {
          return (
            <button
              className={styles.btnPrimary}
              disabled={actionLoading}
              onClick={openQualifyModal}
            >
              👑 Review &amp; Qualify Top 10 for Round 2
            </button>
          );
        } else {
          return (
            <div className={styles.primaryActionGroup}>
              <button
                className={styles.btnPrimary}
                disabled={actionLoading}
                onClick={() => handleEventAction('start-round2')}
              >
                🚀 Start Round 2 (Top 10 Qualifiers)
              </button>
              <button
                className={styles.btnSecondary}
                disabled={actionLoading}
                onClick={openQualifyModal}
              >
                Re-check Top 10
              </button>
            </div>
          );
        }
      }

      if (currentEvent.round2Status === 'FINISHED' || currentEvent.status === 'FINISHED') {
        return (
          <div className={styles.primaryActionGroup}>
            <button
              className={styles.btnPrimary}
              disabled={actionLoading}
              onClick={() => handleEventAction('compute-final-rankings')}
            >
              🏆 Compute Final Combined Rankings
            </button>
          </div>
        );
      }
    }

    // Default finished state
    return (
      <div className={styles.primaryActionGroup}>
        <span style={{ fontWeight: 600, color: 'var(--admin-text-muted)' }}>Event Concluded</span>
      </div>
    );
  };

  return (
    <div className={styles.page}>
      {/* ── Top Bar ──────────────────────────────────────────────────────── */}
      <header className={styles.topbar}>
        <div className={styles.topbarLeft}>
          <div className={styles.brandTitle}>
            <img
              src={sasiLogo}
              alt="SASI Institute of Technology & Engineering"
              className={styles.headerLogo}
            />
            <span className={styles.brandSlash}>/</span>
            <span className={styles.brandSubtext}>CONTROL ROOM</span>
          </div>
          {currentEvent && (
            <>
              <div
                className={`${styles.liveEventPill} ${
                  currentEvent.status === 'RUNNING' ? styles.liveEventPillActive : ''
                }`}
              >
                {currentEvent.status === 'RUNNING' && <span className={styles.liveDot} />}
                <span>
                  {currentEvent.type === 'DEBUGGING' ? 'C Debugging Arena' : 'Technical Quiz'}
                </span>
                <span className={`${styles.commandStateBadge} ${styles[`badge${currentEvent.status}`]}`}>
                  {currentEvent.status}
                </span>
              </div>
              {isQuiz && (
                <span className={styles.roundPill}>
                  {currentEvent.currentRound === 2 ? 'Round 2: Championship' : 'Round 1: Qualifiers'}
                </span>
              )}
            </>
          )}
        </div>

        <div className={styles.topbarCenter}>
          <div className={styles.timerBlock}>
            <span className={styles.timerLabel}>Time:</span>
            <span
              className={`${styles.timerValue} ${
                isLiveRunning && timerRemaining < 300 ? styles.timerValueUrgent : ''
              }`}
            >
              {isLiveRunning
                ? timerFormatted
                : `${Math.floor((currentEvent?.durationSeconds || 1800) / 60)}:00`}
            </span>
          </div>
        </div>

        <div className={styles.topbarRight}>
          <div className={styles.eliteBadge} title="Organized by ELITE — Department of Information Technology">
            <img src={eliteLogo} alt="ELITE Club" className={styles.eliteMiniLogo} />
            <span className={styles.eliteBadgeText}>ELITE IT</span>
          </div>
          <div className={styles.studentCountPill}>
            <ConnectionBadge status={connectionStatus} />
            <span>{students.length} Students</span>
          </div>
          <button className={styles.logoutBtn} onClick={logout}>
            Logout
          </button>
        </div>
      </header>

      {/* ── Nav Tabs ─────────────────────────────────────────────────────── */}
      <nav className={styles.navBar}>
        {[
          { id: 'control_room', label: 'Control Room' },
          { id: 'leaderboard', label: 'Live Leaderboard' },
          { id: 'quiz_hub', label: 'Quiz Management' },
          { id: 'debugging', label: 'Debugging Arena' },
          { id: 'students', label: 'Students' },
        ].map((tab) => (
          <button
            key={tab.id}
            className={`${styles.navTab} ${activeTab === tab.id ? styles.navTabActive : ''}`}
            onClick={() => setActiveTab(tab.id as Tab)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* ── Main View Area ───────────────────────────────────────────────── */}
      <main className={styles.mainContent}>
        {actionError && (
          <div className={styles.alertError}>
            <span>{actionError}</span>
            <button className={styles.alertCloseBtn} onClick={() => setActionError('')}>
              ×
            </button>
          </div>
        )}
        {actionSuccess && (
          <div className={styles.alertSuccess}>
            <span>{actionSuccess}</span>
            <button className={styles.alertCloseBtn} onClick={() => setActionSuccess('')}>
              ×
            </button>
          </div>
        )}

        {/* ── TAB 1: CONTROL ROOM ─────────────────────────────────────────── */}
        {activeTab === 'control_room' && (
          <>
            {/* Event Selector & Command Hero Card */}
            <div className={styles.commandCard}>
              <div className={styles.commandHeader}>
                <div className={styles.commandTitleBlock}>
                  <span className={styles.commandTitle}>Active Event:</span>
                  <select
                    className={styles.select}
                    style={{ width: 'auto', minWidth: '240px' }}
                    value={selectedEventId}
                    onChange={(e) => setSelectedEventId(e.target.value)}
                  >
                    {events.map((ev) => (
                      <option key={ev.id} value={ev.id}>
                        {ev.name} ({ev.type === 'DEBUGGING' ? 'C Debugging' : 'Quiz'}) [{ev.status}]
                      </option>
                    ))}
                  </select>
                </div>
                {currentEvent && (
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <span style={{ fontSize: 'var(--font-size-micro)', color: 'var(--admin-text-muted)' }}>
                      Duration: {Math.floor(currentEvent.durationSeconds / 60)} min
                    </span>
                  </div>
                )}
              </div>

              <div className={styles.commandStageBody}>
                <div className={styles.commandInstructions}>
                  <span className={styles.commandInstructionTitle}>
                    {currentEvent?.status === 'RUNNING'
                      ? 'Event In Progress'
                      : currentEvent?.status === 'PAUSED'
                      ? 'Event Suspended'
                      : currentEvent?.status === 'READY'
                      ? 'Ready to Launch'
                      : isQuiz && currentEvent?.round1Status === 'FINISHED' && !hasQualifiersPromoted
                      ? 'Round 1 Ended — Action Required'
                      : isQuiz && hasQualifiersPromoted && currentEvent?.round2Status !== 'RUNNING'
                      ? 'Top 10 Qualifiers Locked'
                      : 'Control Room Standby'}
                  </span>
                  <span className={styles.commandInstructionSub}>
                    {currentEvent?.status === 'RUNNING'
                      ? 'Submissions and socket telemetry are live updating below.'
                      : currentEvent?.status === 'READY'
                      ? 'Participants are in waiting lobby. Click start when ready.'
                      : isQuiz && currentEvent?.round1Status === 'FINISHED' && !hasQualifiersPromoted
                      ? 'Confirm the Top 10 leaderboard standings to unlock Round 2 for qualifiers.'
                      : 'Use the primary command button to transition event states.'}
                  </span>
                </div>

                <div>{renderSingleActionGroup()}</div>
              </div>
            </div>

            {/* Quick Live Standings Snapshot */}
            <div className={styles.panelCard}>
              <div className={styles.panelHeader}>
                <div className={styles.panelTitle}>
                  <span>⚡ Active Round Leaderboard</span>
                  <span style={{ fontSize: 'var(--font-size-micro)', color: 'var(--admin-text-muted)', fontWeight: 500 }}>
                    ({activeLeaderboardData.length} records)
                  </span>
                </div>
                <div className={styles.panelActions}>
                  <button className={styles.btnSecondary} onClick={() => setActiveTab('leaderboard')}>
                    Full Leaderboard View →
                  </button>
                </div>
              </div>

              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th style={{ width: '60px' }}>Rank</th>
                      <th>Roll No</th>
                      <th>Name</th>
                      <th className={styles.thNumeric}>Score</th>
                      <th>Time / Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeLeaderboardData.slice(0, 15).map((row, idx) => (
                      <tr key={row.id} className={idx < 10 ? styles.tableRowTop10 : ''}>
                        <td>
                          <span
                            className={`${styles.rankBadge} ${
                              idx === 0
                                ? styles.rankGold
                                : idx === 1
                                ? styles.rankSilver
                                : idx === 2
                                ? styles.rankBronze
                                : ''
                            }`}
                          >
                            {row.rank}
                          </span>
                        </td>
                        <td>
                          <strong>{row.rollNo}</strong>
                        </td>
                        <td>{row.name}</td>
                        <td className={styles.tdNumeric}>
                          <strong style={{ color: 'var(--admin-red)' }}>{row.score} pts</strong>
                        </td>
                        <td>
                          {row.isQualified ? (
                            <span className={styles.statusQualified}>{row.statusText}</span>
                          ) : (
                            <span className={styles.statusEliminated}>{row.statusText}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {activeLeaderboardData.length === 0 && (
                      <tr>
                        <td colSpan={5} className={styles.emptyState}>
                          No active participants or submissions recorded yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* ── TAB 2: FULL LEADERBOARD ────────────────────────────────────── */}
        {activeTab === 'leaderboard' && (
          <div className={styles.panelCard}>
            <div className={styles.panelHeader}>
              <div className={styles.panelTitle}>
                <span>🏆 Competition Leaderboards</span>
              </div>
              <div className={styles.panelActions}>
                <div className={styles.filterPills}>
                  {(
                    [
                      { id: 'active', label: 'Active Round' },
                      { id: 'round1', label: 'Round 1 Qualifiers' },
                      { id: 'round2', label: 'Round 2 Championship' },
                      { id: 'final', label: 'Final Rankings' },
                      { id: 'debugging', label: 'Debugging' },
                    ] as Array<{ id: LeaderboardFilter; label: string }>
                  ).map((pill) => (
                    <button
                      key={pill.id}
                      className={`${styles.filterPillBtn} ${
                        leaderboardFilter === pill.id ? styles.filterPillBtnActive : ''
                      }`}
                      onClick={() => setLeaderboardFilter(pill.id)}
                    >
                      {pill.label}
                    </button>
                  ))}
                </div>
                <input
                  className={styles.input}
                  style={{ width: '200px' }}
                  placeholder="Search student..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th
                      className={styles.tablethSortable}
                      onClick={() => {
                        setSortField('rank');
                        setSortAsc(!sortAsc);
                      }}
                    >
                      Rank {sortField === 'rank' ? (sortAsc ? '▲' : '▼') : ''}
                    </th>
                    <th
                      className={styles.tablethSortable}
                      onClick={() => {
                        setSortField('rollNo');
                        setSortAsc(!sortAsc);
                      }}
                    >
                      Roll No {sortField === 'rollNo' ? (sortAsc ? '▲' : '▼') : ''}
                    </th>
                    <th>Name</th>
                    <th
                      className={`${styles.tablethSortable} ${styles.thNumeric}`}
                      onClick={() => {
                        setSortField('score');
                        setSortAsc(!sortAsc);
                      }}
                    >
                      Score {sortField === 'score' ? (sortAsc ? '▲' : '▼') : ''}
                    </th>
                    <th
                      className={`${styles.tablethSortable} ${styles.thNumeric}`}
                      onClick={() => {
                        setSortField('time');
                        setSortAsc(!sortAsc);
                      }}
                    >
                      Time (s) {sortField === 'time' ? (sortAsc ? '▲' : '▼') : ''}
                    </th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {activeLeaderboardData.map((row, idx) => (
                    <tr key={row.id} className={idx < 10 ? styles.tableRowTop10 : ''}>
                      <td>
                        <span
                          className={`${styles.rankBadge} ${
                            row.rank === 1
                              ? styles.rankGold
                              : row.rank === 2
                              ? styles.rankSilver
                              : row.rank === 3
                              ? styles.rankBronze
                              : ''
                          }`}
                        >
                          {row.rank}
                        </span>
                      </td>
                      <td>
                        <strong>{row.rollNo}</strong>
                      </td>
                      <td>{row.name}</td>
                      <td className={styles.tdNumeric}>
                        <strong style={{ color: 'var(--admin-red)' }}>{row.score} pts</strong>
                      </td>
                      <td className={styles.tdNumeric}>{row.time ? `${row.time}s` : '—'}</td>
                      <td>
                        {row.isQualified ? (
                          <span className={styles.statusQualified}>{row.statusText}</span>
                        ) : (
                          <span className={styles.statusEliminated}>{row.statusText}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {activeLeaderboardData.length === 0 && (
                    <tr>
                      <td colSpan={6} className={styles.emptyState}>
                        No records match the current filter or search criteria.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── TAB 3: QUIZ MANAGEMENT ───────────────────────────────────────── */}
        {activeTab === 'quiz_hub' && (
          <>
            {/* Round Switcher Header (Top Controller) */}
            <div className={styles.commandCard} style={{ padding: '0.85rem 1.25rem' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '0.75rem',
                }}
              >
                <div>
                  <div
                    style={{
                      fontWeight: 800,
                      fontSize: 'var(--font-size-body, 0.875rem)',
                      color: 'var(--admin-text-main, #0f172a)',
                    }}
                  >
                    Active Round Scope: Round {selectedRoundFilter} {selectedRoundFilter === 1 ? '(Qualifiers — 60 Students)' : '(Championship — Top 10 Finalists)'}
                  </div>
                  <div
                    style={{
                      fontSize: 'var(--font-size-micro, 0.75rem)',
                      color: 'var(--admin-text-muted, #64748b)',
                    }}
                  >
                    All challenge stages and questions below are scoped to this selected round.
                  </div>
                </div>
                <div className={styles.filterPills}>
                  <button
                    className={`${styles.filterPillBtn} ${
                      selectedRoundFilter === 1 ? styles.filterPillBtnActive : ''
                    }`}
                    onClick={() => setSelectedRoundFilter(1)}
                  >
                    Round 1 (Qualifiers)
                  </button>
                  <button
                    className={`${styles.filterPillBtn} ${
                      selectedRoundFilter === 2 ? styles.filterPillBtnActive : ''
                    }`}
                    onClick={() => setSelectedRoundFilter(2)}
                  >
                    Round 2 (Top 10 Finalists)
                  </button>
                </div>
              </div>
            </div>

            {/* 1. Challenge Stages for Selected Round (4 cards) */}
            <div className={styles.panelCard}>
              <div className={styles.panelHeader}>
                <div className={styles.panelTitle}>
                  <span>🎯 Round {selectedRoundFilter} Challenge Stages ({challenges.filter((c) => c.round === selectedRoundFilter).length})</span>
                </div>
                <div className={styles.panelActions}>
                  <button
                    className={styles.btnPrimary}
                    onClick={() =>
                      setChallengeModal({
                        round: selectedRoundFilter,
                        type: selectedRoundFilter === 1 ? 'RAPID_FIRE' : 'TECH_SHOWDOWN',
                        points: 100,
                        isActive: true,
                      })
                    }
                  >
                    + Add Stage to Round {selectedRoundFilter}
                  </button>
                </div>
              </div>

              <div style={{ padding: '1rem' }}>
                <div className={styles.cardGrid}>
                  {challenges
                    .filter((c) => c.round === selectedRoundFilter)
                    .map((c) => {
                      const badge = getStageBadgeMeta(c.type);
                      const qCount = quizQuestions.filter((q) => q.challengeId === c.id).length;
                      const rec = getRecommendedQuestions(c.type);
                      const isUnderStocked = c.type !== 'PUZZLE_GRID' && qCount < rec.min;

                      return (
                        <div key={c.id} className={styles.itemCard}>
                          <div className={styles.itemCardHeader}>
                            <div className={styles.itemTitleBlock}>
                              <div className={`${styles.stageIconBadge} ${badge.tintClass}`}>
                                {badge.icon}
                              </div>
                              <div>
                                <div className={styles.itemTitle}>{c.title}</div>
                                <div className={styles.itemSub}>
                                  Round {c.round} • {c.type} • {c.points} pts
                                </div>
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: '0.25rem' }}>
                              <button
                                className={styles.btnIcon}
                                onClick={() => setChallengeModal({ ...c })}
                              >
                                ✎
                              </button>
                              <button
                                className={styles.btnIcon}
                                onClick={() => deleteChallenge(c.id)}
                              >
                                ✕
                              </button>
                            </div>
                          </div>

                          <div style={{ fontSize: 'var(--font-size-micro)', color: 'var(--admin-text-muted)', marginTop: 'var(--space-2)' }}>
                            {c.description || c.subtitle || 'No stage description.'}
                          </div>

                          {/* Question Stock / Recommended Minimum Indicator */}
                          <div style={{ marginTop: '0.65rem', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                            <span
                              className={`${styles.commandStateBadge} ${
                                c.type === 'PUZZLE_GRID'
                                  ? styles.badgeTintGreen
                                  : isUnderStocked
                                  ? styles.badgeTintAmber
                                  : styles.badgeTintGreen
                              }`}
                              style={{
                                fontSize: '0.75rem',
                                padding: '3px 8px',
                                fontWeight: 700,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.3rem',
                              }}
                            >
                              {c.type === 'PUZZLE_GRID'
                                ? '🧩 Interactive 3x3 Board'
                                : isUnderStocked
                                ? `⚠️ ${qCount} questions — ${rec.label}`
                                : `✅ ${qCount} questions (Ready)`}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  {challenges.filter((c) => c.round === selectedRoundFilter).length === 0 && (
                    <div className={styles.emptyState} style={{ gridColumn: '1 / -1' }}>
                      No challenge stages configured for Round {selectedRoundFilter}.
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 2. Questions Table for Selected Round */}
            <div className={styles.panelCard}>
              <div className={styles.panelHeader}>
                <div className={styles.panelTitle}>
                  <span>❓ Round {selectedRoundFilter} Question Bank ({quizQuestions.length})</span>
                </div>
                <div className={styles.panelActions}>
                  <input
                    type="file"
                    ref={fileInputRef}
                    style={{ display: 'none' }}
                    accept=".xlsx,.xls,.csv"
                    onChange={handleImportExcel}
                  />
                  <button
                    className={styles.btnSecondary}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    📂 Import Excel
                  </button>
                  {importStatus && (
                    <span style={{ fontSize: 'var(--font-size-micro)', fontWeight: 700, color: 'var(--admin-red)' }}>
                      {importStatus}
                    </span>
                  )}

                  <button
                    className={styles.btnPrimary}
                    onClick={() =>
                      setQuizModal({
                        round: selectedRoundFilter,
                        type: 'MCQ',
                        points: 10,
                        category: 'AI',
                        correctAnswer: 'A',
                      })
                    }
                  >
                    + Add Question to Round {selectedRoundFilter}
                  </button>
                </div>
              </div>

              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th style={{ width: '50px' }}>#</th>
                      <th>Category</th>
                      <th>Type</th>
                      <th>Question Prompt</th>
                      <th>Answer</th>
                      <th className={styles.thNumeric}>Points</th>
                      <th style={{ width: '110px' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quizQuestions.map((q, idx) => (
                      <tr key={q.id}>
                        <td>{idx + 1}</td>
                        <td>
                          <strong>{q.category}</strong>
                        </td>
                        <td>{q.type}</td>
                        <td style={{ maxWidth: '400px' }}>{q.question}</td>
                        <td>
                          <span className={styles.statusQualified}>{q.correctAnswer}</span>
                        </td>
                        <td className={styles.tdNumeric}>{q.points}</td>
                        <td>
                          <div style={{ display: 'flex', gap: '0.25rem' }}>
                            <button
                              className={styles.btnIcon}
                              onClick={() => setQuizModal({ ...q })}
                            >
                              ✎
                            </button>
                            <button
                              className={styles.btnIcon}
                              onClick={() => deleteQuizQuestion(q.id)}
                            >
                              ✕
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {quizQuestions.length === 0 && (
                      <tr>
                        <td colSpan={7} className={styles.emptyState}>
                          No questions found for Round {selectedRoundFilter}.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* ── TAB 4: DEBUGGING ARENA ───────────────────────────────────────── */}
        {activeTab === 'debugging' && (
          <div className={styles.panelCard}>
            <div className={styles.panelHeader}>
              <div className={styles.panelTitle}>
                <span>🐛 C Debugging Problems ({problems.length})</span>
              </div>
              <div className={styles.panelActions}>
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
            </div>

            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th style={{ width: '50px' }}>#</th>
                    <th>Problem Title</th>
                    <th className={styles.thNumeric}>Points</th>
                    <th className={styles.thNumeric}>Time Limit</th>
                    <th>Description</th>
                    <th style={{ width: '120px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {problems.map((p, idx) => (
                    <tr key={p.id}>
                      <td>{idx + 1}</td>
                      <td>
                        <strong>{p.title}</strong>
                      </td>
                      <td className={styles.tdNumeric}>{p.points} pts</td>
                      <td className={styles.tdNumeric}>{p.timeLimit}s</td>
                      <td style={{ maxWidth: '350px' }}>{p.description}</td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.35rem' }}>
                          <button
                            className={styles.btnSecondary}
                            style={{ padding: '0.25rem 0.5rem', fontSize: 'var(--font-size-micro)' }}
                            onClick={() => setDebugModal({ ...p })}
                          >
                            Edit
                          </button>
                          <button
                            className={styles.btnDangerOutline}
                            style={{ padding: '0.25rem 0.5rem', fontSize: 'var(--font-size-micro)' }}
                            onClick={() => deleteDebugProblem(p.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {problems.length === 0 && (
                    <tr>
                      <td colSpan={6} className={styles.emptyState}>
                        No debugging problems created yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── TAB 5: STUDENTS DIRECTORY ────────────────────────────────────── */}
        {activeTab === 'students' && (
          <div className={styles.panelCard}>
            <div className={styles.panelHeader}>
              <div className={styles.panelTitle}>
                <span>👥 Registered Students ({students.length})</span>
              </div>
              <div className={styles.panelActions}>
                <button className={styles.btnPrimary} onClick={() => setStudentModal(true)}>
                  + Add Student
                </button>
              </div>
            </div>

            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th style={{ width: '60px' }}>#</th>
                    <th>Roll No</th>
                    <th>Name</th>
                    <th>Registration Date</th>
                    <th style={{ width: '100px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((s, idx) => (
                    <tr key={s.id}>
                      <td>{idx + 1}</td>
                      <td>
                        <code>{s.rollNo}</code>
                      </td>
                      <td>
                        <strong>{s.name}</strong>
                      </td>
                      <td>{new Date(s.createdAt).toLocaleDateString()}</td>
                      <td>
                        <button
                          className={styles.btnDangerOutline}
                          style={{ padding: '0.25rem 0.5rem', fontSize: 'var(--font-size-micro)' }}
                          onClick={() => deleteStudent(s.id)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                  {students.length === 0 && (
                    <tr>
                      <td colSpan={5} className={styles.emptyState}>
                        No students enrolled yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* ── QUALIFY TOP 10 CONFIRMATION MODAL ──────────────────────────────── */}
      {qualifyModalOpen && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <span className={styles.modalTitle}>👑 Confirm Round 1 Qualifiers (Top 10)</span>
              <button
                className={styles.modalCloseBtn}
                onClick={() => setQualifyModalOpen(false)}
              >
                ×
              </button>
            </div>

            <div className={styles.modalBody}>
              <div className={styles.modalNotice}>
                <strong>⚠️ Promotion Lock-in:</strong> The 10 students listed below will be granted
                exclusive access to participate in <strong>Round 2: Championship</strong>. All other
                participants will be locked to the eliminated results screen.
              </div>

              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th style={{ width: '50px' }}>Rank</th>
                      <th>Roll No</th>
                      <th>Student Name</th>
                      <th className={styles.thNumeric}>Score</th>
                      <th className={styles.thNumeric}>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {qualifyPreviewList.map((q, idx) => (
                      <tr key={q.id || idx}>
                        <td>
                          <span
                            className={`${styles.rankBadge} ${
                              idx === 0
                                ? styles.rankGold
                                : idx === 1
                                ? styles.rankSilver
                                : idx === 2
                                ? styles.rankBronze
                                : ''
                            }`}
                          >
                            {idx + 1}
                          </span>
                        </td>
                        <td>
                          <strong>{q.user?.rollNo}</strong>
                        </td>
                        <td>{q.user?.name}</td>
                        <td className={styles.tdNumeric}>
                          <strong style={{ color: 'var(--admin-red)' }}>
                            {q.round1Score} pts
                          </strong>
                        </td>
                        <td className={styles.tdNumeric}>{q.round1Time}s</td>
                      </tr>
                    ))}
                    {qualifyPreviewList.length === 0 && (
                      <tr>
                        <td colSpan={5} className={styles.emptyState}>
                          No qualifying submissions detected.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className={styles.modalFooter}>
              <button
                className={styles.btnSecondary}
                onClick={() => setQualifyModalOpen(false)}
              >
                Cancel
              </button>
              <button
                className={styles.btnPrimary}
                disabled={actionLoading || qualifyPreviewList.length === 0}
                onClick={confirmQualifyRound1}
              >
                {actionLoading ? 'Locking In...' : '✓ Confirm Top 10 & Enable Round 2'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── CHALLENGE MODAL ──────────────────────────────────────────────── */}
      {challengeModal !== null && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <span className={styles.modalTitle}>
                {challengeModal.id ? 'Edit Challenge Stage' : 'New Challenge Stage'}
              </span>
              <button
                className={styles.modalCloseBtn}
                onClick={() => setChallengeModal(null)}
              >
                ×
              </button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.formGrid}>
                <div className={styles.formGroup}>
                  <span className={styles.formLabel}>Round</span>
                  <select
                    className={styles.select}
                    value={challengeModal.round ?? 1}
                    onChange={(e) =>
                      setChallengeModal((p) => ({ ...p!, round: +e.target.value }))
                    }
                  >
                    <option value={1}>Round 1 (Qualifiers)</option>
                    <option value={2}>Round 2 (Championship Top 10)</option>
                  </select>
                </div>

                <div className={styles.formGroup}>
                  <span className={styles.formLabel}>Stage Type</span>
                  <select
                    className={styles.select}
                    value={challengeModal.type || 'RAPID_FIRE'}
                    onChange={(e) =>
                      setChallengeModal((p) => ({ ...p!, type: e.target.value }))
                    }
                  >
                    <option value="RAPID_FIRE">⚡ Rapid Fire</option>
                    <option value="GUESS_THE_TECH">🔍 Guess the Tech</option>
                    <option value="TECH_SHUFFLE">🔀 Tech Shuffle</option>
                    <option value="PUZZLE_GRID">🧩 Puzzle Grid</option>
                    <option value="TECH_SHOWDOWN">⚔️ Tech Showdown</option>
                    <option value="TECH_TODAY">📰 Tech Today</option>
                    <option value="REAL_OR_FAKE">🎭 Real or Fake</option>
                    <option value="FINAL_CHALLENGE">👑 Final Challenge</option>
                  </select>
                </div>

                <div className={styles.formGroupFull}>
                  <span className={styles.formLabel}>Title</span>
                  <input
                    className={styles.input}
                    value={challengeModal.title || ''}
                    onChange={(e) =>
                      setChallengeModal((p) => ({ ...p!, title: e.target.value }))
                    }
                  />
                </div>

                <div className={styles.formGroup}>
                  <span className={styles.formLabel}>Points</span>
                  <input
                    className={styles.input}
                    type="number"
                    value={challengeModal.points ?? 100}
                    onChange={(e) =>
                      setChallengeModal((p) => ({ ...p!, points: +e.target.value }))
                    }
                  />
                </div>

                <div className={styles.formGroup}>
                  <span className={styles.formLabel}>Stage Time Limit (Sec, 0 = default)</span>
                  <input
                    className={styles.input}
                    type="number"
                    value={challengeModal.timeLimit ?? 0}
                    onChange={(e) =>
                      setChallengeModal((p) => ({ ...p!, timeLimit: +e.target.value }))
                    }
                  />
                </div>

                <div className={styles.formGroup}>
                  <span className={styles.formLabel}>Timer Mode</span>
                  <select
                    className={styles.select}
                    value={challengeModal.timerMode || 'GLOBAL_STAGE'}
                    onChange={(e) =>
                      setChallengeModal((p) => ({ ...p!, timerMode: e.target.value }))
                    }
                  >
                    <option value="GLOBAL_STAGE">Global Stage Countdown</option>
                    <option value="PER_QUESTION">Per-Question Fixed Timer</option>
                  </select>
                </div>

                {challengeModal.timerMode === 'PER_QUESTION' && (
                  <div className={styles.formGroup}>
                    <span className={styles.formLabel}>Sec Per Question</span>
                    <input
                      className={styles.input}
                      type="number"
                      value={challengeModal.timePerQuestionSec ?? 30}
                      onChange={(e) =>
                        setChallengeModal((p) => ({ ...p!, timePerQuestionSec: +e.target.value }))
                      }
                    />
                  </div>
                )}

                <div className={styles.formGroupFull}>
                  <span className={styles.formLabel}>Subtitle / Description</span>
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
                </div>

                {/* Specific Config for PUZZLE_GRID */}
                {challengeModal.type === 'PUZZLE_GRID' && (() => {
                  let pzConfig: { image?: string; shuffleMoves?: number } = {};
                  try {
                    pzConfig = typeof challengeModal.config === 'string' ? JSON.parse(challengeModal.config || '{}') : challengeModal.config || {};
                  } catch {
                    pzConfig = {};
                  }

                  return (
                    <>
                      <div className={styles.formGroupFull}>
                        <span className={styles.formLabel}>Puzzle Image Slice URL (Optional for 3x3 photo tile split)</span>
                        <input
                          className={styles.input}
                          value={pzConfig.image || ''}
                          placeholder="e.g. /branding/sasi-logo.png or https://..."
                          onChange={(e) => {
                            const updated = { ...pzConfig, image: e.target.value };
                            setChallengeModal((p) => ({ ...p!, config: JSON.stringify(updated) }));
                          }}
                        />
                        {pzConfig.image && (
                          <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                            <img
                              src={pzConfig.image}
                              alt="Puzzle Preview"
                              style={{ width: '80px', height: '80px', objectFit: 'cover', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                            />
                            <span style={{ fontSize: 'var(--font-size-micro)', color: '#64748b' }}>
                              Tile matrix will dynamically slice this image into a 3x3 interactive board.
                            </span>
                          </div>
                        )}
                      </div>

                      <div className={styles.formGroup}>
                        <span className={styles.formLabel}>Scramble Swap Count</span>
                        <input
                          className={styles.input}
                          type="number"
                          value={pzConfig.shuffleMoves ?? 28}
                          onChange={(e) => {
                            const updated = { ...pzConfig, shuffleMoves: +e.target.value || 28 };
                            setChallengeModal((p) => ({ ...p!, config: JSON.stringify(updated) }));
                          }}
                        />
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
            <div className={styles.modalFooter}>
              <button
                className={styles.btnSecondary}
                onClick={() => setChallengeModal(null)}
              >
                Cancel
              </button>
              <button className={styles.btnPrimary} onClick={saveChallenge}>
                Save Stage
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── QUESTION MODAL ───────────────────────────────────────────────── */}
      {quizModal !== null && (() => {
        const targetChallenge = challenges.find((c) => c.id === quizModal.challengeId);
        const isGuessTheTech = targetChallenge?.type === 'GUESS_THE_TECH' || quizModal.type === 'GUESS_IMAGE';

        return (
          <div className={styles.modalOverlay}>
            <div className={styles.modal}>
              <div className={styles.modalHeader}>
                <span className={styles.modalTitle}>
                  {quizModal.id ? 'Edit Question' : 'Add Question'}
                </span>
                <button
                  className={styles.modalCloseBtn}
                  onClick={() => {
                    setQuizModal(null);
                    setModalFormError('');
                    setImageUploadError('');
                  }}
                >
                  ×
                </button>
              </div>
              <div className={styles.modalBody}>
                {modalFormError && (
                  <div className={styles.alertError} style={{ marginBottom: '0.5rem' }}>
                    <span>⚠️ {modalFormError}</span>
                    <button
                      type="button"
                      className={styles.alertCloseBtn}
                      onClick={() => setModalFormError('')}
                    >
                      ×
                    </button>
                  </div>
                )}

                <div className={styles.formGrid}>
                  {/* Group 1: Scope */}
                  <div className={styles.formGroup}>
                    <span className={styles.formLabel}>Round</span>
                    <select
                      className={styles.select}
                      value={quizModal.round ?? selectedRoundFilter}
                      onChange={(e) =>
                        setQuizModal((p) => ({ ...p!, round: +e.target.value }))
                      }
                    >
                      <option value={1}>Round 1</option>
                      <option value={2}>Round 2 (Top 10)</option>
                    </select>
                  </div>

                  <div className={styles.formGroup}>
                    <span className={styles.formLabel}>Challenge Stage</span>
                    <select
                      className={styles.select}
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
                            {c.title} ({c.type})
                          </option>
                        ))}
                    </select>
                  </div>

                  {/* Group 2: Meta */}
                  <div className={styles.formGroup}>
                    <span className={styles.formLabel}>Type</span>
                    <select
                      className={styles.select}
                      value={quizModal.type || 'MCQ'}
                      onChange={(e) =>
                        setQuizModal((p) => ({ ...p!, type: e.target.value }))
                      }
                    >
                      <option value="MCQ">Multiple Choice (MCQ)</option>
                      <option value="REAL_OR_FAKE">Real or Fake</option>
                      <option value="SHUFFLE_ORDER">Tech Shuffle Sequence</option>
                      <option value="TECH_SHUFFLE">Tech Shuffle Workflow</option>
                    </select>
                  </div>

                  <div className={styles.formGroup}>
                    <span className={styles.formLabel}>Category</span>
                    <select
                      className={styles.select}
                      value={quizModal.category || 'AI'}
                      onChange={(e) =>
                        setQuizModal((p) => ({ ...p!, category: e.target.value }))
                      }
                    >
                      <option value="AI">AI</option>
                      <option value="GADGETS">GADGETS</option>
                      <option value="CYBERSECURITY">CYBERSECURITY</option>
                      <option value="SPACE">SPACE</option>
                      <option value="GAMING">GAMING</option>
                      <option value="FOUNDERS">FOUNDERS</option>
                      <option value="TECH_SHUFFLE">TECH SHUFFLE</option>
                      <option value="PUZZLE_GRID">PUZZLE GRID</option>
                    </select>
                  </div>

                  {/* Group 3: Image Dropzone ONLY for GUESS_THE_TECH */}
                  {isGuessTheTech && (
                    <div className={styles.formGroupFull}>
                      <span className={styles.formLabel}>
                        Challenge Image Clue <span style={{ color: 'var(--admin-red)' }}>* (Required)</span>
                      </span>

                      {quizModal.imageUrl ? (
                        <div className={styles.imagePreviewContainer}>
                          <img
                            src={quizModal.imageUrl}
                            alt="Question preview"
                            className={styles.imageThumbnail}
                          />
                          <div className={styles.imagePreviewActions}>
                            <span className={styles.imagePreviewUrl}>{quizModal.imageUrl}</span>
                            <button
                              type="button"
                              className={styles.btnDangerOutline}
                              style={{ padding: '0.35rem 0.75rem', fontSize: 'var(--font-size-micro)' }}
                              onClick={() => setQuizModal((p) => ({ ...p!, imageUrl: '' }))}
                            >
                              ✕ Remove / Replace Image
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div
                          className={`${styles.dropzone} ${isDragging ? styles.dropzoneActive : ''}`}
                          onDragOver={(e) => {
                            e.preventDefault();
                            setIsDragging(true);
                          }}
                          onDragLeave={() => setIsDragging(false)}
                          onDrop={(e) => {
                            e.preventDefault();
                            setIsDragging(false);
                            const file = e.dataTransfer.files?.[0];
                            if (file) handleQuestionImageUpload(file);
                          }}
                          onClick={() => imageInputRef.current?.click()}
                        >
                          <input
                            type="file"
                            ref={imageInputRef}
                            style={{ display: 'none' }}
                            accept="image/png,image/jpeg,image/webp,image/jpg"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleQuestionImageUpload(file);
                            }}
                          />
                          <div className={styles.dropzoneIcon}>🖼️</div>
                          <div className={styles.dropzoneText}>
                            <strong>Click to browse</strong> or drag &amp; drop clue image here
                          </div>
                          <div className={styles.dropzoneSub}>
                            JPG, PNG, or WEBP • Maximum file size 5MB
                          </div>
                          {imageUploading && (
                            <div className={styles.uploadSpinner}>Uploading image...</div>
                          )}
                        </div>
                      )}
                      {imageUploadError && (
                        <div style={{ fontSize: 'var(--font-size-micro)', color: 'var(--admin-red)', marginTop: '0.25rem' }}>
                          ⚠️ {imageUploadError}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Group 4: Prompt */}
                  <div className={styles.formGroupFull}>
                    <span className={styles.formLabel}>Question Prompt</span>
                    <textarea
                      className={styles.textarea}
                      rows={3}
                      value={quizModal.question || ''}
                      placeholder="e.g. Which revolutionary computing architecture is illustrated in this diagram?"
                      onChange={(e) =>
                        setQuizModal((p) => ({ ...p!, question: e.target.value }))
                      }
                    />
                  </div>

                  {/* Group 5: Options */}
                  {quizModal.type !== 'REAL_OR_FAKE' && (
                    <>
                      <div className={styles.formGroup}>
                        <span className={styles.formLabel}>Option A</span>
                        <input
                          className={styles.input}
                          value={quizModal.optionA || ''}
                          onChange={(e) =>
                            setQuizModal((p) => ({ ...p!, optionA: e.target.value }))
                          }
                        />
                      </div>
                      <div className={styles.formGroup}>
                        <span className={styles.formLabel}>Option B</span>
                        <input
                          className={styles.input}
                          value={quizModal.optionB || ''}
                          onChange={(e) =>
                            setQuizModal((p) => ({ ...p!, optionB: e.target.value }))
                          }
                        />
                      </div>
                      <div className={styles.formGroup}>
                        <span className={styles.formLabel}>Option C</span>
                        <input
                          className={styles.input}
                          value={quizModal.optionC || ''}
                          onChange={(e) =>
                            setQuizModal((p) => ({ ...p!, optionC: e.target.value }))
                          }
                        />
                      </div>
                      <div className={styles.formGroup}>
                        <span className={styles.formLabel}>Option D</span>
                        <input
                          className={styles.input}
                          value={quizModal.optionD || ''}
                          onChange={(e) =>
                            setQuizModal((p) => ({ ...p!, optionD: e.target.value }))
                          }
                        />
                      </div>
                    </>
                  )}

                  {/* Group 6: Answer & Points */}
                  <div className={styles.formGroup}>
                    <span className={styles.formLabel}>Correct Answer</span>
                    {quizModal.type === 'REAL_OR_FAKE' ? (
                      <select
                        className={styles.select}
                        value={quizModal.correctAnswer || 'REAL'}
                        onChange={(e) =>
                          setQuizModal((p) => ({ ...p!, correctAnswer: e.target.value }))
                        }
                      >
                        <option value="REAL">REAL</option>
                        <option value="FAKE">FAKE</option>
                      </select>
                    ) : quizModal.type === 'SHUFFLE_ORDER' || quizModal.type === 'TECH_SHUFFLE' ? (
                      <div>
                        <input
                          className={styles.input}
                          value={quizModal.correctAnswer || ''}
                          placeholder='["1. Step", "2. Step", "3. Step", "4. Step"]'
                          onChange={(e) =>
                            setQuizModal((p) => ({ ...p!, correctAnswer: e.target.value }))
                          }
                        />
                        <button
                          type="button"
                          className={styles.btnSecondary}
                          style={{ marginTop: '0.35rem', padding: '0.2rem 0.5rem', fontSize: 'var(--font-size-micro)' }}
                          onClick={() => {
                            const steps = [quizModal.optionA, quizModal.optionB, quizModal.optionC, quizModal.optionD].filter(Boolean);
                            setQuizModal((p) => ({ ...p!, correctAnswer: JSON.stringify(steps) }));
                          }}
                        >
                          ⚡ Auto-fill Sequence from Options A–D
                        </button>
                      </div>
                    ) : (
                      <select
                        className={styles.select}
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
                  </div>

                  <div className={styles.formGroup}>
                    <span className={styles.formLabel}>Points</span>
                    <input
                      className={styles.input}
                      type="number"
                      value={quizModal.points ?? 15}
                      onChange={(e) =>
                        setQuizModal((p) => ({ ...p!, points: +e.target.value }))
                      }
                    />
                  </div>
                </div>
              </div>
              <div className={styles.modalFooter}>
                <button
                  className={styles.btnSecondary}
                  onClick={() => {
                    setQuizModal(null);
                    setModalFormError('');
                    setImageUploadError('');
                  }}
                >
                  Cancel
                </button>
                <button
                  className={styles.btnPrimary}
                  disabled={imageUploading}
                  onClick={saveQuizQuestion}
                >
                  {imageUploading ? 'Uploading Image...' : 'Save Question'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── DEBUG PROBLEM MODAL ──────────────────────────────────────────── */}
      {debugModal !== null && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <span className={styles.modalTitle}>
                {debugModal.id ? 'Edit Debugging Problem' : 'Add Debugging Problem'}
              </span>
              <button
                className={styles.modalCloseBtn}
                onClick={() => setDebugModal(null)}
              >
                ×
              </button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.formGrid}>
                <div className={styles.formGroupFull}>
                  <span className={styles.formLabel}>Problem Title</span>
                  <input
                    className={styles.input}
                    value={debugModal.title || ''}
                    onChange={(e) =>
                      setDebugModal((p) => ({ ...p!, title: e.target.value }))
                    }
                  />
                </div>
                <div className={styles.formGroup}>
                  <span className={styles.formLabel}>Points</span>
                  <input
                    className={styles.input}
                    type="number"
                    value={debugModal.points ?? 100}
                    onChange={(e) =>
                      setDebugModal((p) => ({ ...p!, points: +e.target.value }))
                    }
                  />
                </div>
                <div className={styles.formGroup}>
                  <span className={styles.formLabel}>Time Limit (sec)</span>
                  <input
                    className={styles.input}
                    type="number"
                    value={debugModal.timeLimit ?? 5}
                    onChange={(e) =>
                      setDebugModal((p) => ({ ...p!, timeLimit: +e.target.value }))
                    }
                  />
                </div>
                <div className={styles.formGroupFull}>
                  <span className={styles.formLabel}>Description</span>
                  <textarea
                    className={styles.textarea}
                    rows={2}
                    value={debugModal.description || ''}
                    onChange={(e) =>
                      setDebugModal((p) => ({ ...p!, description: e.target.value }))
                    }
                  />
                </div>
                <div className={styles.formGroupFull}>
                  <span className={styles.formLabel}>Buggy C Code</span>
                  <textarea
                    className={styles.textarea}
                    style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
                    rows={6}
                    value={debugModal.buggyCode || ''}
                    onChange={(e) =>
                      setDebugModal((p) => ({ ...p!, buggyCode: e.target.value }))
                    }
                  />
                </div>
                <div className={styles.formGroupFull}>
                  <span className={styles.formLabel}>Expected Output</span>
                  <textarea
                    className={styles.textarea}
                    rows={2}
                    value={debugModal.expectedOutput || ''}
                    onChange={(e) =>
                      setDebugModal((p) => ({ ...p!, expectedOutput: e.target.value }))
                    }
                  />
                </div>
              </div>
            </div>
            <div className={styles.modalFooter}>
              <button
                className={styles.btnSecondary}
                onClick={() => setDebugModal(null)}
              >
                Cancel
              </button>
              <button className={styles.btnPrimary} onClick={saveDebugProblem}>
                Save Problem
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── STUDENT MODAL ────────────────────────────────────────────────── */}
      {studentModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <span className={styles.modalTitle}>Add Student</span>
              <button
                className={styles.modalCloseBtn}
                onClick={() => setStudentModal(false)}
              >
                ×
              </button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.formGrid}>
                <div className={styles.formGroup}>
                  <span className={styles.formLabel}>Roll Number</span>
                  <input
                    className={styles.input}
                    value={newStudent.rollNo}
                    placeholder="e.g. 23A91A0501"
                    onChange={(e) =>
                      setNewStudent((p) => ({ ...p, rollNo: e.target.value.toUpperCase() }))
                    }
                  />
                </div>
                <div className={styles.formGroup}>
                  <span className={styles.formLabel}>Full Name</span>
                  <input
                    className={styles.input}
                    value={newStudent.name}
                    onChange={(e) =>
                      setNewStudent((p) => ({ ...p, name: e.target.value }))
                    }
                  />
                </div>
                <div className={styles.formGroupFull}>
                  <span className={styles.formLabel}>Password</span>
                  <input
                    className={styles.input}
                    type="password"
                    value={newStudent.password}
                    onChange={(e) =>
                      setNewStudent((p) => ({ ...p, password: e.target.value }))
                    }
                  />
                </div>
              </div>
            </div>
            <div className={styles.modalFooter}>
              <button
                className={styles.btnSecondary}
                onClick={() => setStudentModal(false)}
              >
                Cancel
              </button>
              <button className={styles.btnPrimary} onClick={addStudent}>
                Add Student
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
