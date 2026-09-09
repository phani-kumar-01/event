import React, { useState, useEffect, useMemo, useCallback } from 'react';
import api from '../../services/api';
import styles from './AdminLeaderboard.module.css';

export type LeaderboardFilter = 'all' | 'active' | 'round1' | 'round2' | 'debugging';

interface QuizScore {
  id: string;
  userId: string;
  rollNo: string;
  name: string;
  round1Score: number;
  round1Rank: number;
  round1Time: number;
  round2Score: number;
  round2Rank: number;
  round2Time: number;
  finalScore: number;
  finalRank: number;
  isQualified: boolean;
  totalPoints: number;
}

interface DebuggingScore {
  id: string;
  userId: string;
  rollNo: string;
  name: string;
  totalPoints: number;
  problemsSolved: number;
  rank: number;
}

interface MasterScore {
  id: string;
  userId: string;
  rollNo: string;
  name: string;
  quizPoints: number;
  debuggingPoints: number;
  totalPoints: number;
  rank: number;
}

interface LeaderboardPayload {
  quizScores: QuizScore[];
  debuggingScores: DebuggingScore[];
  masterScores: MasterScore[];
  events: Array<{
    id: string;
    type: string;
    name: string;
    status: string;
    currentRound?: number;
  }>;
}

export default function AdminLeaderboard() {
  const [data, setData] = useState<LeaderboardPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [filter, setFilter] = useState<LeaderboardFilter>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortField, setSortField] = useState<'rank' | 'rollNo' | 'score' | 'time' | 'solved'>('rank');
  const [sortAsc, setSortAsc] = useState<boolean>(true);

  const fetchLeaderboard = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get<LeaderboardPayload>('/admin/leaderboard');
      setData(res.data);
    } catch {
      // Fallback
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  const activeEvent = data?.events?.find((e) => e.status === 'RUNNING') || data?.events?.[0];

  const filteredData = useMemo(() => {
    if (!data) return [];

    let rows: Array<{
      id: string;
      rank: number;
      rollNo: string;
      name: string;
      score: number;
      time?: number;
      problemsSolved?: number;
      quizPoints?: number;
      debuggingPoints?: number;
      statusText: string;
      isTop10?: boolean;
    }> = [];

    if (filter === 'debugging') {
      rows = (data.debuggingScores || []).map((d) => ({
        id: d.id,
        rank: d.rank,
        rollNo: d.rollNo,
        name: d.name,
        score: d.totalPoints,
        problemsSolved: d.problemsSolved,
        statusText: `${d.problemsSolved} Solved`,
        isTop10: d.rank <= 10,
      }));
    } else if (filter === 'round1') {
      rows = (data.quizScores || []).map((q) => ({
        id: q.id,
        rank: q.round1Rank || 1,
        rollNo: q.rollNo,
        name: q.name,
        score: q.round1Score,
        time: q.round1Time,
        statusText: q.isQualified ? 'Qualified Top 10' : 'Participant',
        isTop10: q.isQualified,
      }));
    } else if (filter === 'round2') {
      rows = (data.quizScores || [])
        .filter((q) => q.isQualified || (q.round2Score && q.round2Score > 0))
        .map((q) => ({
          id: q.id,
          rank: q.finalRank || q.round1Rank || 1,
          rollNo: q.rollNo,
          name: q.name,
          score: q.finalScore || q.round2Score || q.round1Score,
          time: (q.round1Time || 0) + (q.round2Time || 0),
          statusText: 'Round 2 Finalist',
          isTop10: true,
        }));
    } else if (filter === 'active') {
      if (activeEvent?.type === 'DEBUGGING') {
        rows = (data.debuggingScores || []).map((d) => ({
          id: d.id,
          rank: d.rank,
          rollNo: d.rollNo,
          name: d.name,
          score: d.totalPoints,
          problemsSolved: d.problemsSolved,
          statusText: `${d.problemsSolved} Solved`,
          isTop10: d.rank <= 10,
        }));
      } else {
        const isR2 = activeEvent?.currentRound === 2;
        rows = (data.quizScores || []).map((q) => ({
          id: q.id,
          rank: isR2 ? (q.finalRank || q.round1Rank) : q.round1Rank,
          rollNo: q.rollNo,
          name: q.name,
          score: isR2 ? (q.finalScore || q.round2Score) : q.round1Score,
          time: isR2 ? (q.round1Time + q.round2Time) : q.round1Time,
          statusText: isR2 ? (q.isQualified ? 'Round 2 Active' : 'Round 1 Completed') : (q.isQualified ? 'Top 10' : 'Participant'),
          isTop10: q.isQualified,
        }));
      }
    } else {
      // 'all' / Master
      rows = (data.masterScores || []).map((m) => ({
        id: m.id,
        rank: m.rank,
        rollNo: m.rollNo,
        name: m.name,
        score: m.totalPoints,
        quizPoints: m.quizPoints,
        debuggingPoints: m.debuggingPoints,
        statusText: `Quiz: ${m.quizPoints}p | Debug: ${m.debuggingPoints}p`,
        isTop10: m.rank <= 10,
      }));
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      rows = rows.filter(
        (r) => r.rollNo.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)
      );
    }

    return rows.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'score') cmp = b.score - a.score;
      else if (sortField === 'rollNo') cmp = a.rollNo.localeCompare(b.rollNo);
      else if (sortField === 'time') cmp = (a.time || 0) - (b.time || 0);
      else if (sortField === 'solved') cmp = (b.problemsSolved || 0) - (a.problemsSolved || 0);
      else cmp = a.rank - b.rank;

      return sortAsc ? cmp : -cmp;
    });
  }, [data, filter, activeEvent, searchQuery, sortField, sortAsc]);

  async function handleExportExcel() {
    try {
      const res = await api.get('/admin/leaderboard/export-excel', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'SASI_Engineers_Day_Leaderboard.xlsx');
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      alert('Failed to export leaderboard');
    }
  }

  return (
    <div className={styles.leaderboardContainer}>
      <div className={styles.panelHeader}>
        <div className={styles.panelTitle}>
          <span>🏆 Competition Leaderboards</span>
        </div>

        <div className={styles.panelActions}>
          <div className={styles.filterPills}>
            {[
              { id: 'all' as LeaderboardFilter, label: 'ALL EVENTS' },
              { id: 'active' as LeaderboardFilter, label: 'Active Round' },
              { id: 'round1' as LeaderboardFilter, label: 'Round 1 Qualifiers' },
              { id: 'round2' as LeaderboardFilter, label: 'Round 2 Championship' },
              { id: 'debugging' as LeaderboardFilter, label: 'Debugging' },
            ].map((pill) => (
              <button
                key={pill.id}
                className={`${styles.filterPillBtn} ${
                  filter === pill.id ? styles.filterPillBtnActive : ''
                }`}
                onClick={() => setFilter(pill.id)}
              >
                {pill.label}
              </button>
            ))}
          </div>

          <input
            className={styles.searchInput}
            placeholder="Search student or roll no..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />

          <button className={styles.btnExport} onClick={handleExportExcel}>
            📊 Export Excel
          </button>
        </div>
      </div>

      {filter === 'debugging' && (!data?.debuggingScores || data.debuggingScores.length === 0) ? (
        <div className={styles.emptyStateCard}>
          <div className={styles.emptyStateIcon}>💻</div>
          <h3 className={styles.emptyStateTitle}>No C Debugging Submissions</h3>
          <p className={styles.emptyStateText}>
            No C Debugging submissions received yet. Start the Debugging Arena stage to track live code fixes.
          </p>
        </div>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.darkTable}>
            <thead>
              <tr>
                <th
                  className={styles.thSortable}
                  onClick={() => {
                    setSortField('rank');
                    setSortAsc(!sortAsc);
                  }}
                >
                  Rank {sortField === 'rank' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th
                  className={styles.thSortable}
                  onClick={() => {
                    setSortField('rollNo');
                    setSortAsc(!sortAsc);
                  }}
                >
                  Roll No {sortField === 'rollNo' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                <th>Student Name</th>
                <th
                  className={`${styles.thSortable} ${styles.thNumeric}`}
                  onClick={() => {
                    setSortField('score');
                    setSortAsc(!sortAsc);
                  }}
                >
                  Total Score {sortField === 'score' ? (sortAsc ? '▲' : '▼') : ''}
                </th>
                {filter === 'debugging' && (
                  <th
                    className={`${styles.thSortable} ${styles.thNumeric}`}
                    onClick={() => {
                      setSortField('solved');
                      setSortAsc(!sortAsc);
                    }}
                  >
                    Problems Solved {sortField === 'solved' ? (sortAsc ? '▲' : '▼') : ''}
                  </th>
                )}
                {(filter === 'round1' || filter === 'round2' || filter === 'active') && (
                  <th
                    className={`${styles.thSortable} ${styles.thNumeric}`}
                    onClick={() => {
                      setSortField('time');
                      setSortAsc(!sortAsc);
                    }}
                  >
                    Time (s) {sortField === 'time' ? (sortAsc ? '▲' : '▼') : ''}
                  </th>
                )}
                <th>Status / Category Breakdown</th>
              </tr>
            </thead>
            <tbody>
              {filteredData.length > 0 ? (
                filteredData.map((row) => (
                  <tr key={row.id} className={row.isTop10 ? styles.rowTop10 : ''}>
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
                      <strong className={styles.rollNoText}>{row.rollNo}</strong>
                    </td>
                    <td className={styles.nameText}>{row.name}</td>
                    <td className={styles.tdNumeric}>
                      <strong className={styles.scoreText}>{row.score} pts</strong>
                    </td>
                    {filter === 'debugging' && (
                      <td className={styles.tdNumeric}>
                        <span className={styles.solvedBadge}>{row.problemsSolved ?? 0}</span>
                      </td>
                    )}
                    {(filter === 'round1' || filter === 'round2' || filter === 'active') && (
                      <td className={styles.tdNumeric}>
                        {row.time !== undefined && row.time > 0 ? `${row.time}s` : '—'}
                      </td>
                    )}
                    <td>
                      <span className={styles.statusPill}>{row.statusText}</span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className={styles.noResultsCell}>
                    {loading ? 'Loading live competition standings...' : 'No participant records match the current filter.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
