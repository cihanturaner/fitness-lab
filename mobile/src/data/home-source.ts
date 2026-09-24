import { homeFixture } from './fixtures/home';
import type { HomeFacts } from './home-facts';

/**
 * Where Home's facts come from. M1: fixtures only — no database, no network, no server.
 * On-device persistence replaces this body later; screens depend only on `HomeFacts`.
 */
export function loadHomeFacts(): HomeFacts {
  return homeFixture;
}
