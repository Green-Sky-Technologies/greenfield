import { can } from '@greenfield/authz';
import { currentUser } from '@clerk/nextjs/server';
import { notFound } from 'next/navigation';
import { ProjectShell } from '@/features/shell/project-shell';
import { db, requireActor } from '@/server/context';
import { listMentionableMembers } from '@/server/services/comments';
import { documentName } from '@/server/services/design-files';
import { getProject } from '@/server/services/projects';
import { NotFoundError } from '@/server/services/types';

/**
 * A project: its design file in the embedded editor (FigCraft, served from /editor/), inside the
 * editor shell (Epic 5: top bar and focus handling in features/shell).
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

  const people = await listMentionableMembers(db(), actor);

  return (
    <ProjectShell
      slug={slug}
      project={{ id: project.id, name: project.name, archived }}
      fileName={documentName(project.name)}
      people={people.map((p) => ({
        userId: p.userId,
        name: p.name ?? p.email,
        imageUrl: p.imageUrl,
      }))}
      meId={actor.userId}
      canShare={can(actor.role, 'share:manage')}
      canComment={can(actor.role, 'design:comment') && !archived}
      author={author}
      canEdit={can(actor.role, 'design:edit') && !archived}
      webgl={webgl}
    />
  );
}

export async function generateMetadata({ params }: PageProps<'/w/[slug]/p/[projectId]'>) {
  const { slug, projectId } = await params;
  const actor = await requireActor(slug);
  const project = await getProject(db(), actor, projectId).catch(() => null);
  return { title: project?.name ?? 'Project' };
}
