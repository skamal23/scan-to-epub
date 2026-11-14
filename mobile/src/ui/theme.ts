export const colors = {
  canvas: '#F5F6F7',
  surface: '#FFFFFF',
  ink: '#212529',
  mutedInk: '#626A70',
  evergreen: '#212529',
  evergreenSoft: '#ECEEF0',
  line: '#E8EAED',
  warning: '#90662E',
  danger: '#B44242',
  scannerBase: '#151819',
} as const;
export const fonts = {
  regular: 'InstrumentSans_400Regular',
  medium: 'InstrumentSans_500Medium',
  semibold: 'InstrumentSans_600SemiBold',
  bold: 'InstrumentSans_700Bold',
} as const;
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { control: 28, card: 24, sheet: 32, pill: 999 } as const;
export const type = { eyebrow: 12, title: 34, display: 40, body: 17, metadata: 14 } as const;
export const motion = {
  pressScale: 0.975,
  contentDistance: 8,
  cardDistance: 12,
  quickMs: 160,
  contentMs: 240,
  cardMs: 320,
} as const;
