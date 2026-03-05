import { UID } from '../utils/constants';

/**
 * Creates a redirect entry. If a redirect with the same `from` already exists, updates its `to`.
 */
export async function createRedirect(from: string, to: string): Promise<void> {
  if (from === to) return;

  const existing = await strapi.db.query(UID.REDIRECT).findOne({
    where: { from },
  });

  if (existing) {
    await strapi.db.query(UID.REDIRECT).update({
      where: { id: existing.id },
      data: { to },
    });
  } else {
    await strapi.db.query(UID.REDIRECT).create({
      data: { from, to },
    });
  }
}

/**
 * Updates all redirects where `to` matches `oldTo` → set `to` to `newTo`.
 * Prevents redirect chains: A→B then B→C becomes A→C.
 */
export async function updateRedirectTargets(oldTo: string, newTo: string): Promise<void> {
  const redirects = await strapi.db.query(UID.REDIRECT).findMany({
    where: { to: oldTo },
  });

  for (const redirect of redirects) {
    await strapi.db.query(UID.REDIRECT).update({
      where: { id: redirect.id },
      data: { to: newTo },
    });
  }
}

/**
 * Removes any redirect whose `from` matches the given fullpath.
 * This prevents a redirect pointing to itself (e.g., after a rename-then-rename-back).
 */
export async function removeConflictingRedirectSources(fullpath: string): Promise<void> {
  await strapi.db.query(UID.REDIRECT).deleteMany({
    where: { from: fullpath },
  });
}

/**
 * Bulk updates redirect `to` fields matching a prefix.
 * Used during cascade: when a parent changes, all redirects targeting descendants must follow.
 */
export async function updateRedirectTargetsByPrefix(
  oldPrefix: string,
  newPrefix: string
): Promise<void> {
  const redirects = await strapi.db.query(UID.REDIRECT).findMany({
    where: { to: { $startsWith: `${oldPrefix}/` } },
  });

  for (const redirect of redirects) {
    const newTo = newPrefix + redirect.to.slice(oldPrefix.length);
    await strapi.db.query(UID.REDIRECT).update({
      where: { id: redirect.id },
      data: { to: newTo },
    });
  }
}

/**
 * Bulk removes redirects whose `from` is in the provided list.
 * Used during cascade cleanup: new descendant fullpaths should not be redirect sources.
 */
export async function removeRedirectSourcesByPaths(fullpaths: string[]): Promise<void> {
  if (fullpaths.length === 0) return;

  await strapi.db.query(UID.REDIRECT).deleteMany({
    where: { from: { $in: fullpaths } },
  });
}
