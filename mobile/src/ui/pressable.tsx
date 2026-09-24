import { Pressable as RNPressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

type Props = Omit<PressableProps, 'style'> & { style?: StyleProp<ViewStyle> };

/** A Pressable with the app's press feedback: a slight sink, no ripple or flash. */
export function Pressable({ style, ...rest }: Props) {
  return (
    <RNPressable
      {...rest}
      style={({ pressed }) => [style, pressed && { opacity: 0.86, transform: [{ scale: 0.98 }] }]}
    />
  );
}
