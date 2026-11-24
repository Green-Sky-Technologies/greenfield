import { can } from '@crunch/authz';
import { currentUser } from '@clerk/nextjs/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FigcraftEmbed } from '@/features/figcraft-spike/figcraft-embed';
import { db, requireActor } from '@/server/context';
import { figcraftSpikeEnabled } from '@/server/services/figcraft-spike';
import { getProject } from '@/server/services/projects';
import { NotFoundError } from '@/server/services/types';

/** Story 0.1 spike (dev-only, CRUNCH_FIGCRAFT_SPIKE=1): the project in the embedded FigCraft. */
export default async function FigcraftSpikePage({
  params,
  searchParams,
}: PageProps<'/w/[slug]/p/[projectId]/figcraft'>) {
  if (!figcraftSpikeEnabled()) notFound();
  const { slug, projectId } = await params;
  const actor = await requireActor(slug);
  const project = await getProject(db(), actor, projectId).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const user = await currentUser();
  const author = user?.fullName || user?.username || 'Someone';
  // `?webgl` forces FigCraft's WebGL2 backend (headless browsers have no usable WebGPU adapter).
  const webgl = (await searchParams).webgl !== undefined;

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-4 border-b px-4 py-2 text-sm">
        <Link href={`/w/${slug}`}>All projects</Link>
        <span className="font-medium">{project.name}</span>
        <span className="text-xs opacity-60">FigCraft embed spike (Story 0.1)</span>
      </header>
      <FigcraftEmbed
        projectId={project.id}
        author={author}
        canEdit={can(actor.role, 'design:edit') && !project.archivedAt}
        webgl={webgl}
      />
    </div>
  );
}
