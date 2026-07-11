import { act, fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import {
  BookCard,
  PrimaryButton,
  SecondaryButton,
  StatusMessage,
} from '../primitives';

describe('UI primitives', () => {
  test('primary button invokes its action', () => {
    const onPress = jest.fn();
    const view = render(<PrimaryButton label="Continue" onPress={onPress} />);

    fireEvent.press(view.getByRole('button', { name: 'Continue' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test('primary button uses opacity and scale press feedback without changing its semantics', () => {
    const view = render(<PrimaryButton label="Continue" onPress={jest.fn()} />);
    const button = view.getByRole('button', { name: 'Continue' });
    const restingStyle = StyleSheet.flatten(button.props.style);

    act(() => {
      button.props.onResponderGrant({
        currentTarget: 1,
        nativeEvent: { pageX: 0, pageY: 0, timestamp: 0 },
        persist: () => undefined,
      });
    });

    const pressedStyle = StyleSheet.flatten(
      view.getByRole('button', { name: 'Continue' }).props.style,
    );
    const { opacity: _restingOpacity, transform: _restingTransform, ...restingProperties } = restingStyle;
    const { opacity, transform, ...pressedProperties } = pressedStyle;

    expect(button.props.accessibilityRole).toBe('button');
    expect(button.props.accessibilityLabel).toBe('Continue');
    expect(pressedProperties).toEqual(restingProperties);
    expect(opacity).toBe(0.72);
    expect(transform).toEqual([{ scale: 0.975 }]);

    act(() => {
      button.props.onResponderRelease({
        currentTarget: 1,
        nativeEvent: { pageX: 0, pageY: 0, timestamp: 0 },
        persist: () => undefined,
      });
    });
  });

  test('status message exposes readable status text', () => {
    const view = render(<StatusMessage tone="success" text="Connected" />);

    expect(view.getByText('Connected')).toBeTruthy();
  });

  test('book card renders incomplete metadata without placeholders', () => {
    const view = render(<BookCard title="Persuasion" author={null} />);

    expect(view.getByText('Persuasion')).toBeTruthy();
    expect(view.queryByText('Unknown author')).toBeNull();
  });

  test('secondary button remains readable on dark surfaces', () => {
    const view = render(
      <SecondaryButton
        appearance="onDark"
        compact
        label="Back"
        onPress={jest.fn()}
      />,
    );

    const labelStyle = StyleSheet.flatten(view.getByText('Back').props.style);
    expect(labelStyle.color).toBe('#FFFFFF');
  });
});
