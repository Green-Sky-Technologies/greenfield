import { notFound } from 'next/navigation';
import { db, requireActor } from '@/server/context';
import { designSystemPermissions, getDesignSystem } from '@/server/services/design-systems';
import { NotFoundError } from '@/server/services/types';
import { ReviewForm } from './review-form';

export const metadata = { title: 'Review design system' };

/** Story 10.3: keep or drop each colour group, type style and component, then publish. */
export default async function ReviewPage({
  params,
}: PageProps<'/w/[slug]/settings/design-systems/[systemId]'>) {
  const { slug, systemId } = await params;
  const actor = await requireActor(slug);
  const [detail, can] = await Promise.all([
    getDesignSystem(db(), actor, systemId).catch((e: unknown) => {
      if (e instanceof NotFoundError) notFound();
      throw e;
    }),
    designSystemPermissions(db(), actor),
  ]);
  const { system, version } = detail;
  return (
    <ReviewForm
      base={`/w/${actor.workspace.slug}/settings/design-systems`}
      system={{
        id: system.id,
        name: system.name,
        isDefault: system.isDefault,
        published: system.publishedVersionId !== null,
      }}
      version={{
        version: version.version,
        published: version.publishedAt !== null,
        items: version.items,
        dropped: version.dropped,
        guide: version.guide,
      }}
      can={{ edit: can.edit, publish: can.publish, setDefault: can.setDefault }}
    />
  );
}
