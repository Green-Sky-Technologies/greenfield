import 'server-only';
import { clerkClient, type User } from '@clerk/nextjs/server';
import { listMentionableMembers } from './services/comments';
import type { Actor } from './services/types';
import { upsertUser } from './services/workspaces';
import { db } from './context';

/** Clerk's generated avatar is not a picture of anyone: those people get their initial instead. */
const picture = (u: { hasImage: boolean; imageUrl: string }) => (u.hasImage ? u.imageUrl : null);

/**
 * The workspace's members with their names and pictures, for the people row and @mentions. The
 * `users` mirror is filled by Clerk's webhook, which a local or preview deployment may not get:
 * the signed-in user is mirrored here, and members still unknown are read from Clerk once.
 */
export async function workspaceMembers(actor: Actor, me: User | null) {
  if (me)
    await upsertUser(db(), {
      id: me.id,
      email: me.primaryEmailAddress?.emailAddress ?? null,
      name: me.fullName,
      imageUrl: picture(me),
    });
  const people = await listMentionableMembers(db(), actor);
  const unknown = new Set(people.filter((p) => !p.name && !p.email).map((p) => p.userId));
  if (!unknown.size) return people;

  const clerk = await clerkClient();
  const { data } = await clerk.organizations.getOrganizationMembershipList({
    organizationId: actor.workspace.clerkOrgId,
    limit: 500,
  });
  for (const m of data) {
    const u = m.publicUserData;
    if (!u || !unknown.has(u.userId)) continue;
    await upsertUser(db(), {
      id: u.userId,
      email: u.identifier || null,
      name: [u.firstName, u.lastName].filter(Boolean).join(' ') || null,
      imageUrl: picture(u),
    });
  }
  return listMentionableMembers(db(), actor);
}
