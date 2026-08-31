import "server-only";

/**
 * Gemini embeddings, and nothing else.
 *
 * A thin wrapper around the `batchEmbedContents` REST endpoint, separate from
 * `gemini.ts` because the embedding model, the endpoint, and the error
 * semantics are all different:
 *
 *   • `text-embedding-004` rather than whatever generative model the pool
 *     carries — the model column on `api_keys_config` is `gemini-2.5-flash`,
 *     and that is the wrong thing to send to an embedding endpoint.
 *   • No grounding, no retry, no tool negotiation. Embedding is a batch
 *     operation that either works or does not, and rotating past a 429 is the
 *     only recovery worth doing.
 *   • Output dimensions are requested at 384 via `outputDimensionality`,
 *     matching the `vector(384)` columns the schema already carries. Gemini
 *     supports this via Matryoshka truncation — the full model emits 768, and
 *     the first 384 are a valid lower-dimensional embedding.
 *
 * The key pool is reused but the model is overridden, which is why this module
 * imports `loadApiKeys` and reads `.key` without touching `.model`.
 */

import { EMBEDDING_DIMS } from "@/lib/sync/normalize";

import {
  loadApiKeys,
  recordError,
  recordRateLimit,
  recordSuccess,
} from "./keys";

/* ── Configuration ─────────────────────────────────────────────────────── */

const EMBEDDING_MODEL = "text-embedding-004";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/** Per-call timeout. Embedding is fast; 15s is generous. */
const TIMEOUT_MS = 15_000;

/* ── Types ─────────────────────────────────────────────────────────────── */

interface EmbedRequest {
  model: string;
  content: { parts: { text: string }[] };
  outputDimensionality: number;
}

interface EmbedResponse {
  embeddings?: { values: number[] }[];
}

/* ── The call ──────────────────────────────────────────────────────────── */

/**
 * Embed a batch of texts, returning one vector per text.
 *
 * Walks the key pool until one answers, exactly as `gemini.ts` does for
 * generation — same pool, same rotation, same cooldown bookkeeping. The only
 * difference is what is asked: an embedding, not a completion.
 *
 * @param texts  Up to 100 texts to embed. The Gemini batch endpoint accepts
 *               100 per call; callers should chunk before calling if they have
 *               more.
 * @returns      One `number[]` per input text, each of length `EMBEDDING_DIMS`.
 * @throws       When every key in the pool is exhausted or broken.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const keys = await loadApiKeys();
  if (keys.length === 0) {
    throw new Error("[embed] no Gemini API key is configured");
  }

  const requests: EmbedRequest[] = texts.map((text) => ({
    model: `models/${EMBEDDING_MODEL}`,
    content: { parts: [{ text }] },
    outputDimensionality: EMBEDDING_DIMS,
  }));

  let lastError = "every key failed";

  for (const key of keys) {
    try {
      const response = await fetch(
        `${ENDPOINT}/${encodeURIComponent(EMBEDDING_MODEL)}:batchEmbedContents`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": key.key,
          },
          body: JSON.stringify({ requests }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );

      if (response.status === 429 || response.status === 402) {
        recordRateLimit(key, response.status);
        lastError = "every key is rate limited";
        continue;
      }

      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).slice(0, 300);
        recordError(key, response.status, detail);
        lastError = `API error ${String(response.status)}: ${detail.slice(0, 200)}`;
        continue;
      }

      const data = (await response.json()) as EmbedResponse;
      const vectors = validateResponse(data, texts.length);

      recordSuccess(key);
      return vectors;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "network error";
      continue;
    }
  }

  throw new Error(`[embed] ${lastError}`);
}

/**
 * Validates the response and extracts vectors.
 *
 * PostgREST would accept a garbled vector without complaint — it would only
 * surface later as similarity search quietly returning nonsense. So the
 * validation that `toVector` does on ingest, this does at generation.
 */
function validateResponse(data: EmbedResponse, expectedCount: number): number[][] {
  if (data.embeddings?.length !== expectedCount) {
    throw new Error(
      `expected ${String(expectedCount)} embeddings, got ${String(data.embeddings?.length ?? 0)}`,
    );
  }

  const embeddings = data.embeddings;

  return embeddings.map((e, i) => {
    const v = e.values;
    if (!Array.isArray(v) || v.length !== EMBEDDING_DIMS) {
      throw new Error(
        `embedding ${String(i)}: expected ${String(EMBEDDING_DIMS)} dims, got ${String(Array.isArray(v) ? v.length : 0)}`,
      );
    }
    if (!v.every((n) => Number.isFinite(n))) {
      throw new Error(`embedding ${String(i)}: contains non-finite values`);
    }
    return v;
  });
}

/**
 * Whether the deployment has keys that can embed.
 *
 * Embedding uses the same Gemini keys as generation — if one works, both work.
 */
export async function canEmbed(): Promise<boolean> {
  return (await loadApiKeys()).length > 0;
}

export { EMBEDDING_MODEL };
