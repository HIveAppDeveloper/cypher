import { useState, useEffect } from 'react';
import { Bot } from '../lib/types';
import { modelPolicy } from '../lib/modelPolicy';
import { api } from '../lib/api';
export function useBots() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [selectedBot, setSelectedBot] = useState<Bot | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => { let active = true; api.getBots().then(data => { if (active) { const restored = data.map(withSavedOptions); setBots(restored); setError(''); } }).catch(e => { if (active) setError(String(e).replace(/^Error: /, '')); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  const createBot = async (data: Partial<Bot>, select = true, clientRequestId?: string) => { const bot = { ...await api.createBot(data, clientRequestId), defaultOptions: data.defaultOptions }; try { localStorage.setItem('grokbot-options-' + bot.id, JSON.stringify(data.defaultOptions || {})); } catch {} setBots(prev => [...prev.filter(saved => saved.id !== bot.id), bot]); if (select) setSelectedBot(bot); return bot; };
  const refreshBots = async () => { setLoading(true); setError(''); try { const updated=(await api.getBots()).map(withSavedOptions);setBots(updated);setSelectedBot(current=>current?updated.find(bot=>bot.id===current.id)||null:null); } catch (e) { const message=String(e).replace(/^Error: /, '');setError(message);throw e; } finally { setLoading(false); } };
  return { refreshBots, bots, selectedBot, setSelectedBot, createBot, error, loading };
}

function withSavedOptions(bot: Bot): Bot {
  try { return { ...bot, defaultOptions: modelPolicy(JSON.parse(localStorage.getItem('grokbot-options-' + bot.id) || '{}')) }; } catch { return bot; }
}
