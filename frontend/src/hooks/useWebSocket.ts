import { useState, useEffect, useCallback, useRef } from 'react';
import { WebSocketMessage } from '../lib/types';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000/ws';

export function useWebSocket(conversationId?: string) {
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const reconnectTimeout = useRef<NodeJS.Timeout>();
  
  const connect = useCallback(() => {
    if (!conversationId) return;
    try {
      ws.current = new WebSocket(`${WS_URL}/${conversationId}`);
      
      ws.current.onopen = () => {
        setIsConnected(true);
        console.log('WS Connected');
      };
      
      ws.current.onclose = () => {
        setIsConnected(false);
        console.log('WS Disconnected, retrying...');
        reconnectTimeout.current = setTimeout(connect, 3000);
      };
      
      ws.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setLastMessage(data);
        } catch (e) {
          console.error('Failed to parse WS message', e);
        }
      };
      
      ws.current.onerror = (err) => {
        console.error('WS Error:', err);
        ws.current?.close();
      };
    } catch (e) {
      console.error('WS Connection failed', e);
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimeout.current);
      if (ws.current) {
        ws.current.close();
      }
    };
  }, [connect]);

  const sendMessage = useCallback((msg: WebSocketMessage) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(msg));
    }
  }, []);
  
  const subscribe = useCallback((channel: string) => {
    sendMessage({ type: 'subscribe', payload: { channel } });
  }, [sendMessage]);

  return { isConnected, sendMessage, subscribe, lastMessage };
}
