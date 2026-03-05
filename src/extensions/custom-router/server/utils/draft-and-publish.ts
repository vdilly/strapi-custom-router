import type { LifecycleEvent } from './types';

/**
 * Determines whether a beforeCreate/beforeUpdate event carries routing-relevant data.
 *
 * Internal D&P operations (publish, unpublish, discardDraft) trigger lifecycle hooks
 * but their `event.params.data` contains only internal metadata — no slug, no parent.
 * We skip routing logic for these events because fullpath is already set from
 * a previous real save.
 */
export function isRoutingRelevantSave(event: LifecycleEvent): boolean {
  const data = event.params.data;
  if (!data) return false;

  // If the save contains a slug or a parent relation change, it's a real user edit
  return data.slug !== undefined || data.parent !== undefined;
}

/**
 * Determines whether a beforeDelete event is a real user-initiated deletion
 * (as opposed to internal D&P version cleanup).
 *
 * When Strapi calls publish(), unpublish(), or discardDraft(), it internally
 * deletes old draft/published versions. These deletions target specific DB rows
 * by `id`. A real user deletion targets a `documentId`.
 *
 * We check whether other versions of the same document still exist after this
 * delete. If they do, it's an internal cleanup — skip our checks.
 */
export async function isRealDeletion(event: LifecycleEvent): Promise<boolean> {
  const where = event.params.where;
  if (!where) return false;

  // Internal D&P deletions target a specific row `id`.
  // Real user deletions go through Document Service which also uses `id` internally,
  // but we can check if the document will still have remaining versions.
  const id = (where as Record<string, unknown>).id;
  if (!id) return false;

  // Load the row being deleted to get its documentId
  const row = await strapi.db.query(event.model.uid).findOne({
    where: { id },
    select: ['id', 'documentId'],
  });

  if (!row) return false;

  // Count all versions (draft + published) for this documentId
  const allVersions = await strapi.db.query(event.model.uid).count({
    where: { documentId: row.documentId },
  });

  // If only 1 version remains (the one being deleted), it's a real deletion
  return allVersions <= 1;
}
