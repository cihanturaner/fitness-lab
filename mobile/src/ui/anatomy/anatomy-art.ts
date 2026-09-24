import type { MuscleGroup } from '@/data/home-facts';

/**
 * Original Fitness Lab anatomy artwork: an athletic front and back figure whose muscles are
 * drawn as shaded plates over a neutral body — deltoids, pectorals, serratus, obliques, a
 * segmented rectus abdominis, the quadriceps heads, trapezius, rotator cuff, latissimus,
 * glutes, hamstrings and calves. Only the left half of each figure is drawn (x ≤ CENTER);
 * the renderer mirrors it, so both sides stay exactly symmetric.
 *
 * Paths use absolute commands in the 200 × 440 box `VIEWBOX`, painted in order (later
 * plates sit on earlier ones). A plate names the group it belongs to, or null for anatomy
 * drawn for shape only and never highlighted (neck, forearms, serratus, obliques,
 * adductors, knees, shins, lower back, glute medius, soleus). Hand-authored for this app
 * and iterated against Chromium renders — nothing traced or copied.
 */

export const VIEWBOX = { width: 200, height: 440 } as const;
export const CENTER = VIEWBOX.width / 2;

export type Plate = { group: MuscleGroup | null; d: string };
export type FigureArt = {
  silhouette: readonly string[];
  plates: readonly Plate[];
};

/** Head, neck, torso and leg in one outline, and the arm with its hand: the neutral body. */
const BODY =
  'M100,8 C88,8 82,17 82,31 C82,41 85,50 91,55 L91,62 C84,68 72,71 62,74 C54,76 48,80 46,86 L60,118 C62,136 65,152 69,168 C71,178 71,186 70,194 C68,204 64,214 63,226 C58,248 57,272 61,296 C63,306 66,314 67,322 C64,334 60,346 61,362 C62,378 66,392 68,404 C64,412 60,420 62,427 C66,431 80,431 88,429 C89,420 87,410 86,404 C87,392 89,374 89,358 C89,344 86,334 84,324 C86,312 90,300 93,286 C96,268 98,248 99,236 L100,236 Z';
const ARM =
  'M62,74 C48,76 39,85 37,99 C35,112 34,124 34,136 C33,148 32,160 31,170 C29,186 26,204 25,224 L24,232 C20,240 20,254 24,262 C28,268 34,265 35,256 C36,247 37,238 36,232 L37,228 C40,210 44,192 47,176 C49,166 50,158 51,150 C53,138 56,126 58,116 L62,100 Z';
const SILHOUETTE: readonly string[] = [BODY, ARM];

const FOREARM =
  'M40,166 C34,176 31,190 29,206 L27,222 L36,226 C39,210 43,196 47,182 C49,176 49,170 47,166 C45,163 42,163 40,166 Z';
const DELTOID =
  'M64,73 C50,74 40,83 38,98 C38,108 40,116 44,122 C48,112 53,102 60,95 C66,90 70,84 70,79 C68,76 66,74 64,73 Z';
const OUTER_CALF_BACK =
  'M63,330 C58,344 59,362 65,378 C70,378 74,368 75,356 C76,344 74,334 71,328 Z';

const FRONT_PLATES: readonly Plate[] = [
  { group: null, d: 'M89,46 C90,54 93,61 98,67 L95,68 C90,62 86,54 85,48 Z' },
  {
    group: 'back',
    d: 'M91,56 C86,64 76,69 64,73 C72,76 82,76 90,74 C92,68 92,62 91,56 Z',
  },
  { group: null, d: FOREARM },
  {
    group: 'biceps',
    d: 'M44,124 C40,134 38,146 39,158 C41,166 46,168 50,164 C53,154 55,140 57,128 C54,120 48,118 44,124 Z',
  },
  { group: 'shoulders', d: DELTOID },
  {
    group: 'chest',
    d: 'M99,80 C90,77 78,77 70,81 C65,88 61,97 60,106 C63,116 72,123 84,125 C91,126 96,124 99,121 Z',
  },
  {
    group: null,
    d: 'M63,116 C62,123 63,130 65,136 L71,131 C69,126 67,121 66,117 Z',
  },
  {
    group: null,
    d: 'M66,139 C66,145 67,151 69,156 L73,151 C72,147 71,143 70,139 Z',
  },
  {
    group: null,
    d: 'M74,128 C71,146 70,166 72,184 C75,196 80,206 86,212 L86,132 C82,130 78,128 74,128 Z',
  },
  {
    group: 'abs',
    d: 'M98.5,128 L90.5,128 Q88,128 88,131 L88,140 Q88,143 90.5,143 L98.5,143 Z',
  },
  {
    group: 'abs',
    d: 'M98.5,146 L90.5,146 Q88,146 88,149 L88,158 Q88,161 90.5,161 L98.5,161 Z',
  },
  {
    group: 'abs',
    d: 'M98.5,164 L90.5,164 Q88,164 88,167 L88,176 Q88,179 90.5,179 L98.5,179 Z',
  },
  {
    group: 'abs',
    d: 'M98.5,182 L90.5,182 Q88,182 88,185 L88.5,198 Q93,208 98.5,216 Z',
  },
  { group: null, d: 'M86,236 C89,252 92,266 94,278 C97,266 99,250 99,238 Z' },
  {
    group: 'quads',
    d: 'M63,228 C56,250 56,278 62,302 C65,311 70,316 75,316 C76,296 74,268 71,240 Z',
  },
  {
    group: 'quads',
    d: 'M72,232 C69,256 71,284 77,306 C80,313 87,313 89,306 C92,286 91,262 87,242 C83,232 76,229 72,232 Z',
  },
  {
    group: 'quads',
    d: 'M91,282 C87,294 86,306 88,316 C92,320 96,316 96,308 C96,298 94,288 91,282 Z',
  },
  {
    group: null,
    d: 'M77,319 C75,325 77,332 82,334 C87,334 89,327 88,320 C85,316 80,316 77,319 Z',
  },
  {
    group: null,
    d: 'M68,337 C65,352 65,370 69,392 L76,392 C75,372 74,354 74,339 Z',
  },
  {
    group: 'calves',
    d: 'M84,334 C88,346 90,360 87,376 C83,378 80,368 80,356 C80,346 81,338 84,334 Z',
  },
  {
    group: 'calves',
    d: 'M63,340 C60,352 60,366 64,380 C66,372 66,358 66,344 Z',
  },
];

const BACK_PLATES: readonly Plate[] = [
  { group: null, d: FOREARM },
  {
    group: 'triceps',
    d: 'M44,122 C39,134 38,148 39,160 C42,167 47,168 50,162 C53,150 55,136 57,124 C54,117 48,116 44,122 Z',
  },
  {
    group: 'back',
    d: 'M61,120 C61,140 65,160 71,178 C77,188 86,192 95,188 C96,172 96,158 96,146 C88,134 76,126 61,120 Z',
  },
  {
    group: null,
    d: 'M97.5,140 C93,152 91,172 91,194 C94,202 97,206 98.5,208 Z',
  },
  {
    group: null,
    d: 'M70,184 C68,193 67,202 68,210 C74,206 82,200 89,196 C82,194 76,190 70,184 Z',
  },
  {
    group: 'back',
    d: 'M100,50 L93,56 C88,64 76,70 63,74 C73,80 83,90 90,104 C94,114 97,124 100,136 Z',
  },
  {
    group: 'back',
    d: 'M66,88 C60,96 58,106 61,116 C69,116 79,114 87,112 C83,102 76,94 66,88 Z',
  },
  { group: 'shoulders', d: DELTOID },
  {
    group: null,
    d: 'M66,212 C64,216 63,222 64,228 C68,218 76,212 86,208 C78,206 71,208 66,212 Z',
  },
  {
    group: 'glutes',
    d: 'M98.5,210 C88,204 73,206 66,220 C62,234 66,250 79,256 C89,258 97,254 98.5,246 Z',
  },
  {
    group: null,
    d: 'M92,258 C94,264 96,272 97,282 C98.5,274 98.5,264 98.5,258 Z',
  },
  {
    group: 'hamstrings',
    d: 'M64,262 C59,280 61,298 67,314 C70,318 74,318 76,316 C74,298 74,280 77,262 Z',
  },
  {
    group: 'hamstrings',
    d: 'M80,262 C79,280 80,298 82,315 C85,319 89,318 90,315 C94,300 96,282 95,264 C91,260 85,260 80,262 Z',
  },
  {
    group: null,
    d: 'M66,378 C67,388 69,398 70,404 L85,404 C85,396 87,386 88,378 C84,384 78,386 74,384 C70,384 68,381 66,378 Z',
  },
  { group: 'calves', d: OUTER_CALF_BACK },
  {
    group: 'calves',
    d: 'M78,328 C80,342 80,358 79,372 C82,382 89,380 90,366 C92,352 90,338 86,328 Z',
  },
];

export const FRONT: FigureArt = {
  silhouette: SILHOUETTE,
  plates: FRONT_PLATES,
};
export const BACK: FigureArt = { silhouette: SILHOUETTE, plates: BACK_PLATES };
