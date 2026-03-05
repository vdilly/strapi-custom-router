import { isRealDeletion } from '../utils/draft-and-publish';
import { UID } from '../utils/constants';
import { checkHomepageDeletion, checkForChildren } from '../services/validation.service';
import type { LifecycleEvent, PageDocument } from '../utils/types';

/**
 * Orchestrates all before-delete logic for Page.
 *
 * Steps:
 *  0. Guard: skip if this is an internal D&P version cleanup (not a real user deletion)
 *  1. Load the page being deleted
 *  2. Check homepage deletion protection
 *  3. Check for children (block if page has sub-pages)
 */
export async function handleBeforeDelete(event: LifecycleEvent): Promise<void> {
  // Step 0 — Guard: skip internal D&P deletions
  if (!(await isRealDeletion(event))) return;

  // Step 1 — Load the page being deleted
  const id = (event.params.where as Record<string, unknown>)?.id;
  if (!id) return;

  const page = await strapi.db.query(UID.PAGE).findOne({
    where: { id },
  }) as PageDocument | null;

  if (!page) return;

  // Step 2 — Homepage deletion protection
  checkHomepageDeletion(page);

  // Step 3 — Children check
  await checkForChildren(page.documentId);
}
