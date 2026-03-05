import { errors } from '@strapi/utils';
import { HOMEPAGE_SLUG, RESERVED_SLUGS, SLUG_REGEX, UID } from '../utils/constants';
import type { PageDocument } from '../utils/types';

const { ApplicationError } = errors;

/**
 * Validates slug format and reserved words.
 * Throws ApplicationError if invalid.
 */
export function validateSlug(slug: string): void {
  if (!slug || slug.trim().length === 0) {
    throw new ApplicationError('Le slug est obligatoire.');
  }

  if (!SLUG_REGEX.test(slug)) {
    throw new ApplicationError(
      `Le slug "${slug}" est invalide. Seuls les caractères minuscules, chiffres et tirets sont autorisés (pas de tiret en début/fin).`
    );
  }

  if (RESERVED_SLUGS.includes(slug)) {
    throw new ApplicationError(
      `Le slug "${slug}" est réservé par le système.`
    );
  }
}

/**
 * Walks the parent chain from `newParentId` upward.
 * Throws if `currentDocumentId` is found (= cycle detected).
 */
export async function detectCycle(
  currentDocumentId: string,
  newParentId: string | null
): Promise<void> {
  if (!newParentId) return;

  let cursor: string | null = newParentId;

  while (cursor) {
    if (cursor === currentDocumentId) {
      throw new ApplicationError(
        'Référence circulaire détectée : une page ne peut pas être son propre ancêtre.'
      );
    }

    const parent = await strapi.documents(UID.PAGE).findOne({
      documentId: cursor,
      fields: ['id'],
      populate: { parent: true },
    });

    cursor = (parent?.parent as { documentId: string } | null)?.documentId ?? null;
  }
}

/**
 * Prevents mutation of homepage-specific fields.
 * The homepage (slug = "accueil") cannot have its slug changed or be assigned a parent.
 */
export function checkHomepageMutation(
  existingPage: PageDocument,
  newData: Partial<PageDocument>
): void {
  if (existingPage.slug !== HOMEPAGE_SLUG) return;

  if (newData.slug !== undefined && newData.slug !== HOMEPAGE_SLUG) {
    throw new ApplicationError(
      `Le slug de la page d'accueil ne peut pas être modifié (doit rester "${HOMEPAGE_SLUG}").`
    );
  }

  if (newData.parent !== undefined && newData.parent !== null) {
    throw new ApplicationError(
      "La page d'accueil ne peut pas avoir de parent."
    );
  }
}

/**
 * Checks whether a page has children.
 * Throws if children exist (blocks deletion).
 */
export async function checkForChildren(documentId: string): Promise<void> {
  const children = await strapi.documents(UID.PAGE).findMany({
    filters: { parent: { documentId } } as any,
    fields: ['id'],
    limit: 1,
  });

  if (children.length > 0) {
    throw new ApplicationError(
      'Impossible de supprimer cette page : elle a des sous-pages. Supprimez ou déplacez-les d\'abord.'
    );
  }
}

/**
 * Prevents deletion of the homepage.
 */
export function checkHomepageDeletion(page: PageDocument): void {
  if (page.slug === HOMEPAGE_SLUG) {
    throw new ApplicationError(
      "Impossible de supprimer la page d'accueil."
    );
  }
}
