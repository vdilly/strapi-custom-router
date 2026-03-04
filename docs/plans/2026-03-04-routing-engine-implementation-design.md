# Routing Engine — Implementation Design (Strapi v5)

**Date**: 2026-03-04
**Status**: Draft
**Base document**: [routing-engine-design.md](./2026-03-04-routing-engine-design.md)
**Stack**: Strapi 5.0.0, TypeScript, SQLite (dev) / PostgreSQL (prod)

---

## 1. Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Content type schemas | `src/api/<name>/` (standard Strapi discovery) | Auto-discovered by Strapi, zero config, admin panel works out of the box |
| Business logic | `src/extensions/custom-router/` (centralized) | All routing engine logic in one folder, imported by lifecycle bridge files |
| Lifecycle approach | Declarative files in `content-types/<name>/lifecycles.ts` delegating to services | Strapi discovers them automatically; services contain the actual logic |
| API layer | Document Service API (`strapi.documents()`) | Official Strapi v5 API. Entity Service is deprecated. |
| Cascade strategy | Fetch descendants + individual `update()` via Document Service | DB-portable (SQLite + PostgreSQL), uses Strapi's API properly, acceptable perf for ~200 pages |
| Error handling | `ApplicationError` from `@strapi/utils` | Official pattern for lifecycle errors, surfaces correctly in admin panel |
| Self-referential relation | `manyToOne` (parent) + `oneToMany` (children) on Page | Documented Strapi v5 pattern for page hierarchies |
| Lifecycle state passing | `event.state` object between before/after hooks | Official Strapi v5 mechanism |
| Front-end scope | Out of scope for this repo | Nuxt app in separate repo, consumes Strapi via GraphQL |
| API de résolution custom | Évolution future | Le front Nuxt fera 2 requêtes GraphQL simples (page par fullpath + redirect lookup). Pas besoin d'endpoint custom côté Strapi pour l'instant. |
| Breadcrumb | Champ JSON `breadcrumb` stocké sur Page, read-only, calculé par les hooks | Même cycle de vie que fullpath. Tableau d'items `{ title, fullpath, isClickable }`. Le front reçoit le breadcrumb complet sans requête supplémentaire. |
| GraphQL | Plugin `@strapi/plugin-graphql` à installer | Le front Nuxt consomme via GraphQL, pas REST |

---

## 2. Project Structure

```
src/
├── index.ts                                    # Strapi bootstrap — currently empty
│
├── api/
│   ├── page/
│   │   ├── content-types/page/
│   │   │   ├── schema.json                     # Page schema (auto-discovered)
│   │   │   └── lifecycles.ts                   # Bridge → delegates to custom-router services
│   │   ├── controllers/page.ts                 # createCoreController (standard)
│   │   ├── services/page.ts                    # createCoreService (standard)
│   │   └── routes/page.ts                      # createCoreRouter (standard)
│   │
│   ├── redirect/
│   │   ├── content-types/redirect/schema.json
│   │   ├── controllers/redirect.ts
│   │   ├── services/redirect.ts
│   │   └── routes/redirect.ts
│   │
│   ├── category/
│   │   ├── content-types/category/schema.json
│   │   ├── controllers/category.ts
│   │   ├── services/category.ts
│   │   └── routes/category.ts
│   │
│   ├── actualite/
│   │   ├── content-types/actualite/schema.json
│   │   ├── controllers/actualite.ts
│   │   ├── services/actualite.ts
│   │   └── routes/actualite.ts
│   │
│   └── dossier/
│       ├── content-types/dossier/schema.json
│       ├── controllers/dossier.ts
│       ├── services/dossier.ts
│       └── routes/dossier.ts
│
├── extensions/
│   └── custom-router/
│       ├── server/
│       │   ├── services/
│       │   │   ├── fullpath.service.ts          # Fullpath computation (walk parent chain)
│       │   │   ├── validation.service.ts        # Slug validation, cycle detection, homepage protection
│       │   │   ├── redirect.service.ts          # Redirect CRUD, chain prevention, cleanup
│       │   │   └── cascade.service.ts           # Cascade descendant fullpath updates
│       │   ├── lifecycles/
│       │   │   ├── page-before-save.ts          # Orchestrates validation + fullpath steps
│       │   │   ├── page-after-save.ts           # Orchestrates redirect + cascade steps
│       │   │   ├── page-before-delete.ts        # Children check + homepage protection
│       │   │   └── index.ts                     # Barrel export
│       │   └── utils/
│       │       ├── constants.ts                 # HOMEPAGE_SLUG, RESERVED_SLUGS, SLUG_REGEX, UIDs
│       │       └── types.ts                     # Shared types (PageData, BreadcrumbItem, LifecycleEvent, etc.)
│       └── index.ts                             # Optional: re-exports for clean imports
```

### Key structural decisions

- **Lifecycle bridge pattern**: `src/api/page/content-types/page/lifecycles.ts` is a thin bridge file. It imports orchestration functions from `src/extensions/custom-router/server/lifecycles/` and delegates to them. This keeps Strapi's auto-discovery happy while centralizing logic.

- **Service responsibility**:
  - `validation.service.ts` — pure validation (slug format, cycle detection, homepage mutation guard)
  - `fullpath.service.ts` — fullpath computation (walk parent chain, build path string)
  - `redirect.service.ts` — CRUD operations on the Redirect collection
  - `cascade.service.ts` — find descendants, update their fullpaths, delegate redirect creation

- **No admin custom components** for MVP — `fullpath` field is `editable: false` in the schema, which Strapi renders as read-only natively.

---

## 3. Content Type Schemas

### 3.1 Page (`api::page.page`)

```json
{
  "kind": "collectionType",
  "collectionName": "pages",
  "info": {
    "singularName": "page",
    "pluralName": "pages",
    "displayName": "Page"
  },
  "options": {
    "draftAndPublish": true
  },
  "attributes": {
    "title": {
      "type": "string",
      "required": true
    },
    "slug": {
      "type": "string",
      "required": true
    },
    "type": {
      "type": "enumeration",
      "enum": ["page", "section"],
      "default": "page",
      "required": true
    },
    "fullpath": {
      "type": "string",
      "unique": true
    },
    "breadcrumb": {
      "type": "json"
    },
    "parent": {
      "type": "relation",
      "relation": "manyToOne",
      "target": "api::page.page",
      "inversedBy": "children"
    },
    "children": {
      "type": "relation",
      "relation": "oneToMany",
      "target": "api::page.page",
      "mappedBy": "parent"
    },
    "categories": {
      "type": "relation",
      "relation": "manyToMany",
      "target": "api::category.category"
    }
  }
}
```

**Notes**:
- `slug` is `string`, not `uid` — we handle validation ourselves (more control over format rules)
- `fullpath` has `unique: true` — Strapi creates the DB index automatically
- `fullpath` is **not** `required` — it's computed by the lifecycle hook on create, so it doesn't exist yet when the form is submitted
- `breadcrumb` is a JSON field storing an array: `[{ title: string, fullpath: string, isClickable: boolean }]`. Computed alongside fullpath, same lifecycle. `isClickable` is `true` for `type: "page"`, `false` for `type: "section"`.
- `draftAndPublish: true` — compatible with future draft/preview feature
- Self-referential relation uses `manyToOne`/`oneToMany` — documented Strapi v5 pattern

### 3.2 Redirect (`api::redirect.redirect`)

```json
{
  "kind": "collectionType",
  "collectionName": "redirects",
  "info": {
    "singularName": "redirect",
    "pluralName": "redirects",
    "displayName": "Redirect"
  },
  "options": {
    "draftAndPublish": false
  },
  "attributes": {
    "from": {
      "type": "string",
      "required": true,
      "unique": true
    },
    "to": {
      "type": "string",
      "required": true
    }
  }
}
```

**Notes**:
- `draftAndPublish: false` — redirects are always active, no draft state
- `from` has `unique: true` — one source path can only redirect to one destination
- Both fields are plain text, not relations — supports any path

### 3.3 Category (`api::category.category`)

```json
{
  "kind": "collectionType",
  "collectionName": "categories",
  "info": {
    "singularName": "category",
    "pluralName": "categories",
    "displayName": "Category"
  },
  "options": {
    "draftAndPublish": false
  },
  "attributes": {
    "title": {
      "type": "string",
      "required": true,
      "unique": true
    },
    "slug": {
      "type": "string",
      "required": true,
      "unique": true
    }
  }
}
```

### 3.4 Actualite (`api::actualite.actualite`)

```json
{
  "kind": "collectionType",
  "collectionName": "actualites",
  "info": {
    "singularName": "actualite",
    "pluralName": "actualites",
    "displayName": "Actualite"
  },
  "options": {
    "draftAndPublish": true
  },
  "attributes": {
    "title": {
      "type": "string",
      "required": true
    },
    "year": {
      "type": "integer",
      "required": true
    },
    "categories": {
      "type": "relation",
      "relation": "manyToMany",
      "target": "api::category.category"
    }
  }
}
```

### 3.5 Dossier (`api::dossier.dossier`)

```json
{
  "kind": "collectionType",
  "collectionName": "dossiers",
  "info": {
    "singularName": "dossier",
    "pluralName": "dossiers",
    "displayName": "Dossier"
  },
  "options": {
    "draftAndPublish": true
  },
  "attributes": {
    "title": {
      "type": "string",
      "required": true
    },
    "content": {
      "type": "richtext"
    },
    "categories": {
      "type": "relation",
      "relation": "manyToMany",
      "target": "api::category.category"
    }
  }
}
```

---

## 4. Lifecycle Implementation Details

### 4.1 Bridge file pattern

```typescript
// src/api/page/content-types/page/lifecycles.ts
import {
  handleBeforeCreateOrUpdate,
  handleAfterCreateOrUpdate,
  handleBeforeDelete,
} from '../../../../extensions/custom-router/server/lifecycles';

export default {
  beforeCreate(event) {
    return handleBeforeCreateOrUpdate(event);
  },
  beforeUpdate(event) {
    return handleBeforeCreateOrUpdate(event);
  },
  afterCreate(event) {
    return handleAfterCreateOrUpdate(event);
  },
  afterUpdate(event) {
    return handleAfterCreateOrUpdate(event);
  },
  beforeDelete(event) {
    return handleBeforeDelete(event);
  },
};
```

### 4.2 Before Create/Update orchestration

```
handleBeforeCreateOrUpdate(event):
  1. validateSlug(event.params.data.slug)
  2. if update: detectCycle(currentPageId, newParentId)
  3. computeFullpath(slug, parentId) → newFullpath
  4. checkFullpathUniqueness(newFullpath, currentDocumentId?)
  5. if update: checkHomepageMutationProtection(currentPage, newData)
  6. computeBreadcrumb(slug, title, type, parentId) → breadcrumb array
  7. event.params.data.fullpath = newFullpath
  8. event.params.data.breadcrumb = breadcrumb
  9. if update: event.state.oldFullpath = currentPage.fullpath
```

### 4.3 After Create/Update orchestration

```
handleAfterCreateOrUpdate(event):
  1. Determine if cascade is needed:
     - fullpath changed (event.state.oldFullpath !== result.fullpath) → cascade fullpaths + redirects + breadcrumbs
     - OR title/type changed without fullpath change → cascade breadcrumbs only (descendants reference parent title/type)
  2. If fullpath changed:
     a. createRedirect(from: oldFullpath, to: newFullpath)
     b. updateRedirectTargets(oldFullpath → newFullpath)
     c. removeConflictingRedirectSources(newFullpath)
     d. cascadeToDescendants(oldFullpath, newFullpath) — updates fullpaths + breadcrumbs
  3. If only title/type changed (no fullpath change):
     a. cascadeBreadcrumbs(currentPage) — updates breadcrumbs only for descendants
```

### 4.4 Before Delete orchestration

```
handleBeforeDelete(event):
  1. Load the page being deleted (with its fullpath and slug)
  2. checkHomepageDeletion(page)
  3. checkForChildren(page.documentId)
```

### 4.5 Cascade implementation

```
cascadeToDescendants(oldPrefix, newPrefix):
  1. Find all pages where fullpath starts with `${oldPrefix}/`
  2. For each descendant:
     a. Compute newFullpath = descendant.fullpath.replace(oldPrefix, newPrefix)
     b. Recompute breadcrumb (walk parent chain from descendant)
     c. Update the page's fullpath + breadcrumb via Query Engine
     d. Create redirect from old to new fullpath
  3. Update all redirects where `to` starts with `${oldPrefix}/` → replace prefix
  4. Delete any redirects where `from` matches a new descendant fullpath

cascadeBreadcrumbs(changedPage):
  1. Find all pages where fullpath starts with `${changedPage.fullpath}/`
  2. For each descendant:
     a. Recompute breadcrumb (walk parent chain)
     b. Update the page's breadcrumb via Query Engine
```

**Important Strapi v5 caveat**: The Document Service `update()` method triggers `beforeUpdate`/`afterUpdate` lifecycle hooks. To avoid re-entrance during cascade:
- The cascade uses `strapi.db.query()` (Query Engine) for bulk updates, which **does not** trigger lifecycle hooks
- This is the documented escape hatch for this exact use case
- We only use Query Engine for the cascade bulk operations — all other operations use Document Service

---

## 5. Service Contracts

### 5.1 validation.service.ts

```typescript
validateSlug(slug: string): void
// Throws ApplicationError if slug is empty, has invalid chars, or is reserved

detectCycle(currentPageId: string, newParentId: string | null): Promise<void>
// Walks parent chain from newParentId upward, throws if currentPageId found

checkHomepageMutation(existingPage: PageData, newData: Partial<PageData>): void
// Throws if trying to change homepage slug or assign it a parent

checkForChildren(documentId: string): Promise<void>
// Throws if page has children (blocking deletion)

checkHomepageDeletion(page: PageData): void
// Throws if trying to delete the homepage
```

### 5.2 fullpath.service.ts

```typescript
computeFullpath(slug: string, parentId: string | null): Promise<string>
// Walks parent chain, builds fullpath string

computeBreadcrumb(slug: string, title: string, type: string, parentId: string | null): Promise<BreadcrumbItem[]>
// Walks parent chain, builds breadcrumb array
// Each item: { title: string, fullpath: string, isClickable: boolean }
// isClickable = type === 'page'
// Includes the current page as the last item

checkFullpathUniqueness(fullpath: string, excludeDocumentId?: string): Promise<void>
// Queries for existing page with same fullpath, throws if found
```

### 5.3 redirect.service.ts

```typescript
createRedirect(from: string, to: string): Promise<void>
// Creates a redirect entry (upserts if `from` already exists)

updateRedirectTargets(oldTo: string, newTo: string): Promise<void>
// Updates all redirects where to === oldTo

removeConflictingRedirectSources(fullpath: string): Promise<void>
// Deletes redirects where from === fullpath

updateRedirectTargetsByPrefix(oldPrefix: string, newPrefix: string): Promise<void>
// Bulk updates redirect `to` fields matching prefix

removeRedirectSourcesByPaths(fullpaths: string[]): Promise<void>
// Bulk removes redirects where `from` is in the provided list
```

### 5.4 cascade.service.ts

```typescript
cascadeFullpathChanges(oldPrefix: string, newPrefix: string): Promise<void>
// Full cascade: update descendants fullpaths + breadcrumbs, create redirects, update redirect targets, cleanup

cascadeBreadcrumbs(changedPage: PageData): Promise<void>
// Breadcrumb-only cascade: when title/type changed without fullpath change
```

---

## 6. Commit Plan

### Commit 1: Data model + project setup
**Scope**: All 5 content type schemas + core controller/service/router files + GraphQL plugin config

**Testable**: Strapi starts, admin panel shows all 5 CTs, CRUD works via admin, GraphQL playground accessible.

**Files created**:
- `src/api/page/content-types/page/schema.json`
- `src/api/page/controllers/page.ts`
- `src/api/page/services/page.ts`
- `src/api/page/routes/page.ts`
- Same structure for redirect, category, actualite, dossier
- `config/plugins.ts` updated for GraphQL
- `package.json` updated with `@strapi/plugin-graphql`

### Commit 2: Validation + fullpath computation
**Scope**: Before-save hooks with slug validation, cycle detection, fullpath computation, uniqueness check, homepage protection

**Testable**: Creating/editing pages computes fullpath automatically. Invalid slugs rejected. Circular parents rejected. Homepage locked.

**Files created**:
- `src/extensions/custom-router/server/services/validation.service.ts`
- `src/extensions/custom-router/server/services/fullpath.service.ts`
- `src/extensions/custom-router/server/lifecycles/page-before-save.ts`
- `src/extensions/custom-router/server/lifecycles/index.ts`
- `src/extensions/custom-router/server/utils/constants.ts`
- `src/extensions/custom-router/server/utils/types.ts`
- `src/api/page/content-types/page/lifecycles.ts` (bridge)

### Commit 3: Redirect management + cascade + deletion safety
**Scope**: After-save hooks with redirect creation, chain prevention, cleanup, descendant cascade. Before-delete hooks with children check and homepage protection.

**Testable**: Renaming/reparenting a page creates redirects and cascades to descendants. Redirect chains are prevented. Deleting a page with children is blocked. Homepage deletion is blocked.

**Files created**:
- `src/extensions/custom-router/server/services/redirect.service.ts`
- `src/extensions/custom-router/server/services/cascade.service.ts`
- `src/extensions/custom-router/server/lifecycles/page-after-save.ts`
- `src/extensions/custom-router/server/lifecycles/page-before-delete.ts`
- `src/api/page/content-types/page/lifecycles.ts` (updated with after + delete hooks)

---

## 7. Évolutions futures

Éléments documentés pour les itérations suivantes, hors scope de l'implémentation actuelle :

| Évolution | Description | Priorité |
|-----------|-------------|----------|
| **Preview dynamique fullpath** | Composant React custom dans l'admin qui affiche le fullpath en temps réel quand slug ou parent change | Moyenne |
| **Cascade raw SQL PostgreSQL** | Remplacer le fetch-then-update JS par un `UPDATE ... SET fullpath = REPLACE(...)` en raw SQL pour la prod PostgreSQL, si la perf devient un sujet | Basse |
| **Arborescence admin** | Vue arborescente visuelle des pages dans le Content Manager (custom admin component) | Moyenne |
| **API de résolution** | Endpoint custom `GET /api/resolve-path?path=...` retournant page + redirects en un seul appel | Basse |
| **Endpoint bulk regeneration** | Recalcul complet de tous les fullpaths + breadcrumbs (safety net en cas d'incohérence) | Basse |
| **Cleanup dead redirects** | Script ou action admin pour supprimer les redirects pointant vers des 404 | Basse |
| **statusCode sur Redirect** | Champ `statusCode` (301/302) + `type` (auto/manual) sur la collection Redirect | Basse |

---

## 8. Strapi v5 Compatibility Notes

- **Document Service API** is the primary API. Entity Service is deprecated.
- **Lifecycle hooks** use `event.params.data`, `event.result`, and `event.state`.
- **`strapi.db.query()`** (Query Engine) is used only for cascade bulk updates to avoid hook re-entrance. This is documented as acceptable when you need to bypass lifecycle hooks intentionally.
- **`updateMany`/`deleteMany` bulk lifecycles** are never triggered by Document Service methods — confirmed in migration docs.
- **Self-referential relations** are fully supported via `manyToOne` + `oneToMany` with `inversedBy`/`mappedBy` on the same content type.
- **`unique: true`** on schema attributes creates DB-level unique indexes automatically.
- **`ApplicationError`** from `@strapi/utils` is the official way to throw user-facing errors in lifecycle hooks.
