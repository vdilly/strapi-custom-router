/** Slug reserved for the homepage (root page, no parent allowed) */
export const HOMEPAGE_SLUG = 'accueil';

/** Slugs that cannot be used by pages (reserved by the system) */
export const RESERVED_SLUGS = ['api', 'admin', 'graphql', '_health'];

/** Valid slug format: lowercase alphanumeric + hyphens, no leading/trailing hyphen */
export const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Content-type UIDs used across the routing engine */
export const UID = {
  PAGE: 'api::page.page' as const,
  REDIRECT: 'api::redirect.redirect' as const,
};
