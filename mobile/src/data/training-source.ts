import { trainingFixture } from './fixtures/training';
import type { TrainingFacts } from './training-facts';

/**
 * Where Training's facts come from. M2: fixtures only — no database, no network, no
 * server. On-device persistence replaces this body later; screens depend only on
 * `TrainingFacts`.
 */
export function loadTrainingFacts(): TrainingFacts {
  return trainingFixture;
}
