import type { Sql } from 'postgres';

/** The work the content worker does. Each kind has a handler in `worker.ts`. */
export type JobKind =
  | 'transcript.request'
  | 'transcript.poll'
  | 'transcript.publisher'
  | 'transcript.seed'
  | 'chunk'
  | 'highlight.context'
  | 'embed.sweep'
  | 'embed.transcript'
  | 'embed.highlight'
  | 'profile.rebuild'
  | 'vector.recall_check';

export type Job = {
  id: string;
  kind: JobKind;
  /** What the job is about, e.g. an episode id. One live job per (kind, key). */
  key: string;
  payload: Record<string, unknown>;
  attempts: number;
};

export type EnqueueOptions = { runAt?: Date; payload?: Record<string, unknown> };

/**
 * Background jobs, claimed with a lease. A crashed worker's jobs come back when the lease runs
 * out. Enqueueing a (kind, key) that's already waiting does nothing, so callers can enqueue freely.
 */
export interface JobQueue {
  /** False when the same (kind, key) is already waiting. */
  enqueue(kind: JobKind, key: string, opts?: EnqueueOptions): Promise<boolean>;
  claim(opts: { now: Date; leaseMs: number; limit: number }): Promise<Job[]>;
  complete(id: string): Promise<void>;
  /** Runs the job again at `runAt`, e.g. to poll later. Counts an attempt only when `error` is given. */
  retry(id: string, opts: { runAt: Date; error?: string; payload?: Record<string, unknown> }): Promise<void>;
  /** Runs a waiting (kind, key) now, or enqueues it if none is waiting. */
  runNow(kind: JobKind, key: string, opts?: EnqueueOptions): Promise<void>;
  /** Gives up on the job and keeps the error. */
  fail(id: string, error: string): Promise<void>;
  /** Waiting jobs by kind, for tests and the worker's log. */
  pending(): Promise<{ kind: JobKind; key: string; runAt: Date }[]>;
}

type MemJob = Job & { runAt: Date; leasedUntil: Date | null; done: boolean };

export class InMemoryJobQueue implements JobQueue {
  private jobs: MemJob[] = [];
  private nextId = 1;

  async enqueue(kind: JobKind, key: string, opts: EnqueueOptions = {}) {
    if (this.jobs.some((j) => !j.done && j.kind === kind && j.key === key)) return false;
    this.jobs.push({
      id: String(this.nextId++),
      kind,
      key,
      payload: opts.payload ?? {},
      attempts: 0,
      runAt: opts.runAt ?? new Date(0),
      leasedUntil: null,
      done: false,
    });
    return true;
  }

  async claim({ now, leaseMs, limit }: { now: Date; leaseMs: number; limit: number }) {
    const due = this.jobs
      .filter((j) => !j.done && j.runAt <= now && (!j.leasedUntil || j.leasedUntil <= now))
      .sort((a, b) => a.runAt.getTime() - b.runAt.getTime() || Number(a.id) - Number(b.id))
      .slice(0, limit);
    for (const j of due) j.leasedUntil = new Date(now.getTime() + leaseMs);
    return due.map(({ id, kind, key, payload, attempts }) => ({ id, kind, key, payload, attempts }));
  }

  async complete(id: string) {
    const j = this.jobs.find((x) => x.id === id);
    if (j) j.done = true;
  }

  async retry(id: string, { runAt, error, payload }: { runAt: Date; error?: string; payload?: Record<string, unknown> }) {
    const j = this.jobs.find((x) => x.id === id);
    if (!j) return;
    j.runAt = runAt;
    j.leasedUntil = null;
    if (error) j.attempts++;
    if (payload) j.payload = payload;
  }

  async runNow(kind: JobKind, key: string, opts: EnqueueOptions = {}) {
    const live = this.jobs.find((j) => !j.done && j.kind === kind && j.key === key);
    if (live) live.runAt = new Date(0);
    else await this.enqueue(kind, key, opts);
  }

  async fail(id: string) {
    await this.complete(id);
  }

  async pending() {
    return this.jobs.filter((j) => !j.done).map((j) => ({ kind: j.kind, key: j.key, runAt: j.runAt }));
  }
}

export class PostgresJobQueue implements JobQueue {
  constructor(private sql: Sql) {}

  async enqueue(kind: JobKind, key: string, opts: EnqueueOptions = {}) {
    const rows = await this.sql`
      insert into jobs (kind, key, payload, run_at)
      values (${kind}, ${key}, ${this.sql.json((opts.payload ?? {}) as never)}, ${opts.runAt ?? new Date()})
      on conflict (kind, key) where done_at is null do nothing
      returning id`;
    return rows.length === 1;
  }

  async claim({ now, leaseMs, limit }: { now: Date; leaseMs: number; limit: number }) {
    // `skip locked` lets several workers claim disjoint batches without waiting on each other.
    const rows = await this.sql<{ id: string; kind: JobKind; key: string; payload: Record<string, unknown>; attempts: number }[]>`
      update jobs set leased_until = ${new Date(now.getTime() + leaseMs)}
      where id in (
        select id from jobs
        where done_at is null and run_at <= ${now} and (leased_until is null or leased_until <= ${now})
        order by run_at, id
        limit ${limit}
        for update skip locked
      )
      returning id, kind, key, payload, attempts`;
    return rows.map((r) => ({ ...r, id: String(r.id) })).sort((a, b) => Number(a.id) - Number(b.id));
  }

  async complete(id: string) {
    await this.sql`update jobs set done_at = now(), leased_until = null where id = ${id}`;
  }

  async retry(id: string, { runAt, error, payload }: { runAt: Date; error?: string; payload?: Record<string, unknown> }) {
    await this.sql`
      update jobs set run_at = ${runAt}, leased_until = null,
        attempts = attempts + ${error ? 1 : 0},
        last_error = coalesce(${error ?? null}, last_error),
        payload = coalesce(${payload ? this.sql.json(payload as never) : null}, payload)
      where id = ${id}`;
  }

  async runNow(kind: JobKind, key: string, opts: EnqueueOptions = {}) {
    const woke = await this.sql`
      update jobs set run_at = 'epoch' where kind = ${kind} and key = ${key} and done_at is null returning id`;
    if (!woke.length) await this.enqueue(kind, key, opts);
  }

  async fail(id: string, error: string) {
    await this.sql`update jobs set done_at = now(), leased_until = null, failed = true, last_error = ${error} where id = ${id}`;
  }

  async pending() {
    const rows = await this.sql<{ kind: JobKind; key: string; run_at: Date }[]>`
      select kind, key, run_at from jobs where done_at is null order by run_at, id`;
    return rows.map((r) => ({ kind: r.kind, key: r.key, runAt: r.run_at }));
  }
}
