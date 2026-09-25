import React from 'react';

const commonProps = {
  width: 14,
  height: 14,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export function IconSave({ size = 14, className = '' }) {
  return (
    <svg {...commonProps} width={size} height={size} className={className}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}

export function IconFolder({ size = 14, className = '' }) {
  return (
    <svg {...commonProps} width={size} height={size} className={className}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function IconPlus({ size = 14, className = '' }) {
  return (
    <svg {...commonProps} width={size} height={size} className={className}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export function IconZip({ size = 14, className = '' }) {
  return (
    <svg {...commonProps} width={size} height={size} className={className}>
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <polyline points="3.29 7 12 12 20.71 7" />
      <line x1="12" y1="22" x2="12" y2="12" />
    </svg>
  );
}

export function IconDownload({ size = 14, className = '' }) {
  return (
    <svg {...commonProps} width={size} height={size} className={className}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

export function IconUndo({ size = 14, className = '' }) {
  return (
    <svg {...commonProps} width={size} height={size} className={className}>
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
    </svg>
  );
}

export function IconRedo({ size = 14, className = '' }) {
  return (
    <svg {...commonProps} width={size} height={size} className={className}>
      <path d="M21 7v6h-6" />
      <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" />
    </svg>
  );
}

export function IconShuffle({ size = 14, className = '' }) {
  return (
    <svg {...commonProps} width={size} height={size} className={className}>
      <polyline points="16 3 21 3 21 8" />
      <line x1="4" y1="20" x2="21" y2="3" />
      <polyline points="21 16 21 21 16 21" />
      <line x1="15" y1="15" x2="21" y2="21" />
      <line x1="4" y1="4" x2="9" y2="9" />
    </svg>
  );
}

export function IconMusic({ size = 14, className = '' }) {
  return (
    <svg {...commonProps} width={size} height={size} className={className}>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

export function IconDice({ size = 14, className = '' }) {
  return (
    <svg {...commonProps} width={size} height={size} className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" />
      <circle cx="16" cy="8" r="1.2" fill="currentColor" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
      <circle cx="8" cy="16" r="1.2" fill="currentColor" />
      <circle cx="16" cy="16" r="1.2" fill="currentColor" />
    </svg>
  );
}

export function IconTape({ size = 14, className = '' }) {
  return (
    <svg {...commonProps} width={size} height={size} className={className}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <circle cx="8" cy="10" r="2" />
      <circle cx="16" cy="10" r="2" />
      <path d="m8 12 8 0" />
      <path d="m6 16 12 0" />
    </svg>
  );
}

export function IconPlay({ size = 14, className = '' }) {
  return (
    <svg {...commonProps} width={size} height={size} className={className}>
      <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" />
    </svg>
  );
}

export function IconStop({ size = 14, className = '' }) {
  return (
    <svg {...commonProps} width={size} height={size} className={className}>
      <rect x="4" y="4" width="16" height="16" rx="1" fill="currentColor" />
    </svg>
  );
}

export function IconList({ size = 14, className = '' }) {
  return (
    <svg {...commonProps} width={size} height={size} className={className}>
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

export function IconVideo({ size = 14, className = '' }) {
  return (
    <svg {...commonProps} width={size} height={size} className={className}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" />
    </svg>
  );
}

export function IconTrash({ size = 14, className = '' }) {
  return (
    <svg {...commonProps} width={size} height={size} className={className}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

export function IconCross({ size = 14, className = '' }) {
  return (
    <svg {...commonProps} width={size} height={size} className={className}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function IconBolt({ size = 14, className = '' }) {
  return (
    <svg {...commonProps} width={size} height={size} className={className}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

export function IconReverse({ size = 14, className = '' }) {
  return (
    <svg {...commonProps} width={size} height={size} className={className}>
      <polyline points="9 14 4 9 9 4" />
      <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
    </svg>
  );
}

export function IconRecord({ size = 14, className = '' }) {
  return (
    <svg {...commonProps} width={size} height={size} className={className}>
      <circle cx="12" cy="12" r="7" fill="currentColor" />
    </svg>
  );
}
