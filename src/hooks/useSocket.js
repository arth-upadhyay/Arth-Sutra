import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Custom hook to manage WebSocket connection and real-time multi-user sync.
 * Automatically reconnects with exponential backoff if disconnected.
 *
 * @param {Function} onEvent - Callback for received broadcast events { type, data, timestamp }
 * @returns {{ isConnected: boolean, lastMessage: any, send: Function }}
 */
export function useSocket(onEvent) {
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState(null);
  const socketRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    let unmounted = false;
    let delay = 1000;

    function getWsUrl() {
      const loc = window.location;
      const protocol = loc.protocol === 'https:' ? 'wss:' : 'ws:';
      
      // If served directly from Express backend (port 47380 or similar)
      if (loc.port && loc.port !== '5173') {
        return `${protocol}//${loc.host}`;
      }
      
      // If running via Vite dev server (port 5173), Vite proxies /ws
      if (loc.port === '5173') {
        return `${protocol}//${loc.host}/ws`;
      }

      return `${protocol}//${loc.hostname}:47380`;
    }

    function connect() {
      if (unmounted) return;

      const token = localStorage.getItem('arthsutra_token');
      if (!token) {
        // Not authenticated, wait for login
        return;
      }

      let wsUrl = getWsUrl();
      wsUrl += (wsUrl.includes('?') ? '&' : '?') + `token=${encodeURIComponent(token)}`;

      try {
        const ws = new WebSocket(wsUrl);
        socketRef.current = ws;

        ws.onopen = () => {
          if (unmounted) {
            ws.close();
            return;
          }
          setIsConnected(true);
          delay = 1000; // Reset reconnect backoff on successful connect
        };

        ws.onmessage = (event) => {
          try {
            const parsed = JSON.parse(event.data);
            setLastMessage(parsed);
            if (onEventRef.current && typeof onEventRef.current === 'function') {
              onEventRef.current(parsed);
            }
          } catch (err) {
            console.warn('Malformed WebSocket payload:', err);
          }
        };

        ws.onclose = (event) => {
          setIsConnected(false);
          socketRef.current = null;

          // If closed due to unauthorized token (4001), notify auth context to log out
          if (event.code === 4001) {
            window.dispatchEvent(new CustomEvent('fgsb-auth-expired'));
            return;
          }

          if (!unmounted) {
            reconnectTimeoutRef.current = setTimeout(connect, delay);
            delay = Math.min(delay * 1.5, 10000);
          }
        };

        ws.onerror = () => {
          try { ws.close(); } catch { /* ignore */ }
        };
      } catch (err) {
        if (!unmounted) {
          reconnectTimeoutRef.current = setTimeout(connect, delay);
          delay = Math.min(delay * 1.5, 10000);
        }
      }
    }

    connect();

    return () => {
      unmounted = true;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, []);

  const send = useCallback((payload) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(typeof payload === 'string' ? payload : JSON.stringify(payload));
      return true;
    }
    return false;
  }, []);

  return { isConnected, lastMessage, send };
}

export default useSocket;
