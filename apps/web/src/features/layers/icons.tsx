/** The layers list's line icons (the 5.8 design: 16-unit grid, 1.5 stroke, `currentColor`). */
import type { ReactNode } from 'react';

function Icon({ size = 14, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

const FRAME = <path d="M5 1v14M11 1v14M1 5h14M1 11h14" />;

const TYPE_ICONS: Record<string, ReactNode> = {
  FRAME,
  SECTION: <path d="M2 2h12v12H2zM2 5h5" />,
  GROUP: <path d="M2 2h3M11 2h3v3M14 11v3h-3M5 14H2v-3M2 5V2M8 2h0M14 8h0M8 14h0M2 8h0" />,
  TEXT: <path d="M3 3h10M8 3v10" />,
  RECTANGLE: <rect x="2.5" y="2.5" width="11" height="11" />,
  ELLIPSE: <circle cx="8" cy="8" r="5.5" />,
  LINE: <path d="M2 14L14 2" />,
  POLYGON: <path d="M8 2l6 11H2z" />,
  STAR: <path d="M8 1.5l2 4.3 4.5.5-3.4 3 1 4.6L8 11.6 3.9 13.9l1-4.6-3.4-3 4.5-.5z" />,
  VECTOR: <path d="M2 13C5 3 11 13 14 3" />,
  BOOLEAN_OPERATION: <path d="M2 2h8v8H2zM6 6h8v8H6z" />,
  // Component marks: a main component, a set of variants, an instance.
  COMPONENT: (
    <path d="M8 1.5l3 3-3 3-3-3zM8 8.5l3 3-3 3-3-3zM1.5 8l3-3 3 3-3 3zM8.5 8l3-3 3 3-3 3z" />
  ),
  COMPONENT_SET: (
    <path d="M8 1.5l3 3-3 3-3-3zM8 8.5l3 3-3 3-3-3zM1.5 8l3-3 3 3-3 3zM8.5 8l3-3 3 3-3 3zM1 1h14v14H1z" />
  ),
  INSTANCE: <path d="M8 1.5L14.5 8 8 14.5 1.5 8z" />,
};

export const TypeIcon = ({ type }: { type: string }) => (
  <Icon>{TYPE_ICONS[type] ?? <rect x="3" y="3" width="10" height="10" />}</Icon>
);
export const PageIcon = () => <Icon>{FRAME}</Icon>;

export const PlusIcon = () => (
  <Icon>
    <path d="M8 3v10M3 8h10" />
  </Icon>
);
export const CloseIcon = () => (
  <Icon size={12}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Icon>
);
export const ChevronIcon = ({ open }: { open: boolean }) => (
  <Icon size={10}>
    <path d={open ? 'M3 6l5 5 5-5' : 'M6 3l5 5-5 5'} />
  </Icon>
);
export const LockIcon = ({ locked }: { locked: boolean }) => (
  <Icon size={12}>
    <rect x="3" y="7" width="10" height="7" />
    <path d={locked ? 'M5 7V5a3 3 0 016 0v2' : 'M5 7V5a3 3 0 016 0'} />
  </Icon>
);
export const EyeIcon = ({ visible }: { visible: boolean }) => (
  <Icon size={12}>
    <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
    {visible ? <circle cx="8" cy="8" r="2" /> : <path d="M2 14L14 2" />}
  </Icon>
);
