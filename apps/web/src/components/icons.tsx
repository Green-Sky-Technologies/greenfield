/** 16 px line icons for the shell (square caps, the brand's hairline weight). */
import type { ReactNode } from 'react';

const Icon = ({ children, size = 16 }: { children: ReactNode; size?: number }) => (
  <svg
    aria-hidden
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.25"
    strokeLinecap="square"
  >
    {children}
  </svg>
);

export const Check = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M2.5 8.5l3.5 3.5 7.5-8" strokeWidth="1.5" />
  </Icon>
);

export const Mic = () => (
  <Icon>
    <rect x="6" y="1.5" width="4" height="8" />
    <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5" />
  </Icon>
);

export const ImageIcon = () => (
  <Icon>
    <rect x="1.5" y="2.5" width="13" height="11" />
    <path d="M1.5 11l4-4 3.5 3.5 2-2 3.5 3.5" />
    <circle cx="11" cy="5.5" r="1" />
  </Icon>
);

export const Paperclip = () => (
  <Icon>
    <path d="M10.5 4.5v6.5a2.5 2.5 0 0 1-5 0V3.5a1.75 1.75 0 0 1 3.5 0V10.5a1 1 0 0 1-2 0V5" />
  </Icon>
);

/** An input the design shows that its story hasn't built yet: visible, and says so. */
export function NotYet({
  label,
  story,
  children,
}: {
  label: string;
  story: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled
      aria-label={`${label} (not available yet)`}
      title={`${label}: not available yet (${story})`}
      className="flex size-7 items-center justify-center text-muted disabled:opacity-60"
    >
      {children}
    </button>
  );
}
