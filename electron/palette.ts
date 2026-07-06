export const PALETTE = ['#4285F4', '#EA4335', '#34A853', '#FBBC05', '#A142F4', '#00ACC1'] as const;

export function colorForIndex(index: number): string {
  return PALETTE[index % PALETTE.length];
}
