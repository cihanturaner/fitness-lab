import type { MuscleGroup } from './home-facts';

/**
 * Muscle focus per workout, only where an existing accepted source states one. The program
 * package states none; the one stated focus is M1 Home's for Upper B (the accepted mobile
 * fixture), reused as is. Every other workout draws a neutral figure — a focus is never
 * inferred from exercise names.
 */
export const PROGRAM_FOCUS: Readonly<Record<string, readonly MuscleGroup[]>> = {
  upper_b: ['back', 'chest', 'shoulders', 'triceps', 'biceps'],
};
