import type { ImageSource } from 'expo-image';

import type { MuscleGroup } from '@/data/home-facts';

/**
 * Asset seam for the muscle-focus illustration. Replace this body with original artwork
 * (e.g. front/back figures under assets/muscles/, highlighted per group) — nothing else
 * on Home changes. Returning null shows the placeholder.
 */
export function muscleArt(_groups: MuscleGroup[]): ImageSource | null {
  return null;
}
