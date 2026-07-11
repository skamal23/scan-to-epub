import { AccessibilityInfo, Platform } from 'react-native';
import { render } from '@testing-library/react-native';

import { useAccessibilityAnnouncement } from '../useAccessibilityAnnouncement';


function Probe({ message }: { message: string | null }) {
  useAccessibilityAnnouncement(message);
  return null;
}


test('announces each nonempty state message once', () => {
  const announce = jest
    .spyOn(AccessibilityInfo, 'announceForAccessibility')
    .mockImplementation(() => undefined);
  const view = render(<Probe message="Checking approved sources" />);

  view.rerender(<Probe message="Checking approved sources" />);
  view.rerender(<Probe message="Open edition ready" />);

  expect(announce).toHaveBeenCalledTimes(2);
  expect(announce).toHaveBeenNthCalledWith(1, 'Checking approved sources');
  expect(announce).toHaveBeenNthCalledWith(2, 'Open edition ready');

  announce.mockRestore();
});


test('uses the rendered live region instead of a duplicate Android announcement', () => {
  const descriptor = Object.getOwnPropertyDescriptor(Platform, 'OS');
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  const announce = jest
    .spyOn(AccessibilityInfo, 'announceForAccessibility')
    .mockImplementation(() => undefined);
  announce.mockClear();

  try {
    render(<Probe message="Checking approved sources" />);
    expect(announce).not.toHaveBeenCalled();
  } finally {
    announce.mockRestore();
    if (descriptor) Object.defineProperty(Platform, 'OS', descriptor);
  }
});
