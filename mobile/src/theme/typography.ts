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
  title: { fontFamily: font.bold, fontSize: 19, lineHeight: 24, letterSpacing: -0.3 },
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
  tab: { fontFamily: font.semibold, fontSize: 11, lineHeight: 13, letterSpacing: 0.1 },
} as const satisfies Record<string, TextStyle>;

export type TypeVariant = keyof typeof type;
