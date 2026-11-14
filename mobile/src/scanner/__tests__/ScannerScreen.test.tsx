import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet, Text } from 'react-native';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { metadataScenarios } from '../../dev/metadataScenarios';
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

type MockEntranceProps = {
  children: React.ReactNode;
  delay?: number;
};

const mockEntrance = jest.fn(({ children }: MockEntranceProps) => children);

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

jest.mock('../../ui/Entrance', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    Entrance: (props: MockEntranceProps) =>
      React.createElement(View, { testID: 'entrance' }, mockEntrance(props)),
  };
});

import { ScannerScreen, ScannerView, type CameraPermissionState } from '../ScannerScreen';
import { colors } from '../../ui/theme';

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

  test('announces blocked camera recovery as an accessible alert', () => {
    const view = render(
      <ScannerView
        {...baseProps}
        permission={{ granted: false, status: 'denied', canAskAgain: false }}
      />,
    );

    expect(view.getByRole('alert')).toHaveTextContent(
      'Enable camera access in Settings, or search manually.',
    );
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
        scriptedObservations={[{ type: 'ean13', data: '9780141439518', at: 0 }]}
      />,
    );

    fireEvent.press(view.getByRole('button', { name: 'Capture cover or detected ISBN' }));
    await waitFor(() => expect(accepted).toHaveBeenCalledWith('9780141439518'));
  });

  test('manual shutter captures a cover when no fresh ISBN is visible', () => {
    const captureCover = jest.fn();
    const view = render(
      <ScannerView {...baseProps} permission={granted} onCaptureCover={captureCover} />,
    );

    expect(view.getByText('Scan a book')).toBeTruthy();
    expect(view.queryByText('Cover photos are processed temporarily and not saved.')).toBeNull();
    fireEvent.press(view.getByRole('button', { name: 'Capture cover or detected ISBN' }));

    expect(captureCover).toHaveBeenCalledTimes(1);
    expect(baseProps.onIsbnAccepted).not.toHaveBeenCalled();
  });

  test('uses the scanner base token for the camera fallback root', () => {
    const view = render(<ScannerView {...baseProps} permission={granted} />);

    try {
      const scannerRoot = view.UNSAFE_getByType(SafeAreaView);

      expect(StyleSheet.flatten(scannerRoot.props.style).backgroundColor).toBe(colors.scannerBase);
    } finally {
      view.unmount();
    }
  });

  test('does not delay static scanner guide readiness', () => {
    const view = render(<ScannerView {...baseProps} permission={granted} />);

    try {
      expect(mockEntrance.mock.calls.map(([props]) => props.delay)).toEqual([undefined, undefined]);
    } finally {
      view.unmount();
    }
  });

  test('keeps Back outside animated scanner content', () => {
    const view = render(<ScannerView {...baseProps} permission={granted} />);

    try {
      for (const entrance of view.getAllByTestId('entrance')) {
        expect(entrance.findAllByProps({ accessibilityLabel: 'Back' })).toHaveLength(0);
      }
    } finally {
      view.unmount();
    }
  });

  test('keeps the guide and capture action available for normal and fixture cameras', () => {
    const normal = render(
      <ScannerScreen
        onBack={jest.fn()}
        onCoverRecognized={jest.fn()}
        onIsbnAccepted={jest.fn()}
        onManualSearch={jest.fn()}
      />,
    );
    const fixture = render(
      <ScannerScreen
        fixture={{ permission: granted }}
        onBack={jest.fn()}
        onCoverRecognized={jest.fn()}
        onIsbnAccepted={jest.fn()}
        onManualSearch={jest.fn()}
      />,
    );

    try {
      for (const view of [normal, fixture]) {
        expect(view.getByLabelText('Book scan guide')).toBeTruthy();
        expect(view.getByRole('button', { name: 'Capture cover or detected ISBN' })).toBeTruthy();
      }
    } finally {
      normal.unmount();
      fixture.unmount();
    }
  });

  test('marks scanner guidance as a polite live status', () => {
    const view = render(<ScannerView {...baseProps} permission={granted} />);

    expect(
      view.getByText('Frame the front cover, or show the back barcode.').props
        .accessibilityLiveRegion,
    ).toBe('polite');
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
    expect(view.getByText('Scan a book')).toBeTruthy();

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
            candidates: metadataScenarios.one,
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
    expect(view.getByText('Finding your book…')).toBeTruthy();
    fireEvent.press(view.getByRole('button', { name: 'Cancel' }));
    expect(view.getByText('Scan a book')).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(recognized).not.toHaveBeenCalled();
    expect(view.getByText('Scan a book')).toBeTruthy();
  });
  test('hands a recognized cover to confirmation with Reduce Motion enabled', async () => {
    const preference = jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);
    const recognized = jest.fn();
    const result = {
      status: 'matched' as const,
      confidence: 'high' as const,
      extractedTitle: 'Pride and Prejudice',
      extractedAuthor: 'Jane Austen',
      candidates: metadataScenarios.one,
      providerFailures: [],
    };
    const view = render(
      <ScannerScreen
        fixture={{ permission: granted, coverResult: result }}
        onBack={jest.fn()}
        onCoverRecognized={recognized}
        onIsbnAccepted={jest.fn()}
        onManualSearch={jest.fn()}
      />,
    );
    fireEvent.press(view.getByRole('button', { name: 'Capture cover or detected ISBN' }));
    await waitFor(() => expect(recognized).toHaveBeenCalledWith(result, undefined));
    expect(recognized).toHaveBeenCalledTimes(1);
    view.unmount();
    preference.mockRestore();
  });
  test('ignores background barcodes during a cover lift and remains usable after cancellation', async () => {
    let observe = (_value: { type: string; data: string }) => {};
    const accepted = jest.fn();
    const renderCamera = ({ onBarcodeScanned }: { onBarcodeScanned: typeof observe }) => {
      observe = onBarcodeScanned;
      return <Text>Fixture camera</Text>;
    };
    const props = {
      ...baseProps,
      permission: granted,
      renderCamera,
      onIsbnAccepted: accepted,
      captureDelayMs: 0,
      now: () => 500,
    };
    const view = render(<ScannerView {...props} busy />);
    act(() => observe({ type: 'ean13', data: '9780141439518' }));
    expect(view.getByText('Frame the front cover, or show the back barcode.')).toBeTruthy();
    view.rerender(<ScannerView {...props} busy={false} />);
    act(() => observe({ type: 'ean13', data: '9780141439518' }));
    fireEvent.press(view.getByRole('button', { name: 'Capture cover or detected ISBN' }));
    await waitFor(() => expect(accepted).toHaveBeenCalledWith('9780141439518'));
  });
});
