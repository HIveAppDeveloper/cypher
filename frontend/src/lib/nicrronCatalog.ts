export type NicrronModelChoice = {
  id: string;
  label: string;
  detail: string;
  provider: 'nicrron';
  model: string;
};

export type NicrronCatalogStatus = 'idle' | 'loading' | 'ready' | 'not_configured' | 'unavailable';

const MODEL_ID = /^[a-z0-9][a-z0-9._-]{0,100}\/[a-z0-9][a-z0-9._-]{0,140}$/i;

export function validNicrronModelId(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && MODEL_ID.test(value);
}

export function choicesFromNicrronCatalog(payload: unknown): NicrronModelChoice[] {
  if (!payload || typeof payload !== 'object') return [];
  const result = payload as { configured?: unknown; status?: unknown; models?: unknown };
  if (result.configured !== true || result.status !== 'ready' || !Array.isArray(result.models)) return [];
  const unique = new Map<string, NicrronModelChoice>();
  for (const candidate of result.models) {
    if (!candidate || typeof candidate !== 'object') continue;
    const model = candidate as {
      id?: unknown; name?: unknown; description?: unknown; modality?: unknown; deprecated?: unknown;
    };
    if (!validNicrronModelId(model.id) || model.modality !== 'chat' || model.deprecated === true) continue;
    const name = typeof model.name === 'string' && model.name.trim() ? model.name.trim().slice(0, 160) : model.id;
    const description = typeof model.description === 'string' ? model.description.trim().slice(0, 500) : '';
    unique.set(model.id, {
      id: `nicrron:${model.id}`,
      label: `Nicrron · ${name}`,
      detail: description || `Chat model served through Nicrron.`,
      provider: 'nicrron',
      model: model.id,
    });
  }
  return Array.from(unique.values()).sort((a, b) => a.label.localeCompare(b.label) || a.model.localeCompare(b.model));
}
