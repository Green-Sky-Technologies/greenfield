import Link from 'next/link';
import { Button } from './ui/button';

export function Navbar() {
  return (
    <nav className="flex items-center gap-8 border-b px-6 py-4">
      <Link href="/">Voirdire</Link>
      <Link href="/pricing">Pricing</Link>
      <Button>Get started</Button>
    </nav>
  );
}
