/**
 * The in-app lockup (docs/brand/README.md): the small pixel mark, then "Greenfield" in Cormorant
 * Garamond 400. 16px in bars (`compact`, mark only, and the default beside ~19px text); 32px
 * would sit beside larger text. Sizes are whole multiples of the 16-unit grid. The `-on-light`
 * file shows in the light theme (globals.css).
 */
export function Logo({ compact = false, size = 16 }: { compact?: boolean; size?: 16 | 32 }) {
  const mark = (src: string, cls: string) => (
    // eslint-disable-next-line @next/next/no-img-element -- pixel art must not be resized or re-encoded
    <img src={src} alt="" width={size} height={size} className={`pixel ${cls}`} />
  );
  return (
    <span className="inline-flex items-center gap-2">
      {mark('/greenfield-mark-small.svg', 'mark-on-dark')}
      {mark('/greenfield-mark-small-on-light.svg', 'mark-on-light')}
      {!compact && (
        <span className="font-wordmark leading-none" style={{ fontSize: size === 32 ? 38 : 19 }}>
          Greenfield
        </span>
      )}
    </span>
  );
}
