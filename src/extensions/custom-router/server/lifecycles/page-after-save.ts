import { createRedirect, updateRedirectTargets, removeConflictingRedirectSources } from '../services/redirect.service';
import { cascadeFullpathChanges, cascadeBreadcrumbs } from '../services/cascade.service';
import type { LifecycleEvent } from '../utils/types';

/**
 * Orchestrates all after-save logic for Page (afterCreate + afterUpdate).
 *
 * Steps:
 *  0. Guard: skip if event.state has no routing data (before-hook skipped → D&P internal operation)
 *  1. Determine what changed: fullpath? title/type only?
 *  2. If fullpath changed: create redirect, update redirect targets, cascade descendants
 *  3. If only title/type changed: cascade breadcrumbs only
 */
export async function handleAfterCreateOrUpdate(event: LifecycleEvent): Promise<void> {
  // Step 0 — Guard: the before-hook sets oldFullpath on updates that carry routing data.
  // On creates, there's nothing to cascade (no old fullpath, no descendants).
  const oldFullpath = event.state.oldFullpath as string | undefined;
  const oldTitle = event.state.oldTitle as string | undefined;
  const oldType = event.state.oldType as string | undefined;

  // If no state was set, the before-hook skipped (D&P internal operation) → nothing to do
  if (oldFullpath === undefined && oldTitle === undefined) return;

  const result = event.result as Record<string, unknown> | undefined;
  if (!result) return;

  const newFullpath = result.fullpath as string;
  const newTitle = result.title as string;
  const newType = result.type as string;

  const fullpathChanged = oldFullpath !== undefined && oldFullpath !== newFullpath;
  const titleOrTypeChanged = (oldTitle !== undefined && oldTitle !== newTitle)
    || (oldType !== undefined && oldType !== newType);

  // Step 2 — Fullpath changed: redirects + full cascade
  if (fullpathChanged) {
    // Create redirect from old path to new path
    await createRedirect(oldFullpath, newFullpath);

    // Update all existing redirects that pointed to the old path → point to new path
    await updateRedirectTargets(oldFullpath, newFullpath);

    // Remove any redirect whose source is the new path (avoids self-redirect)
    await removeConflictingRedirectSources(newFullpath);

    // Cascade fullpath + breadcrumb updates to all descendants
    await cascadeFullpathChanges(oldFullpath, newFullpath);
    return;
  }

  // Step 3 — Only title/type changed: cascade breadcrumbs to descendants
  if (titleOrTypeChanged && newFullpath) {
    await cascadeBreadcrumbs(newFullpath);
  }
}
