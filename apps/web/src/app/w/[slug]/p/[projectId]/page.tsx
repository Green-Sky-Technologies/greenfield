import { can } from '@greenfield/authz';
import { currentUser } from '@clerk/nextjs/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AgentWorkspace } from '@/features/agent/agent-workspace';
import { db, requireActor } from '@/server/context';
import { getProject } from '@/server/services/projects';
import { NotFoundError } from '@/server/services/types';

/**
 * A project: its design file in the embedded editor (FigCraft, served from /editor/). The
 * editor shell around it (agent pane, comments, top bar) is Epic 5.
 */
export default async function ProjectPage({
  params,
  searchParams,
}: PageProps<'/w/[slug]/p/[projectId]'>) {
  const { slug, projectId } = await params;
  const actor = await requireActor(slug);
  const project = await getProject(db(), actor, projectId).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const user = await currentUser();
  const author = user?.fullName || user?.username || 'Someone';
  // `?webgl` forces the editor's WebGL2 backend (headless browsers have no usable WebGPU adapter).
  const webgl = (await searchParams).webgl !== undefined;
  const archived = !!project.archivedAt;

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-4 border-b px-4 py-2 text-sm">
        <Link href={`/w/${slug}`}>All projects</Link>
        <span className="font-medium">{project.name}</span>
        {archived && <span className="text-xs opacity-60">Archived (read-only)</span>}
      </header>
      <AgentWorkspace
        projectId={project.id}
        author={author}
        canEdit={can(actor.role, 'design:edit') && !archived}
        canRunAgent={can(actor.role, 'agent:run') && !archived}
        webgl={webgl}
      />
    </div>
  );
}

export async function generateMetadata({ params }: PageProps<'/w/[slug]/p/[projectId]'>) {
  const { slug, projectId } = await params;
  const actor = await requireActor(slug);
  const project = await getProject(db(), actor, projectId).catch(() => null);
  return { title: project?.name ?? 'Project' };
}
