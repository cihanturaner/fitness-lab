import { describe, expect, it } from '@jest/globals';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * Layering: domain -> data -> store -> features/ui -> app. `domain` is pure TypeScript
 * fitness logic; `data` is facts, SQL repositories and their sources. Neither may reach UI
 * or network code; the only platform code in `data` is the storage adapters listed below.
 * SQL lives in `data` alone: nothing above it opens the database or writes a query.
 */
const SRC = join(__dirname, '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

function imports(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(/(?:from|import|require\()\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

const PLATFORM = /^(react|react-native|expo|expo-.*|@expo\/.*|react-native-.*)$/;

/** The storage adapters: the one place each platform module may enter `data`. */
const ADAPTERS: Record<string, readonly string[]> = {
  'data/db/open-database.ts': ['expo-sqlite'],
  'data/db/test-database.ts': ['sql.js'],
  'data/device-files.ts': ['expo-file-system', 'expo-document-picker', 'expo-sharing'],
};
const SQL = /\b(SELECT|INSERT INTO|UPDATE \w+ SET|DELETE FROM|CREATE TABLE)\b/;
const NETWORK = /\b(fetch|XMLHttpRequest|WebSocket)\s*\(/;

describe('architecture', () => {
  it.each(sources(join(SRC, 'domain')).map((f) => [relative(SRC, f), f]))(
    'domain file %s imports only other domain files',
    (_name, file) => {
      for (const spec of imports(file)) {
        expect(spec).toMatch(/^\.\.?\//);
      }
    },
  );

  it.each(sources(join(SRC, 'data')).map((f) => [relative(SRC, f), f]))(
    'data file %s depends only on domain and data',
    (name, file) => {
      for (const spec of imports(file)) {
        if (ADAPTERS[name]?.includes(spec)) continue;
        expect(spec.match(PLATFORM)).toBeNull();
        expect(spec).toMatch(/^(\.\.?\/|@\/domain\/|@\/data\/)/);
      }
    },
  );

  it.each(
    ['store', 'features', 'ui', 'app']
      .flatMap((dir) => sources(join(SRC, dir)))
      .map((f) => [relative(SRC, f), f]),
  )('%s holds no SQL and never opens the database itself', (_name, file) => {
    const text = readFileSync(file, 'utf8');
    expect(SQL.test(text)).toBe(false);
    for (const spec of imports(file)) {
      expect(spec).not.toMatch(/^expo-sqlite$|^sql\.js$|^@\/data\/db\/(test-database|schema)$/);
    }
  });

  it('makes no network calls anywhere in the app', () => {
    for (const file of sources(SRC)) {
      expect([relative(SRC, file), NETWORK.test(readFileSync(file, 'utf8'))]).toEqual([
        relative(SRC, file),
        false,
      ]);
    }
  });

  it('keeps non-route code out of src/app', () => {
    for (const file of sources(join(SRC, 'app'))) {
      const text = readFileSync(file, 'utf8');
      expect([relative(SRC, file), /export default function/.test(text)]).toEqual([
        relative(SRC, file),
        true,
      ]);
    }
  });
});
