import { useWindowDimensions } from 'react-native';

/**
 * Everything else Home's first screen must fit around the figure on a compact iPhone:
 * status bar, header, date strip, the card's title and meta, focus line and call to
 * action, and the floating tab bar.
 */
const FIRST_SCREEN_CHROME = 400;

/**
 * Figure height for a hero card: the card's centerpiece — the front/back pair spans most
 * of the card's width on a large iPhone — while the call to action never falls off a
 * compact iPhone's first screen. `scale` shrinks it where the figure is secondary;
 * `extraChrome` is what a screen shows above the card beyond Home's header and strip.
 */
export function useAnatomyHeight(scale = 1, extraChrome = 0): number {
  const { width, height } = useWindowDimensions();
  const fit = Math.min(290, width * 0.66, height - FIRST_SCREEN_CHROME - extraChrome);
  return Math.round(Math.max(160, fit) * scale);
}
