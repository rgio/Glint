import { createHash } from 'node:crypto';

/** Every vector is stored at this size (the `halfvec(512)` column). */
export const EMBEDDING_DIMENSIONS = 512;

/**
 * Turns text into unit-length vectors. `model` names the model and size, e.g.
 * `text-embedding-3-small@512`; it's stored with every vector, so changing models means
 * re-embedding in the background and switching which model queries read.
 */
export interface Embedder {
  readonly model: string;
  embed(texts: string[]): Promise<Float32Array[]>;
}

export class EmbedderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export function normalize(v: Float32Array): Float32Array {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm === 0) return v;
  return v.map((x) => x / norm);
}

/** Cosine similarity of unit vectors. */
export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

export const inputHash = (text: string) => createHash('sha256').update(text).digest('base64url').slice(0, 22);

/** Roughly 4 characters per token; keeps inputs under the model's 8k-token limit. */
const MAX_INPUT_CHARS = 24_000;
const BATCH = 96;

/**
 * OpenAI embeddings (`text-embedding-3-small` by default), shortened to 512 dimensions with the
 * API's `dimensions` parameter. Sends text to OpenAI: listener notes included, so it's off unless
 * configured (see the privacy section of 06-data-layer-plan.md).
 */
export class OpenAIEmbedder implements Embedder {
  readonly model: string;

  constructor(
    private opts: { apiKey: string; model?: string; baseUrl?: string; fetch?: typeof fetch },
  ) {
    this.model = `${opts.model ?? 'text-embedding-3-small'}@${EMBEDDING_DIMENSIONS}`;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += BATCH) out.push(...(await this.batch(texts.slice(i, i + BATCH))));
    return out;
  }

  private async batch(texts: string[]): Promise<Float32Array[]> {
    let res: Response;
    try {
      res = await (this.opts.fetch ?? fetch)(`${this.opts.baseUrl ?? 'https://api.openai.com/v1'}/embeddings`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.opts.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.opts.model ?? 'text-embedding-3-small',
          input: texts.map((t) => t.slice(0, MAX_INPUT_CHARS) || ' '),
          dimensions: EMBEDDING_DIMENSIONS,
        }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      throw new EmbedderError(`Could not reach the embeddings API: ${(err as Error).message}`, true);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new EmbedderError(`Embeddings API returned ${res.status}: ${detail.slice(0, 200)}`, res.status === 429 || res.status >= 500);
    }
    const body = (await res.json()) as { data: { index: number; embedding: number[] }[] };
    return body.data.sort((a, b) => a.index - b.index).map((d) => normalize(Float32Array.from(d.embedding)));
  }
}

const STOPWORDS = new Set(
  'a an and are as at be but by for from has have i in is it its of on or so that the their there this to was we were what when which who will with you your'.split(' '),
);

/**
 * Feature hashing over words and word pairs: no model and no network, so similar wording gives
 * similar vectors and nothing else. For tests, and for trying discovery locally without sending
 * text to a third party. Not good enough for production recommendations.
 */
export class HashingEmbedder implements Embedder {
  readonly model = `hashing-v1@${EMBEDDING_DIMENSIONS}`;

  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((text) => {
      const v = new Float32Array(EMBEDDING_DIMENSIONS);
      const words = text
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length > 1 && !STOPWORDS.has(w));
      const features = [...words, ...words.slice(1).map((w, i) => `${words[i]} ${w}`)];
      for (const f of features) {
        const h = createHash('md5').update(f).digest();
        const slot = h.readUInt32LE(0) % EMBEDDING_DIMENSIONS;
        v[slot]! += h[4]! & 1 ? 1 : -1;
      }
      return normalize(v);
    });
  }
}
