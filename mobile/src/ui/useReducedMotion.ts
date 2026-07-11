import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export type ReducedMotionStatus = {
  isReady: boolean;
  reducedMotion: boolean;
};

const unknownReducedMotionStatus: ReducedMotionStatus = {
  isReady: false,
  reducedMotion: false,
};

let latestPreference: boolean | undefined;

function initialReducedMotionStatus(): ReducedMotionStatus {
  if (latestPreference !== undefined) {
    return { isReady: true, reducedMotion: latestPreference };
  }

  return unknownReducedMotionStatus;
}

export function useReducedMotionStatus(): ReducedMotionStatus {
  const [status, setStatus] = useState<ReducedMotionStatus>(initialReducedMotionStatus);

  useEffect(() => {
    let active = true;
    let receivedChange = false;
    const setKnownStatus = (reducedMotion: boolean) => {
      latestPreference = reducedMotion;
      setStatus({ isReady: true, reducedMotion });
    };

    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active && !receivedChange) {
          setKnownStatus(enabled);
        }
      })
      .catch(() => undefined);

    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      if (!active) return;
      receivedChange = true;
      setKnownStatus(enabled);
    });

    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return status;
}

export function useReducedMotion(): boolean {
  return useReducedMotionStatus().reducedMotion;
}
