import { act, fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';
import * as Haptics from 'expo-haptics';

import {
  ScannerView,
  type CameraPermissionState,
} from '../ScannerScreen';

const granted: CameraPermissionState = {
  granted: true,
  status: 'granted',
  canAskAgain: true,
};

const baseProps = {
  onBack: jest.fn(),
  onIsbnAccepted: jest.fn(),
  onManualSearch: jest.fn(),
  onOpenSettings: jest.fn(),
  onRequestPermission: jest.fn(),
  renderCamera: () => <Text>Fixture camera</Text>,
};

describe('<ScannerView />', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('shows a quiet loading state while permission is read', () => {
    const view = render(<ScannerView {...baseProps} permission={null} />);

    expect(view.getByText('Preparing camera…')).toBeTruthy();
    expect(view.getByRole('button', { name: 'Search manually' })).toBeTruthy();
  });

  test('explains camera use before requesting permission', () => {
    const view = render(
      <ScannerView
        {...baseProps}
        permission={{ granted: false, status: 'undetermined', canAskAgain: true }}
      />,
    );

    expect(view.getByText('Scan ISBN barcodes')).toBeTruthy();
    fireEvent.press(view.getByRole('button', { name: 'Allow camera' }));
    expect(baseProps.onRequestPermission).toHaveBeenCalledTimes(1);
  });

  test('supports retry and Settings recovery for denied permission', () => {
    const retry = render(
      <ScannerView
        {...baseProps}
        permission={{ granted: false, status: 'denied', canAskAgain: true }}
      />,
    );
    fireEvent.press(retry.getByRole('button', { name: 'Try camera access again' }));
    expect(baseProps.onRequestPermission).toHaveBeenCalledTimes(1);
    retry.unmount();

    const blocked = render(
      <ScannerView
        {...baseProps}
        permission={{ granted: false, status: 'denied', canAskAgain: false }}
      />,
    );
    fireEvent.press(blocked.getByRole('button', { name: 'Open Settings' }));
    expect(baseProps.onOpenSettings).toHaveBeenCalledTimes(1);
  });

  test('freezes and accepts a stable repeated ISBN observation', () => {
    jest.useFakeTimers();
    const accepted = jest.fn();
    const feedback = jest.fn().mockResolvedValue(undefined);
    const view = render(
      <ScannerView
        {...baseProps}
        permission={granted}
        feedback={feedback}
        captureDelayMs={250}
        onIsbnAccepted={accepted}
        scriptedObservations={[
          { type: 'ean13', data: '9780141439518', at: 0 },
          { type: 'ean13', data: '9780141439518', at: 250 },
          { type: 'ean13', data: '9780141439518', at: 500 },
        ]}
      />,
    );

    expect(view.getByText('ISBN captured.')).toBeTruthy();
    expect(feedback).toHaveBeenCalledTimes(1);
    act(() => jest.advanceTimersByTime(250));
    expect(accepted).toHaveBeenCalledWith('9780141439518');
    jest.useRealTimers();
  });

  test('manual shutter accepts the latest single valid observation', () => {
    jest.useFakeTimers();
    const accepted = jest.fn();
    const view = render(
      <ScannerView
        {...baseProps}
        permission={granted}
        feedback={jest.fn().mockResolvedValue(undefined)}
        captureDelayMs={1}
        now={() => 500}
        onIsbnAccepted={accepted}
        scriptedObservations={[
          { type: 'ean13', data: '9780141439518', at: 0 },
        ]}
      />,
    );

    fireEvent.press(view.getByRole('button', { name: 'Capture detected ISBN' }));
    act(() => jest.advanceTimersByTime(1));
    expect(accepted).toHaveBeenCalledWith('9780141439518');
    jest.useRealTimers();
  });

  test('does not replay default success feedback after a parent rerender', () => {
    jest.useFakeTimers();
    const haptic = jest.spyOn(Haptics, 'notificationAsync').mockResolvedValue(undefined);
    const observations = [
      { type: 'ean13', data: '9780141439518', at: 0 },
      { type: 'ean13', data: '9780141439518', at: 250 },
      { type: 'ean13', data: '9780141439518', at: 500 },
    ];
    const view = render(
      <ScannerView
        {...baseProps}
        permission={granted}
        captureDelayMs={5000}
        onIsbnAccepted={jest.fn()}
        scriptedObservations={observations}
      />,
    );
    expect(haptic).toHaveBeenCalledTimes(1);

    view.rerender(
      <ScannerView
        {...baseProps}
        permission={granted}
        captureDelayMs={5000}
        scriptedObservations={observations}
      />,
    );
    expect(haptic).toHaveBeenCalledTimes(1);
    haptic.mockRestore();
    jest.useRealTimers();
  });
});
