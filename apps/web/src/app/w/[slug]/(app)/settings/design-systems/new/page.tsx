import { can } from '@greenfield/authz';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireActor } from '@/server/context';
import { UploadForm } from './upload-form';

export const metadata = { title: 'New design system' };

/** The manual path to a design system: upload a library file, then review it (10.3). */
export default async function NewDesignSystemPage({
  params,
}: PageProps<'/w/[slug]/settings/design-systems/new'>) {
  const actor = await requireActor((await params).slug);
  const base = `/w/${actor.workspace.slug}/settings/design-systems`;
  if (!can(actor.role, 'design_system:edit')) redirect(base);
  return (
    <main className="w-full max-w-2xl">
      <div className="mb-6 flex items-center justify-between gap-4 border-b border-border pb-5">
        <h1 className="font-wordmark text-4xl">New design system</h1>
        <Link href={base} className="btn-link text-sm text-muted">
          Cancel
        </Link>
      </div>
      <UploadForm base={base} />
    </main>
  );
}
