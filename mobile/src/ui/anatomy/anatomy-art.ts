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
  'M100,6 C89,6 83,14 83,27 C83,38 86,47 92,53 L92,60 C88,66 78,69 66,72 C56,75 48,80 45,88 L60,120 C61,138 63,154 67,170 C69,182 70,192 69,202 C67,212 64,220 63,232 C58,254 57,278 60,300 C62,312 65,320 66,328 C62,340 59,354 60,368 C61,382 65,396 68,408 C64,416 61,423 63,429 C68,433 80,433 88,431 C89,422 87,413 86,406 C87,392 90,376 89,360 C89,346 86,336 85,328 C87,314 91,300 94,284 C97,268 99,254 99,244 L100,244 Z';
const ARM =
  'M64,72 C50,73 38,82 35,97 C32,110 31,122 31,134 C30,148 28,160 27,172 C24,190 21,208 20,226 L19,236 C15,244 15,258 19,266 C23,272 30,270 31,260 C32,252 32,244 31,238 L32,232 C35,214 39,198 43,182 C45,172 47,162 49,152 C52,140 55,128 58,118 L62,100 Z';
const SILHOUETTE: readonly string[] = [BODY, ARM];

const FOREARM =
  'M38,168 C32,180 28,196 25,212 L23,228 L32,231 C36,214 40,198 45,184 C47,177 47,171 45,167 C43,164 40,164 38,168 Z';
const DELTOID =
  'M64,73 C50,74 38,83 35,98 C34,109 36,118 40,124 C45,113 51,103 58,96 C65,90 70,84 70,79 C68,76 66,74 64,73 Z';

const FRONT_PLATES: readonly Plate[] = [
  { group: null, d: 'M89,48 C90,56 93,62 98,68 L95,69 C90,63 86,56 85,50 Z' },
  { group: 'back', d: 'M92,58 C87,65 77,70 65,73 C73,76 83,76 91,74 C92,68 92,63 92,58 Z' },
  { group: null, d: FOREARM },
  {
    group: 'biceps',
    d: 'M42,126 C37,136 35,148 36,160 C38,168 44,170 48,165 C51,155 53,142 55,130 C52,121 46,120 42,126 Z',
  },
  { group: 'shoulders', d: DELTOID },
  {
    group: 'chest',
    d: 'M99,80 C90,76 77,76 69,80 C63,88 59,98 59,108 C62,119 72,126 85,128 C92,129 97,127 99,124 Z',
  },
  { group: null, d: 'M62,120 C61,127 62,134 64,140 L70,135 C68,130 66,125 65,121 Z' },
  { group: null, d: 'M65,143 C65,149 66,155 68,160 L72,155 C71,151 70,147 69,143 Z' },
  {
    group: null,
    d: 'M73,132 C70,150 69,170 71,188 C74,200 79,210 86,216 L86,136 C82,134 77,132 73,132 Z',
  },
  { group: 'abs', d: 'M98.5,131 L90.5,131 Q88,131 88,134 L88,143 Q88,146 90.5,146 L98.5,146 Z' },
  { group: 'abs', d: 'M98.5,149 L90.5,149 Q88,149 88,152 L88,161 Q88,164 90.5,164 L98.5,164 Z' },
  { group: 'abs', d: 'M98.5,167 L90.5,167 Q88,167 88,170 L88,179 Q88,182 90.5,182 L98.5,182 Z' },
  { group: 'abs', d: 'M98.5,185 L90.5,185 Q88,185 88,188 L88.5,201 Q93,211 98.5,219 Z' },
  { group: null, d: 'M86,240 C89,256 92,268 94,280 C97,268 99,254 99,244 Z' },
  {
    group: 'quads',
    d: 'M63,234 C56,256 56,282 61,304 C64,313 69,318 74,318 C75,298 73,270 70,244 Z',
  },
  {
    group: 'quads',
    d: 'M71,236 C68,260 70,288 76,308 C79,315 86,315 88,308 C91,288 90,264 86,246 C82,236 75,233 71,236 Z',
  },
  { group: 'quads', d: 'M91,284 C87,296 86,308 88,318 C92,322 95,318 95,310 C95,300 93,290 91,284 Z' },
  { group: null, d: 'M76,321 C74,327 76,334 81,336 C86,336 88,329 87,322 C84,318 79,318 76,321 Z' },
  { group: null, d: 'M68,340 C65,356 65,374 69,396 L76,396 C75,376 74,358 74,342 Z' },
  { group: 'calves', d: 'M84,336 C88,348 90,362 87,378 C83,380 80,370 80,358 C80,348 81,340 84,336 Z' },
  { group: 'calves', d: 'M62,344 C59,356 59,370 63,384 C65,376 66,362 66,348 Z' },
];

const BACK_PLATES: readonly Plate[] = [
  { group: null, d: FOREARM },
  {
    group: 'triceps',
    d: 'M42,124 C37,136 35,150 36,162 C39,169 45,170 48,164 C51,152 53,138 55,126 C52,119 46,118 42,124 Z',
  },
  {
    group: 'back',
    d: 'M60,120 C60,140 64,160 70,178 C76,190 86,194 95,190 C96,174 96,160 96,148 C88,136 76,127 60,120 Z',
  },
  { group: null, d: 'M97.5,142 C93,154 91,174 91,196 C94,204 97,208 98.5,210 Z' },
  { group: null, d: 'M69,186 C67,195 66,204 67,212 C73,208 81,202 88,198 C81,196 75,192 69,186 Z' },
  {
    group: 'back',
    d: 'M100,50 L93,57 C88,65 76,70 63,74 C73,80 83,90 90,104 C94,114 97,124 100,138 Z',
  },
  { group: 'back', d: 'M65,88 C59,96 57,106 60,116 C68,116 78,114 86,112 C82,102 75,94 65,88 Z' },
  { group: 'shoulders', d: DELTOID },
  { group: null, d: 'M66,216 C64,220 63,226 64,232 C68,222 76,216 86,212 C78,210 71,212 66,216 Z' },
  {
    group: 'glutes',
    d: 'M98.5,214 C88,208 73,210 66,224 C62,238 66,254 79,260 C89,262 97,258 98.5,250 Z',
  },
  { group: null, d: 'M92,262 C94,268 96,276 97,286 C98.5,278 98.5,268 98.5,262 Z' },
  {
    group: 'hamstrings',
    d: 'M63,266 C58,284 60,302 66,318 C69,322 73,322 75,320 C73,302 73,284 76,266 Z',
  },
  {
    group: 'hamstrings',
    d: 'M79,266 C78,284 79,302 81,319 C84,323 88,322 89,319 C93,304 95,286 94,268 C90,264 84,264 79,266 Z',
  },
  {
    group: null,
    d: 'M66,382 C67,392 69,400 70,406 L85,406 C85,398 87,390 88,382 C84,388 78,390 74,388 C70,388 68,385 66,382 Z',
  },
  { group: 'calves', d: 'M62,334 C57,348 58,366 64,382 C69,382 73,372 74,360 C75,348 73,338 70,332 Z' },
  { group: 'calves', d: 'M77,332 C79,346 79,362 78,376 C81,386 88,384 89,370 C91,356 89,342 85,332 Z' },
];

export const FRONT: FigureArt = {
  silhouette: SILHOUETTE,
  plates: FRONT_PLATES,
};
export const BACK: FigureArt = { silhouette: SILHOUETTE, plates: BACK_PLATES };
