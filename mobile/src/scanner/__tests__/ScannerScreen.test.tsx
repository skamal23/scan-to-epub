import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import * as Haptics from 'expo-haptics';

jest.mock('expo-camera', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    CameraView: (props: object) => React.createElement(View, props),
    useCameraPermissions: () => [
      { granted: true, status: 'granted', canAskAgain: true },
      jest.fn(),
    ],
  };
});

import {
  ScannerScreen,
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
  onCaptureCover: jest.fn(),
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

    expect(view.getByText('Scan a cover or ISBN')).toBeTruthy();
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

  test('freezes and accepts a stable repeated ISBN observation', async () => {
    const accepted = jest.fn();
    const feedback = jest.fn().mockResolvedValue(undefined);
    const view = render(
      <ScannerView
        {...baseProps}
        permission={granted}
        feedback={feedback}
        captureDelayMs={0}
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
    await waitFor(() => expect(accepted).toHaveBeenCalledWith('9780141439518'));
  });

  test('manual shutter accepts the latest single valid observation', async () => {
    const accepted = jest.fn();
    const view = render(
      <ScannerView
        {...baseProps}
        permission={granted}
        feedback={jest.fn().mockResolvedValue(undefined)}
        captureDelayMs={0}
        now={() => 500}
        onIsbnAccepted={accepted}
        scriptedObservations={[
          { type: 'ean13', data: '9780141439518', at: 0 },
        ]}
      />,
    );

    fireEvent.press(view.getByRole('button', { name: 'Capture cover or detected ISBN' }));
    await waitFor(() => expect(accepted).toHaveBeenCalledWith('9780141439518'));
  });

  test('manual shutter captures a cover when no fresh ISBN is visible', () => {
    const captureCover = jest.fn();
    const view = render(
      <ScannerView
        {...baseProps}
        permission={granted}
        onCaptureCover={captureCover}
      />,
    );

    expect(view.getByText('Scan a cover or ISBN')).toBeTruthy();
    expect(view.getByText('Cover photos are processed temporarily and not saved.')).toBeTruthy();
    fireEvent.press(view.getByRole('button', { name: 'Capture cover or detected ISBN' }));

    expect(captureCover).toHaveBeenCalledTimes(1);
    expect(baseProps.onIsbnAccepted).not.toHaveBeenCalled();
  });

  test('does not replay default success feedback after a parent rerender', async () => {
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
        captureDelayMs={0}
        onIsbnAccepted={jest.fn()}
        scriptedObservations={observations}
      />,
    );
    await waitFor(() => expect(haptic).toHaveBeenCalledTimes(1));

    view.rerender(
      <ScannerView
        {...baseProps}
        permission={granted}
        captureDelayMs={0}
        scriptedObservations={observations}
      />,
    );
    expect(haptic).toHaveBeenCalledTimes(1);
    view.unmount();
    haptic.mockRestore();
  });

  test('offers barcode and manual recovery after an uncertain cover', async () => {
    const manualSearch = jest.fn();
    const view = render(
      <ScannerScreen
        fixture={{
          permission: granted,
          coverResult: {
            status: 'no_match',
            confidence: 'low',
            extractedTitle: null,
            extractedAuthor: null,
            candidates: [],
            providerFailures: [],
          },
        }}
        onBack={jest.fn()}
        onCoverRecognized={jest.fn()}
        onIsbnAccepted={jest.fn()}
        onManualSearch={manualSearch}
      />,
    );

    fireEvent.press(view.getByRole('button', { name: 'Capture cover or detected ISBN' }));
    await waitFor(() => expect(view.getByText('Couldn’t identify this cover')).toBeTruthy());
    expect(view.getByRole('button', { name: 'Try another cover' })).toBeTruthy();
    fireEvent.press(view.getByRole('button', { name: 'Scan the back barcode' }));
    expect(view.getByText('Scan a cover or ISBN')).toBeTruthy();

    fireEvent.press(view.getByRole('button', { name: 'Capture cover or detected ISBN' }));
    await waitFor(() => expect(view.getByText('Couldn’t identify this cover')).toBeTruthy());
    fireEvent.press(view.getByRole('button', { name: 'Enter title manually' }));
    expect(manualSearch).toHaveBeenCalledTimes(1);
  });

  test('cancels cover processing without allowing a late fixture result to navigate', async () => {
    const recognized = jest.fn();
    const view = render(
      <ScannerScreen
        fixture={{
          permission: granted,
          coverDelayMs: 50,
          coverResult: {
            status: 'matched',
            confidence: 'high',
            extractedTitle: 'Pride and Prejudice',
            extractedAuthor: 'Jane Austen',
            candidates: [],
            providerFailures: [],
          },
        }}
        onBack={jest.fn()}
        onCoverRecognized={recognized}
        onIsbnAccepted={jest.fn()}
        onManualSearch={jest.fn()}
      />,
    );

    fireEvent.press(view.getByRole('button', { name: 'Capture cover or detected ISBN' }));
    expect(view.getByText('Reading the cover…')).toBeTruthy();
    fireEvent.press(view.getByRole('button', { name: 'Cancel' }));
    expect(view.getByText('Scan a cover or ISBN')).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(recognized).not.toHaveBeenCalled();
    expect(view.getByText('Scan a cover or ISBN')).toBeTruthy();
  });
});
