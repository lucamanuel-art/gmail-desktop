// Icons for the Google app surfaces in the sidebar's waffle flyout: the
// official product icons (embedded PNGs, see app-icon-data.ts), rendered the
// same way as the calendar icon. Only the waffle trigger itself is a local
// glyph so it inherits the sidebar's theme colors.
import type { FC } from 'react';
import type { Surface } from '../lib/surfaces';
import { APP_ICON_DATA_URIS } from './app-icon-data';

interface IconProps {
  className?: string;
}

export function WaffleIcon({ className = '' }: IconProps) {
  // 3×3 dot grid ("waffle"), filled dots read better than stroked at 20px.
  const cells = [5, 12, 19];
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      {cells.flatMap((y) => cells.map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.9" />))}
    </svg>
  );
}

function productIcon(surface: Surface): FC<IconProps> {
  const src = APP_ICON_DATA_URIS[surface];
  return function ProductIcon({ className = '' }: IconProps) {
    return <img src={src} alt="" draggable={false} className={className} />;
  };
}

// Icon per app surface for the waffle flyout. Mail/calendar are pinned in the
// sidebar with their own visuals and never render through this map.
export const APP_ICONS: Partial<Record<Surface, FC<IconProps>>> = {
  drive: productIcon('drive'),
  docs: productIcon('docs'),
  sheets: productIcon('sheets'),
  slides: productIcon('slides'),
  keep: productIcon('keep'),
  contacts: productIcon('contacts'),
  chat: productIcon('chat'),
};
