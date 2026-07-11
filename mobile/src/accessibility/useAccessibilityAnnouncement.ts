import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';


export function useAccessibilityAnnouncement(message: string | null | undefined): void {
  const announced = useRef<string | null>(null);

  useEffect(() => {
    if (!message || message === announced.current) return;
    announced.current = message;
    if (Platform.OS !== 'ios') return;
    AccessibilityInfo.announceForAccessibility(message);
  }, [message]);
}
