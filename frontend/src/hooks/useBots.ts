import { useState, useEffect } from 'react';
import { Bot } from '../lib/types';
import { modelPolicy } from '../lib/modelPolicy';
import { api } from '../lib/api';
export function useBots() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [selectedBot, setSelectedBot] = useState<Bot | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { let active = true; api.getBots().then(data => { if (active) { const restored = data.map(withSavedOptions); setBots(restored); setSelectedBot(restored[0] || null); } }).catch(e => { if (active) setError(String(e)); }); return () => { active = false; }; }, []);
  const createBot = async (data: Partial<Bot>, select = true) => { const bot = { ...await api.createBot(data), defaultOptions: data.defaultOptions }; try { localStorage.setItem('grokbot-options-' + bot.id, JSON.stringify(data.defaultOptions || {})); } catch {} setBots(prev => [...prev, bot]); if (select) setSelectedBot(bot); return bot; };
  const refreshBots = async () => { setBots((await api.getBots()).map(withSavedOptions)); setError(''); };
  return { refreshBots, bots, selectedBot, setSelectedBot, createBot, error };
}

function withSavedOptions(bot: Bot): Bot {
  try { return { ...bot, defaultOptions: modelPolicy(JSON.parse(localStorage.getItem('grokbot-options-' + bot.id) || '{}')) }; } catch { return bot; }
}
