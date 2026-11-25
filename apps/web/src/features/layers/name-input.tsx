'use client';

/**
 * Renaming in place (a page or a layer): Enter or leaving the field keeps the name, Esc keeps the
 * old one. `onDone` gets the new name, or null for no change.
 */
import { useEffect, useRef } from 'react';

export function NameInput({
  label,
  value,
  onDone,
}: {
  label: string;
  value: string;
  onDone: (name: string | null) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(name?.trim() || null);
  };
  return (
    <input
      ref={ref}
      aria-label={label}
      defaultValue={value}
      onBlur={(e) => finish(e.currentTarget.value)}
      onKeyDown={(e) => {
        e.stopPropagation(); // text, not a list or shell shortcut (the shell's Esc leaves for the canvas)
        if (e.key === 'Enter') finish(e.currentTarget.value);
        else if (e.key === 'Escape') finish(null);
      }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      className="min-w-0 flex-1 border border-user bg-bg px-1 text-xs text-text outline-none"
    />
  );
}
