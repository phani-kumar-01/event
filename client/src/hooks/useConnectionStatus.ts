import { useState, useEffect } from 'react';
import { getSocket } from '../services/socket';

export type ConnectionStatus = 'connected' | 'reconnecting' | 'offline';

export function useConnectionStatus(): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>('offline');

  useEffect(() => {
    const socket = getSocket();

    const onConnect = () => setStatus('connected');
    const onDisconnect = () => setStatus('offline');
    const onReconnecting = () => setStatus('reconnecting');
    const onReconnect = () => setStatus('connected');
    const onReconnectError = () => setStatus('offline');

    if (socket.connected) setStatus('connected');

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.io.on('reconnect_attempt', onReconnecting);
    socket.io.on('reconnect', onReconnect);
    socket.io.on('reconnect_error', onReconnectError);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.io.off('reconnect_attempt', onReconnecting);
      socket.io.off('reconnect', onReconnect);
      socket.io.off('reconnect_error', onReconnectError);
    };
  }, []);

  return status;
}
