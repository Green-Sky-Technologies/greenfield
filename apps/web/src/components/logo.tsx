import Image from 'next/image';

export function Logo({ compact = false, size = 16 }: { compact?: boolean; size?: 16 | 32 }) {
  const mark = (src: string, cls: string) => (
    <Image src={src} alt="" width={size} height={size} className={`pixel ${cls}`} />
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
