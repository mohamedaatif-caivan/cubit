import type { ComponentChildren } from 'preact';

/** Small stroke icons, drawn on a 20-unit grid so they stay crisp at 16–20 px. */
function Icon({ children, size = 18 }: { children: ComponentChildren; size?: number }) {
  return (
    <svg
      class="icon"
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const CopyIcon = () => (
  <Icon>
    <rect x="7" y="7" width="9.5" height="9.5" rx="2" />
    <path d="M13 7V5a1.5 1.5 0 0 0-1.5-1.5h-6A1.5 1.5 0 0 0 4 5v6.5A1.5 1.5 0 0 0 5.5 13H7" />
  </Icon>
);
export const ChevronIcon = () => (
  <Icon size={16}>
    <path d="M6 8l4 4 4-4" />
  </Icon>
);
export const HelpIcon = () => (
  <Icon>
    <circle cx="10" cy="10" r="7" />
    <path d="M8.2 8a1.9 1.9 0 0 1 3.6.7c0 1.3-1.8 1.6-1.8 2.8" />
    <path d="M10 14h.01" />
  </Icon>
);
export const SettingsIcon = () => (
  <Icon>
    <circle cx="10" cy="10" r="2.5" />
    <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" />
  </Icon>
);
export const CompactIcon = () => (
  <Icon>
    <path d="M11.5 8.5L17 3M11.5 8.5V4.5M11.5 8.5h4M8.5 11.5L3 17M8.5 11.5v4M8.5 11.5h-4" />
  </Icon>
);
export const ExpandIcon = () => (
  <Icon>
    <path d="M12 3h5v5M17 3l-5.5 5.5M8 17H3v-5M3 17l5.5-5.5" />
  </Icon>
);
export const TapeIcon = () => (
  <Icon>
    <path d="M3.5 10a6.5 6.5 0 1 0 2-4.7" />
    <path d="M3.5 3.5v3h3" />
    <path d="M10 6.5V10l2.5 1.5" />
  </Icon>
);
export const StarIcon = () => (
  <Icon>
    <path d="M10 3l2.1 4.4 4.7.6-3.4 3.3.8 4.7L10 13.8 5.8 16l.8-4.7L3.2 8l4.7-.6z" />
  </Icon>
);
export const BackspaceIcon = () => (
  <Icon size={20}>
    <path d="M7 4.5h9.5A1.5 1.5 0 0 1 18 6v8a1.5 1.5 0 0 1-1.5 1.5H7L2 10z" />
    <path d="M9.5 7.5l5 5M14.5 7.5l-5 5" />
  </Icon>
);
export const TrashIcon = () => (
  <Icon>
    <path d="M3.5 5.5h13M8 5.5V4h4v1.5M5 5.5l.8 10.5h8.4L15 5.5M8.5 8.5v5M11.5 8.5v5" />
  </Icon>
);
export const ExportIcon = () => (
  <Icon>
    <path d="M10 3v9M6.5 8.5L10 12l3.5-3.5M4 14v2.5h12V14" />
  </Icon>
);
export const MoreIcon = () => (
  <Icon>
    <path d="M5 10h.01M10 10h.01M15 10h.01" stroke-width="2.4" />
  </Icon>
);
export const CloseIcon = () => (
  <Icon>
    <path d="M5 5l10 10M15 5L5 15" />
  </Icon>
);
export const BackIcon = () => (
  <Icon>
    <path d="M16 10H4M9 5l-5 5 5 5" />
  </Icon>
);
export const KeyboardIcon = () => (
  <Icon>
    <rect x="2.5" y="5" width="15" height="10" rx="1.5" />
    <path d="M5.5 8h.01M8.5 8h.01M11.5 8h.01M14.5 8h.01M6.5 12h7" />
  </Icon>
);
export const CheckIcon = () => (
  <Icon size={16}>
    <path d="M4 10.5l4 4 8-9" />
  </Icon>
);
