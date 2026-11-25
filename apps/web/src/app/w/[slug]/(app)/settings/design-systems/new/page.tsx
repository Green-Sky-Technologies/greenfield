import { can } from '@greenfield/authz';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireActor } from '@/server/context';
import { BuildForm } from './build-form';
import { UploadForm } from './upload-form';

export const metadata = { title: 'New design system' };

/**
 * A new design system: build one from a repository or uploads (10.2), or upload a library file
 * made by hand. Either way it opens in the review (10.3).
 */
export default async function NewDesignSystemPage({
  params,
}: PageProps<'/w/[slug]/settings/design-systems/new'>) {
  const actor = await requireActor((await params).slug);
  const base = `/w/${actor.workspace.slug}/settings/design-systems`;
  if (!can(actor.role, 'design_system:edit')) redirect(base);
  return (
    <main className="w-full">
      <div className="mb-6 flex items-center justify-between gap-4 border-b border-border pb-5">
        <h1 className="font-wordmark text-4xl">New design system</h1>
        <Link href={base} className="btn-link text-sm text-muted">
          Cancel
        </Link>
      </div>
      <BuildForm base={base} />
      <details className="mt-12 max-w-2xl border-t border-border pt-6">
        <summary className="cursor-pointer text-sm text-muted">Or upload a library file</summary>
        <div className="mt-5">
          <UploadForm base={base} />
        </div>
      </details>
    </main>
  );
}
