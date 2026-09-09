import React from 'react';
import styles from './ConnectionBadge.module.css';
import { ConnectionStatus } from '../hooks/useConnectionStatus';

interface Props {
  status: ConnectionStatus;
}

const labels: Record<ConnectionStatus, string> = {
  connected: 'Connected',
  reconnecting: 'Reconnecting...',
  offline: 'Offline',
};

export default function ConnectionBadge({ status }: Props) {
  return (
    <span className={`${styles.badge} ${styles[status]}`}>
      <span className={styles.dot} aria-hidden="true" />
      {labels[status]}
    </span>
  );
}
