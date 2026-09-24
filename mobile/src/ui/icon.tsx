import { SymbolView } from 'expo-symbols';
import type { ColorValue } from 'react-native';

/**
 * The app's icon set: SF Symbols on iOS, Material Symbols (bundled font) on Android and
 * web. Feature code names an icon by meaning, never by platform symbol.
 */
const symbols = {
  home: { ios: 'house.fill', android: 'home', web: 'home' },
  training: { ios: 'dumbbell.fill', android: 'fitness_center', web: 'fitness_center' },
  nutrition: { ios: 'fork.knife', android: 'restaurant', web: 'restaurant' },
  history: { ios: 'clock.arrow.circlepath', android: 'history', web: 'history' },
  settings: { ios: 'gearshape', android: 'settings', web: 'settings' },
  add: { ios: 'plus', android: 'add', web: 'add' },
  play: { ios: 'play.fill', android: 'play_arrow', web: 'play_arrow' },
  check: { ios: 'checkmark', android: 'check', web: 'check' },
  chevronRight: { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' },
  chevronLeft: { ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' },
  bodyweight: { ios: 'scalemass.fill', android: 'monitor_weight', web: 'monitor_weight' },
  calories: {
    ios: 'flame.fill',
    android: 'local_fire_department',
    web: 'local_fire_department',
  },
  macros: { ios: 'chart.pie.fill', android: 'pie_chart', web: 'pie_chart' },
  week: { ios: 'calendar', android: 'calendar_month', web: 'calendar_month' },
  figure: {
    ios: 'figure.strengthtraining.traditional',
    android: 'person',
    web: 'person',
  },
  close: { ios: 'xmark', android: 'close', web: 'close' },
} as const;

export type IconName = keyof typeof symbols;

type Props = { name: IconName; size?: number; color: ColorValue };

export function Icon({ name, size = 22, color }: Props) {
  return (
    <SymbolView
      name={symbols[name]}
      size={size}
      tintColor={color}
      weight="semibold"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
