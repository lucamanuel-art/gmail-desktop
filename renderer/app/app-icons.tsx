// Monochrome stroke icons for the Google app surfaces, in the same style as
// the sidebar's gear icon. Kept as simple glyph shapes (not Google's branded
// product icons) so they inherit the sidebar's theme colors.
import type { FC } from 'react';
import type { Surface } from '../lib/surfaces';

interface IconProps {
  className?: string;
}

function svgProps(className: string) {
  return {
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
  };
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

function DriveIcon({ className = '' }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <path d="M9 4h6l6 10.5-3 5.5H6l-3-5.5L9 4z" />
      <path d="M9 4l6 10.5M15 4L9 14.5M3 14.5h12" />
    </svg>
  );
}

function DocsIcon({ className = '' }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7l-4-4z" />
      <path d="M14 3v4h4M9 12h6M9 15.5h6" />
    </svg>
  );
}

function SheetsIcon({ className = '' }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <rect x="4" y="4" width="16" height="16" rx="1.5" />
      <path d="M4 10h16M10 10v10" />
    </svg>
  );
}

function SlidesIcon({ className = '' }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <rect x="3" y="4" width="18" height="14" rx="1.5" />
      <rect x="7" y="8" width="10" height="6" />
      <path d="M12 18v2.5" />
    </svg>
  );
}

function KeepIcon({ className = '' }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <path d="M12 3a6 6 0 0 0-3.5 10.9c.7.5 1 1.3 1 2.1h5c0-.8.3-1.6 1-2.1A6 6 0 0 0 12 3z" />
      <path d="M9.5 19h5M10.5 21.5h3" />
    </svg>
  );
}

function ContactsIcon({ className = '' }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20c.8-3.5 3.6-5.5 7-5.5s6.2 2 7 5.5" />
    </svg>
  );
}

function ChatIcon({ className = '' }: IconProps) {
  return (
    <svg {...svgProps(className)}>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-5 4V5.5z" />
      <path d="M8 9h8M8 12h5" />
    </svg>
  );
}

// Icon per app surface for the waffle flyout. Mail/calendar are pinned in the
// sidebar with their own visuals and never render through this map.
export const APP_ICONS: Partial<Record<Surface, FC<IconProps>>> = {
  drive: DriveIcon,
  docs: DocsIcon,
  sheets: SheetsIcon,
  slides: SlidesIcon,
  keep: KeepIcon,
  contacts: ContactsIcon,
  chat: ChatIcon,
};
