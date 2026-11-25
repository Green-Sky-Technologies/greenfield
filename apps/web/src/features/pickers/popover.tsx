'use client';

/**
 * A picker's frame: fixed at its anchor and moved to stay inside the window, closed by Esc or a
 * press outside it. It takes focus when it opens and gives it back when it closes.
 */
import { useEffectEvent, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Anchor } from './open';

const MARGIN = 8;

/** Where a box of `size` at `anchor` goes to fit inside `window`, keeping a margin. */
export function placeInWindow(
  anchor: Anchor,
  size: { width: number; height: number },
  window: { width: number; height: number },
): Anchor {
  const fit = (at: number, len: number, room: number) =>
    Math.max(MARGIN, Math.min(at, room - len - MARGIN));
  return {
    x: fit(anchor.x, size.width, window.width),
    y: fit(anchor.y, size.height, window.height),
  };
}

export function Popover({
  anchor,
  label,
  testId,
  width,
  onClose,
  children,
}: {
  anchor: Anchor;
  label: string;
  testId: string;
  width: number;
  onClose(): void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(anchor);
  const close = useEffectEvent(() => onClose());

  useLayoutEffect(() => {
    const el = ref.current!;
    const r = el.getBoundingClientRect();
    setAt(
      placeInWindow(
        anchor,
        { width: r.width, height: r.height },
        { width: innerWidth, height: innerHeight },
      ),
    );
  }, [anchor]);

  useLayoutEffect(() => {
    const el = ref.current!;
    const before = document.activeElement as HTMLElement | null;
    (el.querySelector<HTMLElement>('[data-autofocus]') ?? el.querySelector('input'))?.focus();
    const onDown = (e: PointerEvent) => {
      if (!el.contains(e.target as Node)) close();
    };
    // The canvas is an iframe: a press there blurs this window instead of reaching `onDown`.
    const onBlur = () => setTimeout(() => document.hasFocus() || close(), 0);
    // Esc wherever focus is in the shell (Safari doesn't focus a clicked button); the shell's own
    // Esc (back to the canvas) waits for the next press.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onBlur);
      // Back to the control that opened it, unless focus has moved on (a press on the canvas).
      const now = document.activeElement;
      if (before?.isConnected && (!now || now === document.body || el.contains(now)))
        before.focus();
    };
  }, []);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      data-testid={testId}
      className="fixed z-40 flex flex-col gap-2.5 bg-surface-2 p-3 text-[13px] text-text shadow-[0_12px_32px_rgb(0_0_0/0.45),inset_0_0_0_1px_var(--border)]"
      style={{ left: at.x, top: at.y, width }}
    >
      {children}
    </div>
  );
}

/** The search field at the top of a picker. */
export function SearchField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange(v: string): void;
}) {
  return (
    <label className="flex h-7 items-center gap-1.5 bg-bg px-2">
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden
        className="shrink-0 text-muted"
      >
        <circle cx="7" cy="7" r="4.5" />
        <path d="M10.5 10.5L14 14" />
      </svg>
      <input
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border-0 bg-transparent outline-none placeholder:text-muted"
      />
    </label>
  );
}
