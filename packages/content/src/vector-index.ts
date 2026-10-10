import type { Sql } from 'postgres';

import { dot, EMBEDDING_DIMENSIONS } from './embedder';

// The boundary between callers and wherever vectors are searched. The `embeddings` table is the
// system of record; PgvectorIndex searches it in place. A dedicated store (e.g. Qdrant) would be
// another implementation, rebuilt from that table. See "Vector storage" in 06-data-layer-plan.md.

export type OwnerKind = 'chunk' | 'episode' | 'highlight' | 'note' | 'profile';

export type VectorRow = {
  ownerKind: OwnerKind;
  ownerId: string;
  /** Null for global content (transcripts, episodes); set for a listener's own vectors. */
  userId: string | null;
  episodeId: string | null;
  podcastId: string | null;
  language: string | null;
  startMs: number | null;
  model: string;
  inputHash: string;
  vec: Float32Array;
};

export type VectorFilter = {
  model: string;
  ownerKinds: OwnerKind[];
  /** Search this listener's vectors; omitted or null searches global content only. */
  userId?: string | null;
  excludeEpisodeIds?: string[];
  /** Keep only this language (rows with no language are kept too). */
  language?: string | null;
};

export type VectorHit = {
  ownerKind: OwnerKind;
  ownerId: string;
  episodeId: string | null;
  podcastId: string | null;
  startMs: number | null;
  /** Cosine similarity, 1 is identical. */
  score: number;
};

/** What every search reports, for the switch triggers (latency, underfill). */
export type SearchMetrics = { ms: number; k: number; returned: number; filtered: boolean; global: boolean };

export interface VectorIndex {
  upsert(rows: VectorRow[]): Promise<void>;
  delete(keys: { ownerKind: OwnerKind; ownerId: string }[]): Promise<void>;
  /** Deletes an episode's vectors of one kind except `keep`, e.g. chunks of a replaced transcript. */
  prune(ownerKind: OwnerKind, episodeId: string, keep: string[]): Promise<void>;
  search(vec: Float32Array, opts: { k: number; filter: VectorFilter }): Promise<VectorHit[]>;
  /** One stored vector, to skip re-embedding unchanged text. */
  get(ownerKind: OwnerKind, ownerId: string, model: string): Promise<VectorRow | null>;
  /** A listener's own vectors of these kinds. */
  listForUser(userId: string, ownerKinds: OwnerKind[], model: string): Promise<VectorRow[]>;
  /** Which of these episodes already have a vector of this kind. */
  episodesWith(ownerKind: OwnerKind, episodeIds: string[], model: string): Promise<Set<string>>;
}

const passes = (r: VectorRow, f: VectorFilter) =>
  r.model === f.model &&
  f.ownerKinds.includes(r.ownerKind) &&
  (f.userId ? r.userId === f.userId : r.userId === null) &&
  !(r.episodeId && f.excludeEpisodeIds?.includes(r.episodeId)) &&
  (!f.language || r.language === null || r.language === f.language);

export class InMemoryVectorIndex implements VectorIndex {
  private rows = new Map<string, VectorRow>();
  private key = (kind: OwnerKind, id: string, model: string) => `${kind}\n${id}\n${model}`;

  constructor(private onSearch?: (m: SearchMetrics) => void) {}

  async upsert(rows: VectorRow[]) {
    for (const r of rows) this.rows.set(this.key(r.ownerKind, r.ownerId, r.model), r);
  }

  async delete(keys: { ownerKind: OwnerKind; ownerId: string }[]) {
    for (const [k, r] of this.rows) if (keys.some((x) => x.ownerKind === r.ownerKind && x.ownerId === r.ownerId)) this.rows.delete(k);
  }

  async prune(ownerKind: OwnerKind, episodeId: string, keep: string[]) {
    for (const [k, r] of this.rows) if (r.ownerKind === ownerKind && r.episodeId === episodeId && !keep.includes(r.ownerId)) this.rows.delete(k);
  }

  async search(vec: Float32Array, { k, filter }: { k: number; filter: VectorFilter }) {
    const started = performance.now();
    const hits = [...this.rows.values()]
      .filter((r) => passes(r, filter))
      .map((r) => ({ ownerKind: r.ownerKind, ownerId: r.ownerId, episodeId: r.episodeId, podcastId: r.podcastId, startMs: r.startMs, score: dot(vec, r.vec) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
    this.onSearch?.({ ms: performance.now() - started, k, returned: hits.length, filtered: Boolean(filter.excludeEpisodeIds?.length || filter.language), global: !filter.userId });
    return hits;
  }

  async get(ownerKind: OwnerKind, ownerId: string, model: string) {
    return this.rows.get(this.key(ownerKind, ownerId, model)) ?? null;
  }

  async listForUser(userId: string, ownerKinds: OwnerKind[], model: string) {
    return [...this.rows.values()].filter((r) => r.userId === userId && r.model === model && ownerKinds.includes(r.ownerKind));
  }

  async episodesWith(ownerKind: OwnerKind, episodeIds: string[], model: string) {
    return new Set(
      [...this.rows.values()].filter((r) => r.ownerKind === ownerKind && r.model === model && r.episodeId && episodeIds.includes(r.episodeId)).map((r) => r.episodeId!),
    );
  }
}

/** halfvec text form, e.g. `[0.1,0.2]`. */
const toLiteral = (v: Float32Array) => `[${Array.from(v, (x) => (Number.isFinite(x) ? x : 0)).join(',')}]`;
const fromLiteral = (s: string) => Float32Array.from(s.slice(1, -1).split(','), Number);

type DbRow = {
  owner_kind: OwnerKind;
  owner_id: string;
  user_id: string | null;
  episode_id: string | null;
  podcast_id: string | null;
  language: string | null;
  start_ms: number | null;
  model: string;
  input_hash: string;
  vec: string;
};

const toVectorRow = (r: DbRow): VectorRow => ({
  ownerKind: r.owner_kind,
  ownerId: r.owner_id,
  userId: r.user_id,
  episodeId: r.episode_id,
  podcastId: r.podcast_id,
  language: r.language,
  startMs: r.start_ms,
  model: r.model,
  inputHash: r.input_hash,
  vec: fromLiteral(r.vec),
});

export type PgvectorOptions = {
  /** HNSW candidate list size per search; higher is more accurate and slower (pgvector default 40). */
  efSearch?: number;
  onSearch?: (m: SearchMetrics) => void;
};

export class PgvectorIndex implements VectorIndex {
  /** pgvector 0.8+ can keep scanning the index until a filtered search has `k` rows. */
  private iterativeScan: Promise<boolean> | null = null;

  constructor(
    private sql: Sql,
    private opts: PgvectorOptions = {},
  ) {}

  async upsert(rows: VectorRow[]) {
    for (const r of rows) {
      if (r.vec.length !== EMBEDDING_DIMENSIONS) throw new Error(`Expected ${EMBEDDING_DIMENSIONS} dimensions, got ${r.vec.length}`);
    }
    for (let i = 0; i < rows.length; i += 200) {
      const batch = rows.slice(i, i + 200).map((r) => ({
        owner_kind: r.ownerKind,
        owner_id: r.ownerId,
        user_id: r.userId,
        episode_id: r.episodeId,
        podcast_id: r.podcastId,
        language: r.language,
        start_ms: r.startMs,
        model: r.model,
        input_hash: r.inputHash,
        vec: toLiteral(r.vec),
      }));
      await this.sql`
        insert into embeddings ${this.sql(batch)}
        on conflict (owner_kind, owner_id, model) do update set user_id = excluded.user_id,
          episode_id = excluded.episode_id, podcast_id = excluded.podcast_id, language = excluded.language,
          start_ms = excluded.start_ms, input_hash = excluded.input_hash, vec = excluded.vec, created_at = now()`;
    }
  }

  async delete(keys: { ownerKind: OwnerKind; ownerId: string }[]) {
    for (const kind of new Set(keys.map((k) => k.ownerKind))) {
      const ids = keys.filter((k) => k.ownerKind === kind).map((k) => k.ownerId);
      await this.sql`delete from embeddings where owner_kind = ${kind} and owner_id = any(${ids})`;
    }
  }

  async prune(ownerKind: OwnerKind, episodeId: string, keep: string[]) {
    await this.sql`
      delete from embeddings where owner_kind = ${ownerKind} and episode_id = ${episodeId} and owner_id <> all(${keep})`;
  }

  private supportsIterativeScan(): Promise<boolean> {
    this.iterativeScan ??= this.sql`select extversion from pg_extension where extname = 'vector'`.then(([r]) => {
      const [major = 0, minor = 0] = String(r?.extversion ?? '0').split('.').map(Number);
      return major > 0 || minor >= 8;
    });
    return this.iterativeScan;
  }

  async search(vec: Float32Array, { k, filter }: { k: number; filter: VectorFilter }) {
    const started = performance.now();
    const q = toLiteral(vec);
    const exclude = filter.excludeEpisodeIds ?? [];
    const iterative = await this.supportsIterativeScan();
    const rows = await this.sql.begin(async (tx) => {
      if (this.opts.efSearch) await tx.unsafe(`set local hnsw.ef_search = ${Math.round(this.opts.efSearch)}`);
      if (iterative) await tx.unsafe(`set local hnsw.iterative_scan = relaxed_order`);
      // Global content goes through the HNSW index (its predicate is `user_id is null`); a
      // listener's own vectors are few and scanned exactly.
      return tx<(Omit<DbRow, 'vec' | 'user_id' | 'language' | 'model' | 'input_hash'> & { distance: number })[]>`
        select owner_kind, owner_id, episode_id, podcast_id, start_ms, vec <=> ${q}::halfvec(512) as distance
        from embeddings
        where model = ${filter.model} and owner_kind = any(${filter.ownerKinds})
          and ${filter.userId ? tx`user_id = ${filter.userId}` : tx`user_id is null`}
          ${exclude.length ? tx`and (episode_id is null or episode_id <> all(${exclude}))` : tx``}
          ${filter.language ? tx`and (language is null or language = ${filter.language})` : tx``}
        order by vec <=> ${q}::halfvec(512)
        limit ${k}`;
    });
    // Relaxed ordering can return rows slightly out of order; put them back.
    const hits = rows
      .map((r) => ({ ownerKind: r.owner_kind, ownerId: r.owner_id, episodeId: r.episode_id, podcastId: r.podcast_id, startMs: r.start_ms, score: 1 - r.distance }))
      .sort((a, b) => b.score - a.score);
    this.opts.onSearch?.({ ms: performance.now() - started, k, returned: hits.length, filtered: Boolean(exclude.length || filter.language), global: !filter.userId });
    return hits;
  }

  async get(ownerKind: OwnerKind, ownerId: string, model: string) {
    const [r] = await this.sql<DbRow[]>`
      select owner_kind, owner_id, user_id, episode_id, podcast_id, language, start_ms, model, input_hash, vec::text as vec
      from embeddings where owner_kind = ${ownerKind} and owner_id = ${ownerId} and model = ${model}`;
    return r ? toVectorRow(r) : null;
  }

  async listForUser(userId: string, ownerKinds: OwnerKind[], model: string) {
    const rows = await this.sql<DbRow[]>`
      select owner_kind, owner_id, user_id, episode_id, podcast_id, language, start_ms, model, input_hash, vec::text as vec
      from embeddings where user_id = ${userId} and owner_kind = any(${ownerKinds}) and model = ${model}`;
    return rows.map(toVectorRow);
  }

  async episodesWith(ownerKind: OwnerKind, episodeIds: string[], model: string) {
    if (!episodeIds.length) return new Set<string>();
    const rows = await this.sql<{ episode_id: string }[]>`
      select distinct episode_id from embeddings
      where owner_kind = ${ownerKind} and model = ${model} and episode_id = any(${episodeIds})`;
    return new Set(rows.map((r) => r.episode_id));
  }

  /**
   * Recall@k of the index against exact search, on `samples` random global vectors as queries.
   * One of the switch triggers; the worker runs it nightly and logs the result.
   */
  async recallSample(model: string, opts: { samples?: number; k?: number } = {}): Promise<{ recall: number; samples: number; indexBytes: number; vectors: number }> {
    const k = opts.k ?? 10;
    const queries = await this.sql<{ vec: string }[]>`
      select vec::text as vec from embeddings where user_id is null and model = ${model}
      order by random() limit ${opts.samples ?? 20}`;
    let found = 0;
    let total = 0;
    for (const { vec } of queries) {
      const approx = await this.sql<{ id: string }[]>`
        select id from embeddings where user_id is null and model = ${model}
        order by vec <=> ${vec}::halfvec(512) limit ${k}`;
      const exact = await this.sql.begin(async (tx) => {
        await tx.unsafe('set local enable_indexscan = off');
        return tx<{ id: string }[]>`
          select id from embeddings where user_id is null and model = ${model}
          order by vec <=> ${vec}::halfvec(512) limit ${k}`;
      });
      const approxIds = new Set(approx.map((r) => String(r.id)));
      found += exact.filter((r) => approxIds.has(String(r.id))).length;
      total += exact.length;
    }
    const [size] = await this.sql<{ bytes: string; vectors: string }[]>`
      select coalesce(pg_relation_size('embeddings_global_vec'), 0) as bytes,
        (select count(*) from embeddings where user_id is null) as vectors`;
    return { recall: total ? found / total : 1, samples: queries.length, indexBytes: Number(size?.bytes ?? 0), vectors: Number(size?.vectors ?? 0) };
  }
}
