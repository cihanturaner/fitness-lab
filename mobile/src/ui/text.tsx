import { Text as RNText, type TextProps } from 'react-native';

import { color } from '@/theme/tokens';
import { type, type TypeVariant } from '@/theme/typography';

type Props = TextProps & {
  variant?: TypeVariant;
  tone?: keyof typeof color;
};

export function Text({ variant = 'body', tone = 'ink', style, ...rest }: Props) {
  return <RNText {...rest} style={[type[variant], { color: color[tone] }, style]} />;
}
