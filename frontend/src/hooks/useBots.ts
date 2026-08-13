import { useState, useEffect, useCallback } from 'react';
import { Bot, BotStatus } from '../lib/types';
import { api } from '../lib/api';
import { useWebSocket } from './useWebSocket';

export function useBots() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedBot, setSelectedBot] = useState<Bot | null>(null);
  const { lastMessage } = useWebSocket('default');

  const fetchBots = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await api.getBots().catch(() => [
        { id: '1', name: 'DevBot', role: 'Senior Developer', description: 'Writes code', avatar: 'D', status: BotStatus.ONLINE, llmModel: 'gpt-4', toolsEnabled: ['shell'], systemPrompt: 'You are a dev.' } as Bot
      ]);
      setBots(data);
      if (data.length > 0 && !selectedBot) {
        setSelectedBot(data[0]);
      }
    } catch (error) {
      console.error('Failed to fetch bots', error);
    } finally {
      setIsLoading(false);
    }
  }, [selectedBot]);

  useEffect(() => {
    fetchBots();
  }, [fetchBots]);

  useEffect(() => {
    if (lastMessage && lastMessage.type === 'bot_status_update') {
      setBots(prev => prev.map(b => b.id === lastMessage.payload.botId ? { ...b, status: lastMessage.payload.status } : b));
      if (selectedBot?.id === lastMessage.payload.botId) {
        setSelectedBot(prev => prev ? { ...prev, status: lastMessage.payload.status } : prev);
      }
    }
  }, [lastMessage, selectedBot]);

  const createBot = async (botData: Partial<Bot>) => {
    const newBot = await api.createBot(botData).catch(() => ({ ...botData, id: Date.now().toString(), status: BotStatus.IDLE } as Bot));
    setBots(prev => [...prev, newBot]);
    return newBot;
  };

  const updateBot = async (id: string, botData: Partial<Bot>) => {
    const updated = await api.updateBot(id, botData).catch(() => ({ ...bots.find(b=>b.id===id), ...botData } as Bot));
    setBots(prev => prev.map(b => b.id === id ? updated : b));
    if (selectedBot?.id === id) setSelectedBot(updated);
  };

  const deleteBot = async (id: string) => {
    await api.deleteBot(id).catch(() => {});
    setBots(prev => prev.filter(b => b.id !== id));
    if (selectedBot?.id === id) setSelectedBot(null);
  };

  return { bots, isLoading, createBot, updateBot, deleteBot, selectedBot, setSelectedBot };
}
