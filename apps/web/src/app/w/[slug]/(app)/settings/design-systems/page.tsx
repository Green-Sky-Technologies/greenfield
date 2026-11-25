import Link from 'next/link';
import { db, requireActor } from '@/server/context';
import { designSystemPermissions, listDesignSystems } from '@/server/services/design-systems';
import { PolicyForm, SystemRowActions } from './system-list';

export const metadata = { title: 'Design systems' };

function age(d: Date): string {
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  return `${Math.floor(days / 7)} weeks ago`;
}

/** Story 10.4: the workspace's design systems, which is published and the default, and who manages them. */
export default async function DesignSystemsPage({
  params,
}: PageProps<'/w/[slug]/settings/design-systems'>) {
  const actor = await requireActor((await params).slug);
  const [systems, can] = await Promise.all([
    listDesignSystems(db(), actor),
    designSystemPermissions(db(), actor),
  ]);
  const base = `/w/${actor.workspace.slug}/settings/design-systems`;

  return (
    <main className="w-full">
      <div className="mb-6 flex items-center justify-between gap-4 border-b border-border pb-5">
        <h1 className="font-wordmark text-4xl">Design systems</h1>
        {can.edit && (
          <Link href={`${base}/new`} className="btn-primary">
            + New design system
          </Link>
        )}
      </div>

      {systems.length === 0 ? (
        <p className="card p-6 text-sm text-muted">
          No design systems yet. A design system is a FigCraft library file (variables, styles and
          components) and a short guide Claude reads before every design.
        </p>
      ) : (
        <div className="overflow-x-auto border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="type-label border-b border-border text-left text-muted">
                <th className="px-4 py-3 font-normal">Name</th>
                <th className="px-4 py-3 font-normal">Sources</th>
                <th className="px-4 py-3 font-normal">Version</th>
                <th className="px-4 py-3 font-normal">Status</th>
                <th className="px-4 py-3 font-normal">Used in</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {systems.map((s) => (
                <tr key={s.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-6 shrink-0 border border-border" aria-hidden>
                        {s.swatches.map((hex) => (
                          <span key={hex} className="w-2" style={{ background: hex }} />
                        ))}
                      </span>
                      <span className="font-medium">{s.name}</span>
                      {s.isDefault && (
                        <span className="bg-accent px-1.5 font-mono text-xs text-accent-ink">
                          Default
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted">Upload</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">
                    v{s.latest.version} ·{' '}
                    {s.latest.publishedAt ? age(s.latest.publishedAt) : 'draft'}
                  </td>
                  <td className="px-4 py-3">
                    <SystemRowActions
                      system={{
                        id: s.id,
                        name: s.name,
                        published: s.published !== null,
                        isDefault: s.isDefault,
                      }}
                      can={can}
                    />
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {s.usedIn ? `${s.usedIn} file${s.usedIn === 1 ? '' : 's'}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`${base}/${s.id}`} className="btn-ghost">
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PolicyForm managers={can.policy.designSystemManagers} canChange={can.managePolicy} />
    </main>
  );
}
