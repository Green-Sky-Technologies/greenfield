import { cookies } from 'next/headers';
import { parseThemePreference, THEME_COOKIE } from '@/features/theme/theme';
import { ThemeSetting } from '@/features/theme/theme-setting';
import { requireActor } from '@/server/context';

export const metadata = { title: 'Appearance' };

/** Per browser, not per workspace: any member can set it. */
export default async function AppearancePage({
  params,
}: PageProps<'/w/[slug]/settings/appearance'>) {
  await requireActor((await params).slug);
  const initial = parseThemePreference((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <main className="w-full max-w-5xl">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Appearance</h1>
      <p className="mb-6 text-sm text-muted">Saved in this browser.</p>
      <ThemeSetting initial={initial} />
    </main>
  );
}
