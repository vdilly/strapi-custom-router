import { errors } from '@strapi/utils';
import { UID } from '../utils/constants';
import type { BreadcrumbItem } from '../utils/types';

const { ApplicationError } = errors;

/**
 * Walks the parent chain and builds the fullpath string.
 *
 * - Homepage (slug "accueil", no parent) → fullpath = "accueil"
 * - Root page (no parent, other slug) → fullpath = slug
 * - Child page → fullpath = parentFullpath/slug
 */
export async function computeFullpath(
  slug: string,
  parentDocumentId: string | null
): Promise<string> {
  if (!parentDocumentId) {
    return slug;
  }

  const segments: string[] = [slug];
  let cursor: string | null = parentDocumentId;

  while (cursor) {
    const parent = await strapi.documents(UID.PAGE).findOne({
      documentId: cursor,
      fields: ['slug'],
      populate: { parent: true },
    });

    if (!parent) {
      throw new ApplicationError(
        `Page parent introuvable (documentId: ${cursor}).`
      );
    }

    segments.unshift(parent.slug);
    cursor = (parent.parent as { documentId: string } | null)?.documentId ?? null;
  }

  return segments.join('/');
}

/**
 * Builds the breadcrumb array by walking the parent chain.
 *
 * Each item contains:
 * - title: the page's display title
 * - fullpath: computed path for linking
 * - isClickable: true for type "page", false for type "section"
 *
 * The current page is included as the last item.
 */
export async function computeBreadcrumb(
  slug: string,
  title: string,
  type: string,
  parentDocumentId: string | null
): Promise<BreadcrumbItem[]> {
  const ancestors: BreadcrumbItem[] = [];
  let cursor: string | null = parentDocumentId;

  while (cursor) {
    const parent = await strapi.documents(UID.PAGE).findOne({
      documentId: cursor,
      fields: ['title', 'slug', 'type', 'fullpath'],
      populate: { parent: true },
    });

    if (!parent) break;

    ancestors.unshift({
      title: parent.title,
      fullpath: parent.fullpath ?? parent.slug,
      isClickable: parent.type === 'page',
    });

    cursor = (parent.parent as { documentId: string } | null)?.documentId ?? null;
  }

  // Append current page as last breadcrumb item
  const currentFullpath = ancestors.length > 0
    ? `${ancestors[ancestors.length - 1].fullpath}/${slug}`
    : slug;

  ancestors.push({
    title,
    fullpath: currentFullpath,
    isClickable: type === 'page',
  });

  return ancestors;
}

/**
 * Checks that no other page already uses this fullpath.
 * Excludes the current document (for updates) via excludeDocumentId.
 *
 * Note: Strapi's built-in unique constraint on drafts is unreliable with D&P enabled.
 * This custom check is the real safeguard.
 */
export async function checkFullpathUniqueness(
  fullpath: string,
  excludeDocumentId?: string
): Promise<void> {
  const filters: Record<string, unknown> = { fullpath };

  if (excludeDocumentId) {
    filters.documentId = { $ne: excludeDocumentId };
  }

  const existing = await strapi.documents(UID.PAGE).findMany({
    filters: filters as any,
    fields: ['id'],
    limit: 1,
  });

  if (existing.length > 0) {
    throw new ApplicationError(
      `Le chemin "${fullpath}" est déjà utilisé par une autre page.`
    );
  }
}
