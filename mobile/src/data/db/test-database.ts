import initSqlJs, { type Database } from 'sql.js';

import { transactional, type Db, type SqlValue } from './database';
import { migrate } from './schema';

/**
 * The same Db on sql.js (SQLite compiled to WebAssembly) for Jest — never bundled into the
 * app. `snapshot()` returns the file bytes, and `openTestDatabase(bytes)` reopens them: a
 * cold restart in a test.
 */
export type TestDb = Db & { snapshot(): Uint8Array; raw: Database };

let engine: Awaited<ReturnType<typeof initSqlJs>> | null = null;

export async function openTestDatabase(bytes?: Uint8Array, options: { migrate?: boolean } = {}): Promise<TestDb> {
  engine ??= await initSqlJs();
  const raw = new engine.Database(bytes);
  const exec = async (sql: string) => {
    raw.exec(sql);
  };
  const rows = <T,>(sql: string, params: readonly SqlValue[] = []): T[] => {
    const stmt = raw.prepare(sql);
    try {
      stmt.bind(params as SqlValue[]);
      const out: T[] = [];
      while (stmt.step()) out.push(stmt.getAsObject() as T);
      return out;
    } finally {
      stmt.free();
    }
  };
  const db: TestDb = {
    raw,
    exec,
    run: async (sql, params = []) => {
      raw.run(sql, params as SqlValue[]);
      const id = rows<{ id: number }>('SELECT last_insert_rowid() AS id')[0].id;
      return { changes: raw.getRowsModified(), lastInsertRowId: id };
    },
    all: async <T,>(sql: string, params?: readonly SqlValue[]) => rows<T>(sql, params),
    first: async <T,>(sql: string, params?: readonly SqlValue[]) => rows<T>(sql, params)[0] ?? null,
    transaction: transactional(exec),
    snapshot: () => raw.export(),
  };
  if (options.migrate !== false) await migrate(db);
  return db;
}
