import type { Data } from '@strapi/strapi';
/**
 * Imported from @strapi/database (internal package, not part of the public API).
 * Acceptable here because we pin Strapi to 5.0.0 and won't upgrade without review.
 */
import type { Event } from '@strapi/database/dist/lifecycles';

/** Page document type derived from the generated Strapi schema */
export type PageDocument = Data.ContentType<'api::page.page'>;

/** Lifecycle event type from Strapi's database layer */
export type LifecycleEvent = Event;

/** Single item in the breadcrumb JSON array stored on a Page */
export interface BreadcrumbItem {
  title: string;
  fullpath: string;
  isClickable: boolean;
}
