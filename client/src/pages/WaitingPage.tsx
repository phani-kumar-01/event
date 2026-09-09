import React from 'react';
import styles from './WaitingPage.module.css';

export default function WaitingPage() {
  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.icon}>🕐</div>
        <h1 className={styles.title}>SASI Engineers' Day</h1>
        <p className={styles.msg}>No competition is currently running.</p>
        <p className={styles.sub}>Please wait for the competition to begin, or contact the administrator.</p>
        <button
          className={styles.refresh}
          onClick={() => window.location.reload()}
        >
          Refresh
        </button>
      </div>
    </div>
  );
}
