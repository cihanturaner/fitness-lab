import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { deviceClock, type Clock } from '@/data/clock';
import type { Db } from '@/data/db/database';

/**
 * The bridge between React and the device database. Screens read through `useQuery`
 * (re-run whenever anything was written, or the day changed) and write through
 * `useWrite` — never SQL, never the database handle's queries directly. After every write
 * each mounted screen reloads, so Home, Training, Nutrition and History always agree.
 */

type Store = { db: Db; clock: Clock; version: number; changed: () => void; today: string };

const StoreContext = createContext<Store | null>(null);

type Props = {
  /** Opens the database once (production: the device file; tests: an in-memory one). */
  open: () => Promise<Db>;
  clock?: Clock;
  children: ReactNode;
  /** Shown while the database opens and migrates. */
  fallback?: ReactNode;
  /** Shown if it cannot be opened (for instance, written by a newer build). */
  renderError?: (error: Error) => ReactNode;
};

export function DataProvider({ open, clock = deviceClock, children, fallback = null, renderError }: Props) {
  const [db, setDb] = useState<Db | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [version, setVersion] = useState(0);
  const [today, setToday] = useState(() => clock.today());

  useEffect(() => {
    let live = true;
    open().then(
      (opened) => live && setDb(opened),
      (e: unknown) => live && setError(e instanceof Error ? e : new Error(String(e))),
    );
    return () => {
      live = false;
    };
  }, [open]);

  // A new day starts while the app sits in the background: re-read the clock on return.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setToday(clock.today());
    });
    return () => sub.remove();
  }, [clock]);

  const changed = useCallback(() => setVersion((v) => v + 1), []);

  if (error) return <>{renderError ? renderError(error) : null}</>;
  if (!db) return <>{fallback}</>;
  return (
    <StoreContext.Provider value={{ db, clock, version, changed, today }}>{children}</StoreContext.Provider>
  );
}

function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore outside DataProvider');
  return store;
}

/** Today's local date, as the store's clock reads it. */
export function useToday(): string {
  return useStore().today;
}

export type Query<T> = { data: T | undefined; error: Error | null };

/** Reads through `load` and reads again after any write (or when `key` changes). */
export function useQuery<T>(load: (db: Db, today: string) => Promise<T>, key: string = ''): Query<T> {
  const { db, version, today } = useStore();
  const [state, setState] = useState<Query<T>>({ data: undefined, error: null });
  useEffect(() => {
    let live = true;
    load(db, today).then(
      (data) => live && setState({ data, error: null }),
      (e: unknown) => live && setState((s) => ({ data: s.data, error: e instanceof Error ? e : new Error(String(e)) })),
    );
    return () => {
      live = false;
    };
    // `load` is expected to be stable per `key`; reloading on every render would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, version, today, key]);
  return state;
}

/** Runs a write (given the database and the current instant), then tells every screen. */
export function useWrite() {
  const { db, clock, changed } = useStore();
  return useCallback(
    async <T,>(write: (db: Db, now: string, today: string) => Promise<T>): Promise<T> => {
      try {
        return await write(db, clock.now(), clock.today());
      } finally {
        changed();
      }
    },
    [db, clock, changed],
  );
}
