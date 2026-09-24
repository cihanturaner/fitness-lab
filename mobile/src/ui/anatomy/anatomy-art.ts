import type { MuscleGroup } from '@/data/home-facts';

/**
 * Original Fitness Lab anatomy artwork: a front and a back figure built from flat,
 * segmented muscle plates on a neutral silhouette. Only the left half of each figure is
 * drawn (x ≤ CENTER); the renderer mirrors it, so both sides stay exactly symmetric.
 *
 * Paths use absolute commands in the 200 × 440 box `VIEWBOX`. A plate names the group it
 * belongs to, or null for anatomy that is drawn for shape only and never highlighted.
 */

export const VIEWBOX = { width: 200, height: 440 } as const;
export const CENTER = VIEWBOX.width / 2;

export type Plate = { group: MuscleGroup | null; d: string };
export type FigureArt = { silhouette: readonly string[]; plates: readonly Plate[] };

/** Head, neck, torso, arm, hand, leg and foot: the neutral body both views share. */
const SILHOUETTE: readonly string[] = [
  // head
  'M100,8 C91,8 85,15 85,28 C85,40 90,49 100,51 Z',
  // neck
  'M100,44 L90,44 L88,62 L100,66 Z',
  // torso to the hip
  'M100,56 L89,56 C82,62 72,64 62,67 C52,70 46,80 46,92 L54,120 C60,142 68,158 70,174 C70,188 66,198 65,208 L66,226 L100,230 Z',
  // arm
  'M62,66 C48,68 38,78 38,96 C36,110 35,124 35,138 C34,148 33,156 32,166 C29,184 26,204 25,226 L36,230 C40,210 44,190 48,172 C52,156 56,140 58,120 L60,100 Z',
  // hand
  'M25,224 C21,234 21,248 25,256 C29,261 35,259 36,251 C37,243 37,233 36,228 Z',
  // leg
  'M65,206 C59,230 57,262 62,298 C64,312 60,326 60,346 C60,368 66,390 69,408 L86,410 C86,392 92,368 92,346 C92,326 89,312 91,298 C96,272 99,248 100,230 Z',
  // foot
  'M69,405 C64,413 62,423 68,428 L88,428 C90,420 88,412 86,407 Z',
];

const FOREARM = 'M36,168 C32,184 29,202 27,220 L35,223 C39,205 44,188 48,172 C44,166 39,165 36,168 Z';
const DELTOID = 'M63,69 C52,70 42,78 41,93 C45,101 52,104 58,102 C58,90 62,80 69,75 Z';

const FRONT_PLATES: readonly Plate[] = [
  { group: 'back', d: 'M89,58 C82,63 72,65 64,67 C72,70 80,72 86,72 C88,68 89,63 89,58 Z' },
  { group: 'shoulders', d: DELTOID },
  { group: 'chest', d: 'M98,76 C88,72 76,72 69,78 C62,88 61,100 66,110 C76,117 90,117 98,112 Z' },
  { group: 'biceps', d: 'M44,106 C39,120 37,134 38,150 C42,156 49,155 52,149 C55,134 57,120 57,108 C53,104 47,103 44,106 Z' },
  { group: null, d: FOREARM },
  { group: null, d: 'M85,120 C78,120 72,122 67,126 C68,146 72,166 76,182 C80,188 84,192 86,194 Z' },
  { group: 'abs', d: 'M98,118 L90,118 Q87,118 87,121 L87,131 Q87,134 90,134 L98,134 Z' },
  { group: 'abs', d: 'M98,137 L90,137 Q87,137 87,140 L87,150 Q87,153 90,153 L98,153 Z' },
  { group: 'abs', d: 'M98,156 L90,156 Q87,156 87,159 L87,169 Q87,172 90,172 L98,172 Z' },
  { group: 'abs', d: 'M98,175 L90,175 Q87,175 87,178 L88,188 Q93,198 98,204 Z' },
  { group: 'quads', d: 'M66,222 C60,246 60,270 66,292 C70,298 76,300 79,296 C78,274 78,248 80,232 Z' },
  {
    group: 'quads',
    d: 'M82,232 C80,252 80,276 82,294 C86,302 93,301 94,293 C97,272 98,250 97,236 C92,231 87,230 82,232 Z',
  },
  { group: 'calves', d: 'M62,318 C57,336 58,356 64,372 C68,372 72,366 73,356 C74,342 72,326 69,316 Z' },
  { group: 'calves', d: 'M88,320 C91,336 91,354 86,370 C82,370 79,362 79,352 C79,338 81,326 84,318 Z' },
];

const BACK_PLATES: readonly Plate[] = [
  { group: 'back', d: 'M96,104 C88,90 74,86 62,94 C58,114 62,140 72,164 C79,170 88,162 94,150 C97,138 97,120 96,104 Z' },
  { group: 'back', d: 'M100,48 L91,54 C84,61 72,65 62,68 C74,74 86,84 93,96 C97,103 99,110 100,116 Z' },
  { group: 'shoulders', d: DELTOID },
  { group: 'triceps', d: 'M43,106 C38,120 36,136 38,152 C42,158 49,156 52,150 C55,134 57,120 56,108 C52,104 46,103 43,106 Z' },
  { group: null, d: FOREARM },
  { group: null, d: 'M99,144 L91,152 C89,166 89,182 90,196 L99,200 Z' },
  { group: 'glutes', d: 'M99,204 C89,200 74,202 67,214 C63,228 67,242 80,247 C91,249 99,242 99,234 Z' },
  { group: 'hamstrings', d: 'M65,252 C62,272 64,290 71,302 L79,302 C77,284 77,266 79,252 Z' },
  { group: 'hamstrings', d: 'M82,252 C81,270 81,288 83,302 L91,302 C95,286 97,268 97,252 Z' },
  { group: 'calves', d: 'M61,318 C56,336 58,356 66,372 C72,370 76,358 76,344 C76,332 75,322 73,316 Z' },
  { group: 'calves', d: 'M78,318 C79,332 79,348 78,362 C81,372 89,370 90,356 C92,342 91,326 88,318 Z' },
];

export const FRONT: FigureArt = { silhouette: SILHOUETTE, plates: FRONT_PLATES };
export const BACK: FigureArt = { silhouette: SILHOUETTE, plates: BACK_PLATES };
