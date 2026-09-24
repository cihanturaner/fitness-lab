import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { HeroButton } from '../hero-button';

describe('HeroButton', () => {
  it('ignores a second tap while the first action is still saving', async () => {
    let finish!: () => void;
    const onPress = jest.fn(() => new Promise<void>((r) => (finish = r)));
    await render(<HeroButton label="Finish workout" icon="check" accessibilityLabel="Finish" onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Finish' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Finish' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    await fireEvent.press(screen.getByRole('button', { name: 'Finish' }));
    expect(onPress).toHaveBeenCalledTimes(2);
  });
});
