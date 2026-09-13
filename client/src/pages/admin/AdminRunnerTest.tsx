import React, { useState, useEffect, useRef } from 'react';
import { getSocket } from '../../services/socket';
import api from '../../services/api';

interface BenchmarkState {
  run: {
    id: string;
    name: string;
    status: string;
    createdAt: string;
    startedAt?: string;
    completedAt?: string;
    totalJobs: number;
    completedJobs: number;
    failedJobs: number;
    totalWallTimeMs?: number;
  } | null;
  counts: {
    queued: number;
    assigned: number;
    completed: number;
    failed: number;
  };
  queuedMetadata?: Array<{ id: string; testUserId: string }>;
  performance: {
    compile: { avg: number; p50: number; p95: number; p99: number };
    execution: { avg: number; p50: number; p95: number; p99: number };
    queueWait: { avg: number; p50: number; p95: number; p99: number };
    total: { avg: number; p50: number; p95: number; p99: number };
  };
  activeJobs: Array<{
    id: string;
    testUserId: string;
    status: string;
    workerId: string;
    compileTimeMs?: number;
    executionTimeMs?: number;
    assignedAt?: string;
  }>;
  recentJobs: Array<any>;
  recentEvents: Array<{
    id: string;
    eventType: string;
    jobId?: string;
    workerId?: string;
    testUserId?: string;
    timestamp: string;
    payload?: any;
  }>;
}

export default function AdminRunnerTest() {
  const [state, setState] = useState<BenchmarkState | null>(null);
  const [runners, setRunners] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [eventLogs, setEventLogs] = useState<string[]>([]);
  const timelineEndRef = useRef<HTMLDivElement>(null);

  const fetchStatus = async () => {
    try {
      const res = await api.get('/admin/benchmark/status');
      if (res.data.success) {
        setState(res.data.data);
        setRunners(res.data.runners || []);
      }
    } catch (err: any) {
      // Ignore initial 404 before run creation
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 1000);

    const socket = getSocket();
    if (socket) {
      socket.on('runner_benchmark:event', (ev: any) => {
        const timeStr = new Date(ev.timestamp).toLocaleTimeString();
        let desc = `${timeStr} [${ev.eventType}]`;
        if (ev.testUserId) desc += ` ${ev.testUserId}`;
        if (ev.workerId) desc += ` (${ev.workerId})`;
        if (ev.payload?.stage) desc += ` → ${ev.payload.stage}`;
        if (ev.payload?.status) desc += ` Result: ${ev.payload.status}`;
        if (ev.payload?.compileTimeMs) desc += ` (Compile: ${ev.payload.compileTimeMs}ms)`;
        if (ev.payload?.executionTimeMs) desc += ` (Exec: ${ev.payload.executionTimeMs}ms)`;

        setEventLogs((prev) => [...prev.slice(-150), desc]);
      });

      socket.on('runner_benchmark:status', (data: any) => {
        setState(data);
      });
    }

    return () => {
      clearInterval(interval);
      if (socket) {
        socket.off('runner_benchmark:event');
        socket.off('runner_benchmark:status');
      }
    };
  }, []);

  useEffect(() => {
    timelineEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [eventLogs]);

  const handleStartBenchmark = async () => {
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const res = await api.post('/admin/benchmark/start', { count: 120 });
      if (res.data.success) {
        setSuccess(`Benchmark Run ${res.data.runId} started with 120 real jobs in Supabase!`);
        fetchStatus();
      } else {
        setError(res.data.error || 'Failed to start benchmark');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCleanup = async () => {
    if (!window.confirm('Are you sure you want to delete benchmark tables and BENCH test accounts? Real student data will NOT be touched.')) {
      return;
    }
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const res = await api.post('/admin/benchmark/cleanup');
      if (res.data.success) {
        setSuccess('Benchmark data cleaned up successfully.');
        setState(null);
        setEventLogs([]);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const total = state?.run?.totalJobs || 120;
  const completed = state?.counts?.completed || 0;
  const failed = state?.counts?.failed || 0;
  const queued = state?.counts?.queued || 0;
  const running = state?.counts?.assigned || 0;
  const finished = completed + failed;
  const progressPct = total > 0 ? Math.round((finished / total) * 100) : 0;

  // Build worker status map for 8 slots
  const workerSlots = Array.from({ length: 8 }, (_, i) => {
    const slotId = `worker-${i + 1}`;
    const active = state?.activeJobs?.find((j) => j.workerId === slotId);
    return {
      slotId,
      status: active ? active.status : 'IDLE',
      user: active ? active.testUserId : null,
      jobId: active ? active.id : null,
    };
  });

  return (
    <div style={{ padding: '1.5rem', color: '#f8fafc', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', margin: 0, color: '#f8fafc' }}>
              ⚡ C Runner End-to-End Test (Real Supabase PostgreSQL)
            </h1>
            <span
              style={{
                fontSize: '0.75rem',
                padding: '0.2rem 0.6rem',
                borderRadius: '9999px',
                background: runners.length > 0 ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                color: runners.length > 0 ? '#34d399' : '#f87171',
                border: runners.length > 0 ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(239, 68, 68, 0.4)',
                fontWeight: '600',
              }}
            >
              {runners.length > 0 ? `LOCAL RUNNER CONNECTED (${runners[0]?.maxConcurrency || 8} Workers)` : 'RUNNER DISCONNECTED'}
            </span>
          </div>
          <p style={{ color: '#94a3b8', fontSize: '0.875rem', marginTop: '0.25rem' }}>
            Pipeline: Supabase DB ➔ Backend Queue ➔ Outbound WebSocket ➔ Local Linux C Runner (GCC Sandbox) ➔ Supabase DB ➔ WebSocket Broadcast
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            onClick={handleStartBenchmark}
            disabled={loading || runners.length === 0}
            style={{
              padding: '0.6rem 1.25rem',
              backgroundColor: runners.length > 0 ? '#2563eb' : '#475569',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              fontWeight: '600',
              cursor: runners.length > 0 ? 'pointer' : 'not-allowed',
            }}
          >
            {loading ? 'Starting...' : '🚀 Trigger 120-User Run'}
          </button>

          <button
            onClick={handleCleanup}
            disabled={loading}
            style={{
              padding: '0.6rem 1rem',
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              color: '#f87171',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              borderRadius: '6px',
              fontWeight: '600',
              cursor: 'pointer',
            }}
          >
            🧹 Cleanup Test Data
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '0.75rem 1rem', backgroundColor: 'rgba(239, 68, 68, 0.2)', border: '1px solid #ef4444', borderRadius: '6px', color: '#fca5a5', marginBottom: '1rem' }}>
          {error}
        </div>
      )}

      {success && (
        <div style={{ padding: '0.75rem 1rem', backgroundColor: 'rgba(16, 185, 129, 0.2)', border: '1px solid #10b981', borderRadius: '6px', color: '#6ee7b7', marginBottom: '1rem' }}>
          {success}
        </div>
      )}

      {/* Progress Bar */}
      <div style={{ background: '#1e293b', padding: '1.25rem', borderRadius: '8px', border: '1px solid #334155', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <div style={{ fontSize: '0.875rem', color: '#94a3b8' }}>
            Run ID: <strong style={{ color: '#f1f5f9' }}>{state?.run?.id || 'No active run'}</strong>
          </div>
          <div style={{ fontSize: '0.875rem', fontWeight: 'bold', color: '#38bdf8' }}>
            {finished} / {total} Jobs ({progressPct}%)
          </div>
        </div>

        <div style={{ background: '#334155', borderRadius: '9999px', height: '12px', overflow: 'hidden' }}>
          <div
            style={{
              background: 'linear-gradient(90deg, #38bdf8, #2563eb)',
              height: '100%',
              width: `${progressPct}%`,
              transition: 'width 0.3s ease',
            }}
          />
        </div>
      </div>

      {/* Metric Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div style={{ background: '#1e293b', padding: '1rem', borderRadius: '8px', border: '1px solid #334155' }}>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase' }}>Queued in Supabase</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 'bold', color: '#fbbf24', marginTop: '0.25rem' }}>{queued}</div>
        </div>

        <div style={{ background: '#1e293b', padding: '1rem', borderRadius: '8px', border: '1px solid #334155' }}>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase' }}>Executing in Sandbox</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 'bold', color: '#38bdf8', marginTop: '0.25rem' }}>{running}</div>
        </div>

        <div style={{ background: '#1e293b', padding: '1rem', borderRadius: '8px', border: '1px solid #334155' }}>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase' }}>Completed (PASSED)</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 'bold', color: '#34d399', marginTop: '0.25rem' }}>{completed}</div>
        </div>

        <div style={{ background: '#1e293b', padding: '1rem', borderRadius: '8px', border: '1px solid #334155' }}>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase' }}>Failed / Error</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 'bold', color: '#f87171', marginTop: '0.25rem' }}>{failed}</div>
        </div>

        <div style={{ background: '#1e293b', padding: '1rem', borderRadius: '8px', border: '1px solid #334155' }}>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase' }}>Total Wall Time</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 'bold', color: '#a78bfa', marginTop: '0.25rem' }}>
            {state?.run?.totalWallTimeMs ? `${(state.run.totalWallTimeMs / 1000).toFixed(2)}s` : '--'}
          </div>
        </div>
      </div>

      {/* Live 8-Worker Execution Grid */}
      <div style={{ background: '#1e293b', padding: '1.25rem', borderRadius: '8px', border: '1px solid #334155', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: '600', margin: '0 0 1rem 0', color: '#38bdf8' }}>
          ⚡ Live Worker Slots (8 Concurrency Ceiling)
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem' }}>
          {workerSlots.map((w) => (
            <div
              key={w.slotId}
              style={{
                background: w.status === 'IDLE' ? '#0f172a' : '#1e3a8a',
                border: w.status === 'IDLE' ? '1px solid #334155' : '1px solid #38bdf8',
                borderRadius: '6px',
                padding: '0.75rem',
                textAlign: 'center',
                transition: 'all 0.2s',
              }}
            >
              <div style={{ fontSize: '0.75rem', fontWeight: '600', color: '#94a3b8' }}>{w.slotId}</div>
              <div
                style={{
                  fontSize: '0.85rem',
                  fontWeight: 'bold',
                  marginTop: '0.25rem',
                  color: w.status === 'EXECUTING' ? '#fbbf24' : w.status === 'COMPILING' ? '#38bdf8' : '#64748b',
                }}
              >
                {w.status}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#e2e8f0', marginTop: '0.25rem' }}>{w.user || '—'}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Durable Database Queue Metadata */}
      <div style={{ background: '#1e293b', padding: '1.25rem', borderRadius: '8px', border: '1px solid #334155', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: '600', margin: 0, color: '#fbbf24' }}>
            📥 Durable Database Queue ({queued} remaining in Supabase PostgreSQL)
          </h2>
          <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
            Strict Worker Pool: Only light metadata stored; source code fetched on-demand per free worker slot via FOR UPDATE SKIP LOCKED
          </span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', maxHeight: '120px', overflowY: 'auto' }}>
          {state?.queuedMetadata && state.queuedMetadata.length > 0 ? (
            state.queuedMetadata.map((q: any) => (
              <span key={q.id} style={{ background: '#0f172a', border: '1px solid #334155', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', color: '#cbd5e1' }}>
                {q.testUserId}
              </span>
            ))
          ) : queued > 0 ? (
            <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>{queued} jobs waiting in database</span>
          ) : (
            <span style={{ fontSize: '0.85rem', color: '#34d399', fontWeight: '600' }}>✓ Queue Empty — All jobs claimed & completed!</span>
          )}
        </div>
      </div>

      {/* Performance & Real-Time Timeline Columns */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
        {/* Performance Breakdown */}
        <div style={{ background: '#1e293b', padding: '1.25rem', borderRadius: '8px', border: '1px solid #334155' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: '600', margin: '0 0 1rem 0', color: '#38bdf8' }}>
            📊 Latency & Performance Breakdown (Real DB)
          </h2>
          <table style={{ width: '100%', fontSize: '0.875rem', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #334155', color: '#94a3b8' }}>
                <th style={{ textAlign: 'left', padding: '0.5rem 0' }}>Stage</th>
                <th style={{ textAlign: 'right', padding: '0.5rem 0' }}>Average</th>
                <th style={{ textAlign: 'right', padding: '0.5rem 0' }}>P50</th>
                <th style={{ textAlign: 'right', padding: '0.5rem 0' }}>P95</th>
                <th style={{ textAlign: 'right', padding: '0.5rem 0' }}>P99</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderBottom: '1px solid #334155' }}>
                <td style={{ padding: '0.6rem 0', color: '#f1f5f9' }}>GCC Compile</td>
                <td style={{ textAlign: 'right', color: '#94a3b8' }}>{state?.performance?.compile?.avg || 0} ms</td>
                <td style={{ textAlign: 'right', color: '#94a3b8' }}>{state?.performance?.compile?.p50 || 0} ms</td>
                <td style={{ textAlign: 'right', color: '#38bdf8', fontWeight: 'bold' }}>{state?.performance?.compile?.p95 || 0} ms</td>
                <td style={{ textAlign: 'right', color: '#94a3b8' }}>{state?.performance?.compile?.p99 || 0} ms</td>
              </tr>
              <tr style={{ borderBottom: '1px solid #334155' }}>
                <td style={{ padding: '0.6rem 0', color: '#f1f5f9' }}>Sandbox Exec</td>
                <td style={{ textAlign: 'right', color: '#94a3b8' }}>{state?.performance?.execution?.avg || 0} ms</td>
                <td style={{ textAlign: 'right', color: '#94a3b8' }}>{state?.performance?.execution?.p50 || 0} ms</td>
                <td style={{ textAlign: 'right', color: '#38bdf8', fontWeight: 'bold' }}>{state?.performance?.execution?.p95 || 0} ms</td>
                <td style={{ textAlign: 'right', color: '#94a3b8' }}>{state?.performance?.execution?.p99 || 0} ms</td>
              </tr>
              <tr style={{ borderBottom: '1px solid #334155' }}>
                <td style={{ padding: '0.6rem 0', color: '#f1f5f9' }}>Queue Wait</td>
                <td style={{ textAlign: 'right', color: '#94a3b8' }}>{state?.performance?.queueWait?.avg || 0} ms</td>
                <td style={{ textAlign: 'right', color: '#94a3b8' }}>{state?.performance?.queueWait?.p50 || 0} ms</td>
                <td style={{ textAlign: 'right', color: '#fbbf24', fontWeight: 'bold' }}>{state?.performance?.queueWait?.p95 || 0} ms</td>
                <td style={{ textAlign: 'right', color: '#94a3b8' }}>{state?.performance?.queueWait?.p99 || 0} ms</td>
              </tr>
              <tr>
                <td style={{ padding: '0.6rem 0', color: '#f1f5f9', fontWeight: 'bold' }}>Total End-to-End</td>
                <td style={{ textAlign: 'right', color: '#f1f5f9', fontWeight: 'bold' }}>{state?.performance?.total?.avg || 0} ms</td>
                <td style={{ textAlign: 'right', color: '#f1f5f9', fontWeight: 'bold' }}>{state?.performance?.total?.p50 || 0} ms</td>
                <td style={{ textAlign: 'right', color: '#34d399', fontWeight: 'bold' }}>{state?.performance?.total?.p95 || 0} ms</td>
                <td style={{ textAlign: 'right', color: '#f1f5f9', fontWeight: 'bold' }}>{state?.performance?.total?.p99 || 0} ms</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Real-Time Event Feed Timeline */}
        <div style={{ background: '#1e293b', padding: '1.25rem', borderRadius: '8px', border: '1px solid #334155' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: '600', margin: '0 0 0.5rem 0', color: '#38bdf8' }}>
            📡 Real-Time WebSocket Event Feed
          </h2>
          <div
            style={{
              background: '#0f172a',
              borderRadius: '6px',
              padding: '0.75rem',
              height: '180px',
              overflowY: 'auto',
              fontFamily: 'monospace',
              fontSize: '0.8rem',
              color: '#94a3b8',
            }}
          >
            {eventLogs.length === 0 ? (
              <div style={{ color: '#475569' }}>Waiting for benchmark events...</div>
            ) : (
              eventLogs.map((log, i) => (
                <div key={i} style={{ padding: '0.15rem 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  {log}
                </div>
              ))
            )}
            <div ref={timelineEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
}
