import { openDatabaseAsync, type SQLiteBindValue } from 'expo-sqlite';

import { transactional, type Db, type SqlValue } from './database';
import { migrate } from './schema';

/** The app's database file, in the app's private documents directory on the device. */
export const DATABASE_NAME = 'fitness-lab.db';

const bind = (params: readonly SqlValue[] = []) => params as SQLiteBindValue[];

/** Opens (creating if needed) the device database and brings its schema up to date. */
export async function openDeviceDatabase(name = DATABASE_NAME): Promise<Db> {
  const sqlite = await openDatabaseAsync(name);
  const exec = (sql: string) => sqlite.execAsync(sql);
  const db: Db = {
    exec,
    run: async (sql, params) => {
      const r = await sqlite.runAsync(sql, bind(params));
      return { changes: r.changes, lastInsertRowId: r.lastInsertRowId };
    },
    all: (sql, params) => sqlite.getAllAsync(sql, bind(params)),
    first: (sql, params) => sqlite.getFirstAsync(sql, bind(params)),
    transaction: transactional(exec),
  };
  await migrate(db);
  return db;
}
