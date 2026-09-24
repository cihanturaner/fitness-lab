/**
 * Fitness Lab mobile design tokens. Colours carry over the web app's V3.1 identity
 * (web/src/index.css): mint paper, white cards, green-black ink, ONE accent family
 * (emerald), and a restrained steel blue that always means "planned". Components take
 * every colour, size and radius from here — no raw values in feature code.
 *
 * M2.5 lightened the paper to a near-white mint-grey so white cards float on it with
 * shadow alone (no borders), and added the anatomy figure's neutral and highlight tones.
 */

export const color = {
  paper: '#F1F5F3',
  card: '#FFFFFF',
  sunken: '#F2F7F4',
  ink: '#0F1F19',
  inkSoft: '#2B3B34',
  muted: '#53645C', // >= 5.2:1 on paper and card
  faint: '#788A81', // non-essential marks only
  hairline: '#E1EAE5',
  track: '#E6EFEA',

  emerald900: '#0F3F30',
  emerald800: '#145740',
  emerald700: '#1B684F', // primary; white on it 6.4:1
  emerald600: '#23805F',
  emerald500: '#2F9A72',
  emerald300: '#8FD0B2',
  emerald100: '#DCF0E5',
  emerald50: '#EEF8F2',

  plan: '#3A6680',
  planSurface: '#EBF2F5',
  planRule: '#B5CCD8',

  warn: '#9A620C',
  warnSurface: '#FBF0DC',

  protein: '#1D7A58',
  carbs: '#B0842C',
  fat: '#3E6E9B',

  onPrimary: '#FFFFFF',

  /** Anatomy figure: neutral body (edge → centre), resting plate and trained plate (lit → deep). */
  bodyShade: '#D5E0DA',
  body: '#E2EAE6',
  bodyPlateLight: '#D6E0DB',
  bodyPlate: '#B7C6BF',
  bodyFloor: '#EDF3EF',
  muscleLight: '#4CC293',
  muscleDeep: '#17684B',
} as const;

export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

/** Side gutter for every screen. */
export const gutter = 20;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  hero: 28,
  round: 999,
} as const;

/** Green-tinted, layered depth — never a flat grey drop. */
export const shadow = {
  card: '0px 1px 2px rgba(16, 52, 38, 0.04), 0px 10px 28px -14px rgba(16, 52, 38, 0.16)',
  raised: '0px 2px 4px rgba(16, 52, 38, 0.06), 0px 14px 32px -12px rgba(16, 52, 38, 0.22)',
  cta: '0px 10px 24px -10px rgba(27, 104, 79, 0.55)',
  /** The floating tab bar and Quick Add: lifted, but no heavier than a card. */
  dock: '0px 2px 6px rgba(16, 52, 38, 0.05), 0px 16px 36px -14px rgba(16, 52, 38, 0.24)',
} as const;

/** Minimum touch target (Apple HIG). */
export const hitTarget = 44;
