import { useWindowDimensions } from 'react-native';

/**
 * Everything else Home's first screen must fit around the figure on a compact iPhone:
 * status bar, header, date strip, the card's title, focus line, progress and call to
 * action, and the floating tab bar.
 */
const FIRST_SCREEN_CHROME = 507;

/**
 * Figure height for a hero card: as large as the card's width allows, so it is the card's
 * centerpiece, but never so tall that the call to action falls off a compact iPhone's first
 * screen. `scale` shrinks it where the figure is secondary (Training).
 */
export function useAnatomyHeight(scale = 1): number {
  const { width, height } = useWindowDimensions();
  const fit = Math.min(290, width * 0.66, height - FIRST_SCREEN_CHROME);
  return Math.round(Math.max(150, fit) * scale);
}
