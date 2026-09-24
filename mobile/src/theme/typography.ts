import {
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
  Geist_700Bold,
  Geist_800ExtraBold,
} from '@expo-google-fonts/geist';
import type { TextStyle } from 'react-native';

/**
 * Geist — the web app's typeface — bundled with the app (no runtime download). Each weight
 * is its own family so iOS, Android and web render the same face.
 */
export const fontAssets = {
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
  Geist_700Bold,
  Geist_800ExtraBold,
};

export const font = {
  regular: 'Geist_400Regular',
  medium: 'Geist_500Medium',
  semibold: 'Geist_600SemiBold',
  bold: 'Geist_700Bold',
  heavy: 'Geist_800ExtraBold',
} as const;

const tabular: TextStyle['fontVariant'] = ['tabular-nums'];

export const type = {
  largeTitle: { fontFamily: font.heavy, fontSize: 28, lineHeight: 34, letterSpacing: -0.8 },
  heroTitle: { fontFamily: font.heavy, fontSize: 30, lineHeight: 34, letterSpacing: -0.8 },
  /** A tab screen's own title: compact, not a dashboard banner. */
  screenTitle: { fontFamily: font.bold, fontSize: 23, lineHeight: 28, letterSpacing: -0.6 },
  /** The workout on a hero card, in capitals like a label on kit. */
  workoutName: {
    fontFamily: font.heavy,
    fontSize: 23,
    lineHeight: 28,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  title: { fontFamily: font.bold, fontSize: 19, lineHeight: 24, letterSpacing: -0.3 },
  section: { fontFamily: font.bold, fontSize: 20, lineHeight: 25, letterSpacing: -0.4 },
  cardTitle: { fontFamily: font.semibold, fontSize: 15, lineHeight: 19, letterSpacing: -0.2 },
  stat: {
    fontFamily: font.bold,
    fontSize: 26,
    lineHeight: 30,
    letterSpacing: -0.8,
    fontVariant: tabular,
  },
  metric: {
    fontFamily: font.bold,
    fontSize: 30,
    lineHeight: 34,
    letterSpacing: -0.9,
    fontVariant: tabular,
  },
  metricUnit: { fontFamily: font.semibold, fontSize: 15, lineHeight: 20, letterSpacing: -0.1 },
  body: { fontFamily: font.medium, fontSize: 16, lineHeight: 22, letterSpacing: -0.1 },
  bodyStrong: { fontFamily: font.semibold, fontSize: 16, lineHeight: 22, letterSpacing: -0.2 },
  label: { fontFamily: font.semibold, fontSize: 14, lineHeight: 18, letterSpacing: -0.1 },
  caption: { fontFamily: font.medium, fontSize: 13, lineHeight: 17, letterSpacing: 0 },
  numeric: { fontFamily: font.semibold, fontSize: 14, lineHeight: 18, fontVariant: tabular },
  eyebrow: {
    fontFamily: font.bold,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  button: { fontFamily: font.bold, fontSize: 17, lineHeight: 22, letterSpacing: -0.2 },
  /** The hero call to action: short, spaced capitals. */
  cta: {
    fontFamily: font.bold,
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: 1.3,
    textTransform: 'uppercase',
  },
  tab: { fontFamily: font.semibold, fontSize: 11, lineHeight: 13, letterSpacing: 0.1 },
  day: { fontFamily: font.semibold, fontSize: 17, lineHeight: 21, fontVariant: tabular },
} as const satisfies Record<string, TextStyle>;

export type TypeVariant = keyof typeof type;
