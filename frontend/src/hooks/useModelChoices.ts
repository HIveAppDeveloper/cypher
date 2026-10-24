import { useEffect, useMemo, useState } from 'react';
import { MODEL_CHOICES } from '../lib/presets';
import { choicesFromNicrronCatalog } from '../lib/nicrronCatalog';
import type { NicrronCatalogStatus, NicrronModelChoice } from '../lib/nicrronCatalog';

export type ModelChoice = {
  id: string;
  label: string;
  detail: string;
  provider: string;
  model: string;
};

export function useModelChoices(): {
  choices: ModelChoice[];
  nicrronChoices: NicrronModelChoice[];
  nicrronStatus: NicrronCatalogStatus;
} {
  const [nicrronChoices, setNicrronChoices] = useState<NicrronModelChoice[]>([]);
  const [nicrronStatus, setNicrronStatus] = useState<NicrronCatalogStatus>('idle');

  useEffect(() => {
    const controller = new AbortController();
    setNicrronStatus('loading');
    fetch('/api/runtime/model-catalog/nicrron', { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) throw new Error('catalog_unavailable');
        const choices = choicesFromNicrronCatalog(body);
        const configured = Boolean(body && typeof body === 'object' && (body as { configured?: unknown }).configured === true);
        setNicrronChoices(choices);
        setNicrronStatus(choices.length ? 'ready' : configured ? 'unavailable' : 'not_configured');
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setNicrronChoices([]);
          setNicrronStatus('unavailable');
        }
      });
    return () => controller.abort();
  }, []);

  const choices = useMemo(
    () => [...(MODEL_CHOICES as unknown as ModelChoice[]), ...nicrronChoices],
    [nicrronChoices],
  );
  return { choices, nicrronChoices, nicrronStatus };
}
