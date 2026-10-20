import { useState, useEffect } from 'react';
import { Bot } from '../lib/types';
import { api } from '../lib/api';
export function useBots() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [selectedBot, setSelectedBot] = useState<Bot | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { let active = true; api.getBots().then(data => { if (active) { setBots(data); setSelectedBot(data[0] || null); } }).catch(e => { if (active) setError(String(e)); }); return () => { active = false; }; }, []);
  const createBot = async (data: Partial<Bot>) => { const bot = await api.createBot(data); setBots(prev => [...prev, bot]); setSelectedBot(bot); return bot; };
  return { bots, selectedBot, setSelectedBot, createBot, error };
}
