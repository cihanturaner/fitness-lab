import { describe, expect, it } from '@jest/globals';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * Layering: domain -> data -> features/ui -> app. `domain` is pure TypeScript fitness
 * logic; `data` is facts and their source. Neither may reach UI, platform or network code.
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
    (_name, file) => {
      for (const spec of imports(file)) {
        expect(spec.match(PLATFORM)).toBeNull();
        expect(spec).toMatch(/^(\.\.?\/|@\/domain\/|@\/data\/)/);
      }
    },
  );

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
