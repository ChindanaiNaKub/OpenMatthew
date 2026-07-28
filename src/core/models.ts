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
export function toOpenAIModelList(models: readonly { id: string }[] = MATTHEW_MODELS): {
  object: "list";
  data: Array<{ id: string; object: "model"; created: number; owned_by: string }>;
} {
  return {
    object: "list",
    data: models.map((model) => ({
      id: model.id,
      object: "model" as const,
      created: 0,
      owned_by: "cmu-matthew",
    })),
  };
}

/**
 * Ask Matthew which models it currently offers.
 *
 * The hardcoded list above is a mirror of the bundle and has already gone
 * stale once — it predated `gpt-5.5`, `gpt-5.4` and `gpt-5.4-mini`, and it
 * still describes every model as OpenAI's when Matthew reports a
 * `provider` field with other values. This endpoint is the live answer.
 *
 * Returns null rather than throwing, because the caller's fallback is
 * always the static list: an unreachable Matthew must not turn
 * `GET /v1/models` into an error page in someone's model picker.
 */
export async function fetchAvailableModels(
  accessToken: string,
  apiBase: string,
): Promise<MatthewModel[] | null> {
  try {
    const response = await fetch(`${apiBase}/api/available_models`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;

    const body = (await response.json()) as { models?: unknown };
    if (!Array.isArray(body.models) || body.models.length === 0) return null;

    const models = body.models
      .map((entry) => {
        const model = entry as { id?: unknown; name?: unknown };
        if (typeof model.id !== "string" || !model.id) return null;
        return {
          id: model.id,
          name: typeof model.name === "string" ? model.name : model.id,
          // Matthew does not report this; it only exists to describe the
          // static list, and guessing it from an id would be worse than
          // admitting we do not know.
          reasoning: false,
        };
      })
      .filter((model): model is MatthewModel => model !== null);

    return models.length > 0 ? models : null;
  } catch {
    return null;
  }
}

/**
 * Whether the caller has opted into letting the `model` parameter take
 * effect.
 *
 * Off by default on purpose. Honouring `model` means calling
 * `update_default_llm`, which does not scope to this request — it changes
 * the user's default assistant, so their browser session follows whatever
 * their agent last asked for. An OpenAI-compatible proxy silently
 * rewriting account settings is a surprise, and surprises about someone
 * else's account are the kind you do not get to take back.
 */
export function modelSwitchEnabled(): boolean {
  const flag = process.env.MATTHEW_ALLOW_MODEL_SWITCH;
  return flag === "1" || flag === "true";
}

/** Models this process has already selected, to avoid a PATCH per request. */
const selectedModels = new Map<string, string>();

/** Forget the memo. Tests need this; nothing else should. */
export function resetSelectedModels(): void {
  selectedModels.clear();
}

/**
 * Point the user's assistant at a given model, if it is not already there.
 *
 * Returns true when the model is believed to be in effect. The memo only
 * knows about switches *this process* made — someone changing the model in
 * the Matthew web UI will not invalidate it, so the first request after
 * that may run on the wrong model. Re-reading the assistant before every
 * request would cost a round trip on the hot path to close a gap that
 * costs one request, which is the wrong trade.
 */
export async function selectModel(
  model: string,
  accessToken: string,
  sessionToken: string,
  assistantId: string,
  apiBase: string,
): Promise<boolean> {
  if (!model || !assistantId || assistantId === "default") return false;
  if (selectedModels.get(assistantId) === model) return true;

  try {
    const response = await fetch(`${apiBase}/api/update_default_llm`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ token: sessionToken, model, assist_id: assistantId }),
    });

    if (!response.ok) return false;

    selectedModels.set(assistantId, model);
    return true;
  } catch {
    // A failed switch is not a failed request — the reply still comes back,
    // just from whichever model the assistant was already on.
    return false;
  }
}
