import { useWindowDimensions } from 'react-native';

/**
 * Everything else Home's first screen must fit around the figure on a compact iPhone:
 * status bar, header, date strip, the card's title, focus line, progress and call to
 * action, and the floating tab bar.
 */
const FIRST_SCREEN_CHROME = 470;

/**
 * Figure height for a hero card: large enough to be the card's centerpiece, compact enough
 * that the card stays a card (the Progress section starts on a large iPhone's first screen)
 * and that the call to action never falls off a compact iPhone's first screen. `scale`
 * shrinks it where the figure is secondary (Training).
 */
export function useAnatomyHeight(scale = 1): number {
  const { width, height } = useWindowDimensions();
  const fit = Math.min(236, width * 0.55, height - FIRST_SCREEN_CHROME);
  return Math.round(Math.max(150, fit) * scale);
}
