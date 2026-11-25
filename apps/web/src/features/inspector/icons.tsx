/** The inspector's 12 px line icons (square caps, the brand's hairline weight). */
import type { ReactNode } from 'react';

const Icon = ({ children }: { children: ReactNode }) => (
  <svg
    aria-hidden
    width="12"
    height="12"
    viewBox="0 0 12 12"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.25"
    strokeLinecap="square"
  >
    {children}
  </svg>
);

export const Plus = () => (
  <Icon>
    <path d="M6 1.5v9M1.5 6h9" />
  </Icon>
);
export const Minus = () => (
  <Icon>
    <path d="M1.5 6h9" />
  </Icon>
);
export const Eye = () => (
  <Icon>
    <path d="M0.8 6C2.2 3.4 4 2.2 6 2.2s3.8 1.2 5.2 3.8C9.8 8.6 8 9.8 6 9.8S2.2 8.6 0.8 6Z" />
    <circle cx="6" cy="6" r="1.6" />
  </Icon>
);
export const EyeOff = () => (
  <Icon>
    <path d="M0.8 6C2.2 3.4 4 2.2 6 2.2s3.8 1.2 5.2 3.8C9.8 8.6 8 9.8 6 9.8S2.2 8.6 0.8 6Z" />
    <path d="M1.5 10.5l9-9" />
  </Icon>
);

const lines = (rows: [number, number][]) => (
  <Icon>
    <path d={rows.map(([x0, x1], i) => `M${x0} ${2.5 + i * 3.5}H${x1}`).join('')} />
  </Icon>
);
export const AlignLeft = () =>
  lines([
    [1, 11],
    [1, 7],
    [1, 9],
  ]);
export const AlignCenter = () =>
  lines([
    [1, 11],
    [3, 9],
    [2, 10],
  ]);
export const AlignRight = () =>
  lines([
    [1, 11],
    [5, 11],
    [3, 11],
  ]);
export const AlignJustify = () =>
  lines([
    [1, 11],
    [1, 11],
    [1, 11],
  ]);
