import { notFound } from 'next/navigation';
import { db, requireActor } from '@/server/context';
import {
  designSystemChanges,
  designSystemFiles,
  designSystemPermissions,
  getDesignSystem,
} from '@/server/services/design-systems';
import { NotFoundError } from '@/server/services/types';
import { ReviewForm } from './review-form';
import { UpdatePanel } from './update-panel';

export const metadata = { title: 'Review design system' };

/**
 * Story 10.3: keep or drop each colour group, scale, type style and component, then publish.
 * Story 10.6: new versions, what they change, and updating the files that use the system.
 */
export default async function ReviewPage({
  params,
}: PageProps<'/w/[slug]/settings/design-systems/[systemId]'>) {
  const { slug, systemId } = await params;
  const actor = await requireActor(slug);
  const detail = await getDesignSystem(db(), actor, systemId).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const [can, changes, files] = await Promise.all([
    designSystemPermissions(db(), actor),
    designSystemChanges(db(), actor, { systemId }),
    designSystemFiles(db(), actor, { systemId }),
  ]);
  const { system, version } = detail;
  const repo = system.sources.find((s) => s.kind === 'github');
  return (
    <>
      <ReviewForm
        key={version.id}
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
      <UpdatePanel
        systemId={system.id}
        name={system.name}
        repo={repo ? `github.com/${repo.owner}/${repo.repo}` : null}
        version={{ version: version.version, published: version.publishedAt !== null }}
        changes={{ from: changes.from?.version ?? null, list: changes.changes }}
        files={files.map((f) => ({ projectName: f.projectName, version: f.version }))}
        publishedVersion={changes.published}
        can={{ edit: can.edit, publish: can.publish }}
      />
    </>
  );
}
