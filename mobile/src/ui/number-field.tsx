import { forwardRef, useState } from 'react';
import { StyleSheet, TextInput, type TextInputProps } from 'react-native';

import { color, radius } from '@/theme/tokens';
import { font } from '@/theme/typography';

type Props = Omit<TextInputProps, 'style'> & {
  /** `decimal`: a load or bodyweight (decimal pad); `whole`: reps, RIR, grams (number pad). */
  kind: 'decimal' | 'whole';
  accessibilityLabel: string;
  size?: 'regular' | 'large';
  invalid?: boolean;
  flex?: number;
};

/**
 * A numeric entry field: large tabular figures on a sunken well, a numeric keyboard, an
 * emerald ring while focused. The placeholder carries the plan (for instance "6–10" reps),
 * never an invented recommendation.
 */
export const NumberField = forwardRef<TextInput, Props>(function NumberField(
  { kind, size = 'regular', invalid = false, flex, onFocus, onBlur, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      ref={ref}
      {...rest}
      keyboardType={kind === 'decimal' ? 'decimal-pad' : 'number-pad'}
      inputMode={kind === 'decimal' ? 'decimal' : 'numeric'}
      selectTextOnFocus
      placeholderTextColor={color.placeholder}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
      style={[
        styles.field,
        size === 'large' && styles.large,
        flex !== undefined && { flex },
        focused && styles.focused,
        invalid && styles.invalid,
      ]}
    />
  );
});

const styles = StyleSheet.create({
  field: {
    minWidth: 0,
    height: 48,
    paddingHorizontal: 4,
    borderRadius: radius.md,
    backgroundColor: color.card,
    borderWidth: 1.5,
    borderColor: color.hairline,
    color: color.ink,
    fontFamily: font.semibold,
    fontSize: 18,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  large: { height: 56, fontSize: 24, paddingHorizontal: 10, borderRadius: radius.lg },
  focused: { borderColor: color.emerald600 },
  invalid: { borderColor: color.warn },
});
