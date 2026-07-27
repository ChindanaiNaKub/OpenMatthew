/**
 * The models Matthew exposes.
 *
 * Mirrors the list shipped in Matthew's own frontend bundle — the only
 * authoritative source, since there is no public API for it. Re-check
 * against the bundle when models look stale; see `npm run check-api`.
 *
 * Note the model id a caller asks for does not actually pick the model:
 * Matthew resolves it from the user's default assistant (`aid`), and the
 * chat request carries no model field at all. This list exists so OpenAI
 * clients have something to enumerate and validate against.
 */

export interface MatthewModel {
  id: string;
  name: string;
  reasoning: boolean;
}

export const MATTHEW_MODELS: readonly MatthewModel[] = [
  { id: "gpt-5.5", name: "GPT-5.5", reasoning: true },
  { id: "gpt-5.4", name: "GPT-5.4", reasoning: true },
  { id: "gpt-5.4-mini", name: "GPT-5.4 Mini", reasoning: true },
  { id: "gpt-5.2", name: "GPT-5.2", reasoning: true },
  { id: "gpt-5-mini", name: "GPT-5 Mini", reasoning: true },
  { id: "gpt-4.1", name: "GPT-4.1", reasoning: false },
  { id: "gpt-4o", name: "GPT-4o", reasoning: false },
  { id: "gpt-4o-mini", name: "GPT-4o Mini", reasoning: false },
];

/** OpenAI's `GET /v1/models` response shape. */
export function toOpenAIModelList(): {
  object: "list";
  data: Array<{ id: string; object: "model"; created: number; owned_by: string }>;
} {
  return {
    object: "list",
    data: MATTHEW_MODELS.map((model) => ({
      id: model.id,
      object: "model" as const,
      created: 0,
      owned_by: "cmu-matthew",
    })),
  };
}
