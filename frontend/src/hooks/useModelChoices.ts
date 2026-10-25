import { useEffect, useMemo, useState } from 'react';
import { MODEL_CHOICES } from '../lib/presets';
import { choicesFromNicrronCatalog } from '../lib/nicrronCatalog';
import type { NicrronCatalogStatus, NicrronModelChoice } from '../lib/nicrronCatalog';

type NicrronCatalogSnapshot = {
  choices: NicrronModelChoice[];
  status: Exclude<NicrronCatalogStatus, 'idle' | 'loading'>;
};

const CATALOG_CACHE_MS = 15_000;
let cachedCatalog: { expiresAt: number; value: NicrronCatalogSnapshot } | null = null;
let catalogRequest: Promise<NicrronCatalogSnapshot> | null = null;

function loadNicrronCatalog(): Promise<NicrronCatalogSnapshot> {
  if (cachedCatalog && cachedCatalog.expiresAt > Date.now()) {
    return Promise.resolve(cachedCatalog.value);
  }
  if (catalogRequest) return catalogRequest;

  catalogRequest = fetch('/api/runtime/model-catalog/nicrron', { cache: 'no-store' })
    .then(async response => {
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error('catalog_unavailable');
      const choices = choicesFromNicrronCatalog(body);
      const result = body && typeof body === 'object' ? body as { configured?: unknown } : {};
      return {
        choices,
        status: choices.length ? 'ready' : result.configured === true ? 'unavailable' : 'not_configured',
      } as NicrronCatalogSnapshot;
    })
    .catch(() => ({ choices: [], status: 'unavailable' as const }))
    .then(value => {
      cachedCatalog = { expiresAt: Date.now() + CATALOG_CACHE_MS, value };
      return value;
    })
    .finally(() => { catalogRequest = null; });
  return catalogRequest;
}

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
    let active = true;
    setNicrronStatus('loading');
    void loadNicrronCatalog().then(({ choices, status }) => {
      if (!active) return;
      setNicrronChoices(choices);
      setNicrronStatus(status);
    });
    return () => { active = false; };
  }, []);

  const choices = useMemo(
    () => [...(MODEL_CHOICES as unknown as ModelChoice[]), ...nicrronChoices],
    [nicrronChoices],
  );
  return { choices, nicrronChoices, nicrronStatus };
}
