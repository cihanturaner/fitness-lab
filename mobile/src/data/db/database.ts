/**
 * The one door to device-local storage. Repositories speak SQL through this interface;
 * React components never do. Production opens it on expo-sqlite (`open-database.ts`); tests
 * open the same schema on an in-memory SQLite (`test-database.ts`).
 */

export type SqlValue = string | number | null;

export type RunResult = { changes: number; lastInsertRowId: number };

export interface Db {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: readonly SqlValue[]): Promise<RunResult>;
  all<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  first<T>(sql: string, params?: readonly SqlValue[]): Promise<T | null>;
  /**
   * Runs `work` in one transaction — all of it is kept, or none of it. Transactions are
   * serialised; a transaction started inside another joins it.
   */
  transaction<T>(work: () => Promise<T>): Promise<T>;
}

/**
 * Transaction bookkeeping shared by both adapters: a queue so two writes never interleave,
 * and BEGIN IMMEDIATE / COMMIT / ROLLBACK around each unit of work.
 */
export function transactional(exec: (sql: string) => Promise<void>) {
  let tail: Promise<unknown> = Promise.resolve();
  let depth = 0;
  return async function transaction<T>(work: () => Promise<T>): Promise<T> {
    if (depth > 0) return work();
    const run = async () => {
      depth++;
      await exec('BEGIN IMMEDIATE');
      try {
        const result = await work();
        await exec('COMMIT');
        return result;
      } catch (error) {
        await exec('ROLLBACK');
        throw error;
      } finally {
        depth--;
      }
    };
    const next = tail.then(run, run);
    tail = next.catch(() => undefined);
    return next;
  };
}
