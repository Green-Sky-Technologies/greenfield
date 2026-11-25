'use server';

import { revalidatePath } from 'next/cache';
import { db, requireActor } from '../context';
import { defaultDesignFileStorage } from '../services/design-files';
import {
  deleteDesignSystem,
  publishDesignSystem,
  saveDesignSystemReview,
  setDefaultDesignSystem,
  setDesignSystemPolicy,
  unpublishDesignSystem,
} from '../services/design-systems';
import type { Actor } from '../services/types';
import { run, type ActionResult } from './result';

async function act(fn: (actor: Actor) => Promise<unknown>): Promise<ActionResult> {
  const actor = await requireActor();
  const res = await run(async () => {
    await fn(actor);
    return undefined;
  });
  revalidatePath(`/w/${actor.workspace.slug}/settings/design-systems`, 'layout');
  return res;
}

export async function saveReviewAction(
  systemId: string,
  review: { dropped: string[]; guide: string },
): Promise<ActionResult> {
  return act((actor) => saveDesignSystemReview(db(), actor, { systemId, ...review }));
}

/** Save the review, then publish it. */
export async function publishAction(
  systemId: string,
  review?: { dropped: string[]; guide: string },
): Promise<ActionResult> {
  return act(async (actor) => {
    if (review) await saveDesignSystemReview(db(), actor, { systemId, ...review });
    await publishDesignSystem(db(), actor, defaultDesignFileStorage(), { systemId });
  });
}

export async function unpublishAction(systemId: string): Promise<ActionResult> {
  return act((actor) => unpublishDesignSystem(db(), actor, { systemId }));
}

export async function setDefaultAction(systemId: string | null): Promise<ActionResult> {
  return act((actor) => setDefaultDesignSystem(db(), actor, { systemId }));
}

export async function deleteDesignSystemAction(systemId: string): Promise<ActionResult> {
  return act((actor) => deleteDesignSystem(db(), actor, defaultDesignFileStorage(), { systemId }));
}

export async function setPolicyAction(managers: string): Promise<ActionResult> {
  return act((actor) => setDesignSystemPolicy(db(), actor, { managers }));
}
