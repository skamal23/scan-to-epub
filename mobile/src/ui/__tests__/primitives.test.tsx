import { fireEvent, render } from '@testing-library/react-native';
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
