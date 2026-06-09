import React from 'react';

// Lucide-style 1.5px stroke icons.
const ICON_PATHS: Record<string, string> = {
  cursor: 'M5 3l14 7-6 2-2 6-6-15z',
  hand:   'M9 11V5a2 2 0 0 1 4 0v6M13 11V3a2 2 0 0 1 4 0v8M9 11V8a2 2 0 0 0-4 0v5a8 8 0 0 0 16 0v-2a2 2 0 0 0-4 0',
  speaker: 'M6 4h6l5-3v22l-5-3H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM18 8a4 4 0 0 1 0 8',
  panel:  'M4 4h16v16H4zM8 4v16M16 4v16M4 12h16',
  panel2: 'M4 6h16v12H4zM8 6v12M16 6v12',
  measure:'M3 13l3-3 3 3 3-3 3 3 3-3 3 3M3 13v4h18v-4',
  layers: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 18l9 5 9-5',
  light:  'M9 18h6M10 21h4M12 3a6 6 0 0 0-3 11c.6.4 1 1 1 1.7V18h4v-2.3c0-.7.4-1.3 1-1.7a6 6 0 0 0-3-11z',
  camera: 'M3 7h4l2-3h6l2 3h4v12H3zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  share:  'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  x:      'M18 6L6 18M6 6l12 12',
  plus:   'M12 5v14M5 12h14',
  minus:  'M5 12h14',
  chevD:  'M6 9l6 6 6-6',
  chevU:  'M6 15l6-6 6 6',
  chevL:  'M15 6l-6 6 6 6',
  chevR:  'M9 6l6 6-6 6',
  presentation: 'M2 3h20v14H2zM12 17v4M8 21h8M7 7l3 3 4-4 3 3',
  cube:   'M12 3l9 5v8l-9 5-9-5V8l9-5zM12 3v18M3 8l9 5 9-5',
  grid:   'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  ruler:  'M2 16l14-14 6 6L8 22l-6-6zM7.5 10.5l3 3M10.5 7.5l3 3M13.5 4.5l3 3',
  fit:    'M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5',
  refresh:'M21 12a9 9 0 1 1-3-6.7M21 4v6h-6',
  trash:  'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6',
  copy:   'M8 8h12v12H8zM4 16V6a2 2 0 0 1 2-2h10',
  rotate: 'M3 12a9 9 0 1 0 9-9M3 4v5h5',
  ray:    'M2 12c5-3 10-8 20-8M2 12l8 0M10 12l4-3M10 12l4 3',
  heatmap: 'M3 12c3-4 6-4 9 0s6 4 9 0M3 18c3-4 6-4 9 0s6 4 9 0M3 6c3-4 6-4 9 0s6 4 9 0',
  ear:    'M6 8a6 6 0 1 1 12 0c0 3-2 4-2 7s-2 5-5 5-3-2-3-3 1-3 1-4-3-1-3-5z',
  user:   'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  users:  'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M22 21v-2a4 4 0 0 0-3-3.87M16 3.13A4 4 0 0 1 16 11',
  bag:    'M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6L18 2zM3 6h18M16 10a4 4 0 1 1-8 0',
  bell:   'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0',
  more:   'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM12 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM12 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  check:  'M20 6L9 17l-5-5',
  iphone: 'M5 2h14a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM10 18h4',
  bolt:   'M13 2L4 14h8l-1 8 9-12h-8l1-8z',
  filter: 'M22 3H2l8 9.46V19l4 2v-8.54L22 3z',
  triangle: 'M12 3l10 18H2L12 3z',
  alert:  'M12 9v4M12 17h.01M3 17l9-14 9 14H3z',
  info:   'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 8h.01M11 12h1v4h1',
  squareCheck: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM9 12l2 2 4-4',
  microphone: 'M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8',
  undo:   'M3 7v6h6M3 13a9 9 0 1 0 3-7.5L3 9',
  redo:   'M21 7v6h-6M21 13a9 9 0 1 1-3-7.5L21 9',
  save:   'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8',
  folderOpen: 'M3 7v13h18V10H12L9 7H3zM3 7h6l3 3',
  pencil: 'M11 4h2a2 2 0 0 1 2 2v14H7V6a2 2 0 0 1 2-2zM3 21h18M7 8l4 4 8-8a2 2 0 1 0-2.83-2.83L7 7.17',
  rectangle: 'M3 5h18v14H3z',
  link:   'M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1 1M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1-1',
  polygon: 'M12 2l9 6-3 11H6L3 8z',
  lock:   'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  unlock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 7-2',
};

interface IconProps {
  name: string;
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: React.CSSProperties;
}
export function Icon({ name, size = 16, strokeWidth = 1.5, className = '', style = {} }: IconProps) {
  const d = ICON_PATHS[name];
  if (!d) return null;
  const segments = d.split('M').filter(Boolean).map(seg => 'M' + seg);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'block', flexShrink: 0, ...style }}
      className={className}
      aria-hidden="true"
    >
      {segments.map((s, i) => <path key={i} d={s} />)}
    </svg>
  );
}

export function BeaconLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-label="Beacon AVL" style={{ display: 'block' }}>
      <defs>
        <linearGradient id="beacon-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1A4FBF"/>
          <stop offset="50%" stopColor="#2E87F5"/>
          <stop offset="100%" stopColor="#F5A623"/>
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="6" fill="url(#beacon-grad)"/>
      <path d="M16 7 L24 22 L8 22 Z" fill="#fff" fillOpacity="0.95"/>
      <circle cx="16" cy="18" r="2.4" fill="#12151A"/>
    </svg>
  );
}
