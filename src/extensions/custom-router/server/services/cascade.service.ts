import { UID } from '../utils/constants';
import { computeBreadcrumb } from './fullpath.service';
import { createRedirect, updateRedirectTargetsByPrefix, removeRedirectSourcesByPaths } from './redirect.service';
import type { BreadcrumbItem } from '../utils/types';

interface DescendantRow {
  id: number;
  documentId: string;
  slug: string;
  title: string;
  type: string;
  fullpath: string;
  parent: { documentId: string } | null;
}

/**
 * Full cascade after a page's fullpath changed.
 * Updates all descendant fullpaths + breadcrumbs, creates redirects, updates existing redirect targets.
 *
 * Uses Query Engine (strapi.db.query) to avoid lifecycle hook re-entrance.
 */
export async function cascadeFullpathChanges(
  oldPrefix: string,
  newPrefix: string
): Promise<void> {
  // 1. Find all descendants whose fullpath starts with oldPrefix/
  const descendants: DescendantRow[] = await strapi.db.query(UID.PAGE).findMany({
    where: { fullpath: { $startsWith: `${oldPrefix}/` } },
    populate: { parent: true },
  });

  const newFullpaths: string[] = [];

  // 2. Update each descendant's fullpath + breadcrumb
  for (const descendant of descendants) {
    const oldFullpath = descendant.fullpath;
    const newFullpath = newPrefix + oldFullpath.slice(oldPrefix.length);

    // Recompute breadcrumb by walking the parent chain
    const breadcrumb = await computeBreadcrumb(
      descendant.slug,
      descendant.title,
      descendant.type,
      descendant.parent?.documentId ?? null
    );

    // Update via Query Engine (no lifecycle hooks triggered)
    await strapi.db.query(UID.PAGE).update({
      where: { id: descendant.id },
      data: { fullpath: newFullpath, breadcrumb },
    });

    // Create redirect from old to new
    await createRedirect(oldFullpath, newFullpath);

    newFullpaths.push(newFullpath);
  }

  // 3. Update existing redirects whose `to` pointed to descendants under the old prefix
  await updateRedirectTargetsByPrefix(oldPrefix, newPrefix);

  // 4. Clean up: remove redirects whose `from` is now a valid page fullpath
  await removeRedirectSourcesByPaths(newFullpaths);
}

/**
 * Breadcrumb-only cascade: when a page's title or type changed without fullpath change.
 * Descendants reference ancestor title/type in their breadcrumbs.
 *
 * Uses Query Engine to avoid lifecycle hook re-entrance.
 */
export async function cascadeBreadcrumbs(changedPageFullpath: string): Promise<void> {
  const descendants: DescendantRow[] = await strapi.db.query(UID.PAGE).findMany({
    where: { fullpath: { $startsWith: `${changedPageFullpath}/` } },
    populate: { parent: true },
  });

  for (const descendant of descendants) {
    const breadcrumb = await computeBreadcrumb(
      descendant.slug,
      descendant.title,
      descendant.type,
      descendant.parent?.documentId ?? null
    );

    await strapi.db.query(UID.PAGE).update({
      where: { id: descendant.id },
      data: { breadcrumb },
    });
  }
}
