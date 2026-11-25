import { notFound } from 'next/navigation';
import { Spike } from './spike';

export const metadata = { title: 'Canvas spike' };

/**
 * Story 5.0: throwaway. Off in production builds, unless CANVAS_SPIKE=1 (the measurements run
 * against `next start`, because React's dev build is slower than what ships).
 */
export default function Page() {
  if (process.env.NODE_ENV === 'production' && process.env.CANVAS_SPIKE !== '1') notFound();
  return <Spike />;
}
