import { isRoutingRelevantSave } from '../utils/draft-and-publish';
import { UID } from '../utils/constants';
import { validateSlug, detectCycle, checkHomepageMutation } from '../services/validation.service';
import { computeFullpath, computeBreadcrumb, checkFullpathUniqueness } from '../services/fullpath.service';
import type { LifecycleEvent, PageDocument } from '../utils/types';

/**
 * Orchestrates all before-save logic for Page (beforeCreate + beforeUpdate).
 *
 * Steps:
 *  0. Guard: skip if not a routing-relevant save (Draft&Publish internal operation)
 *  1. Validate slug
 *  2. Detect cycles (update only)
 *  3. Compute fullpath
 *  4. Check fullpath uniqueness
 *  5. Protect homepage mutations (update only)
 *  6. Compute breadcrumb
 *  7. Write fullpath + breadcrumb into event.params.data
 *  8. Store oldFullpath in event.state for after-save cascade
 */
export async function handleBeforeCreateOrUpdate(event: LifecycleEvent): Promise<void> {
  // Step 0 — Guard: skip D&P internal operations
  if (!isRoutingRelevantSave(event)) return;

  const data = event.params.data!;
  const isUpdate = event.action === 'beforeUpdate';

  // For updates, load the existing page to compare
  let existingPage: PageDocument | null = null;
  if (isUpdate && event.params.where) {
    const id = (event.params.where as Record<string, unknown>).id;
    if (id) {
      existingPage = await strapi.db.query(UID.PAGE).findOne({
        where: { id },
        populate: { parent: true },
      }) as PageDocument | null;
    }
  }

  // Resolve effective slug and parent for this save
  const slug = (data.slug as string) ?? existingPage?.slug;
  const title = (data.title as string) ?? existingPage?.title ?? '';
  const type = (data.type as string) ?? existingPage?.type ?? 'page';

  // Resolve parentDocumentId: data.parent can be a documentId string, an object, or null
  let parentDocumentId: string | null = resolveParentDocumentId(data.parent, existingPage);

  // Step 1 — Validate slug
  validateSlug(slug);

  // Step 2 — Cycle detection (update only)
  if (isUpdate && existingPage && data.parent !== undefined) {
    await detectCycle(existingPage.documentId, parentDocumentId);
  }

  // Step 3 — Compute fullpath
  const newFullpath = await computeFullpath(slug, parentDocumentId);

  // Step 4 — Check fullpath uniqueness
  const excludeDocumentId = isUpdate ? existingPage?.documentId : undefined;
  await checkFullpathUniqueness(newFullpath, excludeDocumentId);

  // Step 5 — Homepage mutation protection (update only)
  if (isUpdate && existingPage) {
    checkHomepageMutation(existingPage, data as Partial<PageDocument>);
  }

  // Step 6 — Compute breadcrumb
  const breadcrumb = await computeBreadcrumb(slug, title, type, parentDocumentId);

  // Step 7 — Write computed fields into data
  data.fullpath = newFullpath;
  data.breadcrumb = breadcrumb;

  // Step 8 — Store old fullpath for after-save cascade (update only)
  if (isUpdate && existingPage) {
    event.state.oldFullpath = existingPage.fullpath;
    event.state.oldTitle = existingPage.title;
    event.state.oldType = existingPage.type;
  }
}

/**
 * Resolves the parent documentId from various input formats.
 *
 * data.parent can be:
 * - null or undefined → no parent change (keep existing) or no parent
 * - a string documentId → connect to that parent
 * - an object with { documentId } or { connect: [...] } → extract documentId
 * - { disconnect: true } or explicit null → remove parent
 */
function resolveParentDocumentId(
  parentInput: unknown,
  existingPage: PageDocument | null
): string | null {
  // Explicit null = remove parent
  if (parentInput === null) return null;

  // Not provided = keep existing parent
  if (parentInput === undefined) {
    return existingPage?.parent?.documentId ?? null;
  }

  // String documentId
  if (typeof parentInput === 'string') return parentInput;

  // Object with documentId
  if (typeof parentInput === 'object' && parentInput !== null) {
    const obj = parentInput as Record<string, unknown>;

    if (obj.documentId) return obj.documentId as string;

    // Strapi relation format: { connect: [{ documentId }] }
    if (Array.isArray(obj.connect) && obj.connect.length > 0) {
      return (obj.connect[0] as Record<string, unknown>).documentId as string;
    }

    // Disconnect
    if (obj.disconnect === true || (Array.isArray(obj.disconnect) && obj.disconnect.length > 0)) {
      return null;
    }
  }

  return existingPage?.parent?.documentId ?? null;
}
