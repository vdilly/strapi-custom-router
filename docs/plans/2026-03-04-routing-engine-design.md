# Routing Engine - Design Document

**Date**: 2026-03-04
**Status**: Draft
**Scope**: POC for production-grade, CMS-driven site tree with automatic URL management

---

## 1. Vision

A CMS contributor can build any site tree structure, at any depth, without manually managing side effects. Slug changes, parent changes, page creation and deletion all automatically maintain URL consistency, redirections, and breadcrumb integrity. WordPress-like freedom, with the rigour of a URL management engine.

---

## 2. Scope

### In scope

- **Page** content type with hierarchical tree structure (unlimited depth)
- Automatic **fullpath** computation from slug + parent chain
- Automatic **redirect** management on any tree mutation (no chains, no loops)
- **Section** pages (phantom URL segments) for structural-only tree nodes
- **Category** taxonomy (cross-collection tags, no URL impact)
- **Actualite** and **Dossier** content types (basic, not routed by the engine)
- **Front-end catch-all** route resolving fullpaths to entities
- **Breadcrumb** generation respecting phantom segments
- **Middleware** for redirect resolution
- **Trailing slash** normalisation
- **SEO** compatibility (canonical URLs, sitemap-ready data)
- **Draft/preview** compatibility (design must not block future implementation)

### Out of scope (documented for future evolution)

- Rich text internal link resolution
- Bulk URL regeneration endpoint (noted as future safety net)
- Actualite/Dossier routing through the engine (front-end managed)
- Multi-language / i18n
- Versioning / draft preview implementation
- Page ordering (sort order among siblings)

---

## 3. Architecture Decision: Hooks-Based Approach

### Chosen approach: Pure lifecycle hooks on Page content type

All routing logic lives in the Page content type's lifecycle hooks. Fullpath is a field on Page (unique, indexed). Redirections live in a dedicated lightweight collection.

### Alternatives considered

| Approach | Description | Why rejected |
|----------|-------------|--------------|
| **Nested docs plugin** | Use the official CMS nested-docs plugin and extend with custom hooks for redirections | Imposes its own data model (breadcrumbs array). Doesn't handle sections, redirect cascading, or fullpath uniqueness. Too much custom on top of the plugin to justify the dependency. |
| **Centralised Router collection** | A separate Routes collection as source of truth for all routing, with polymorphic references to entities | Over-engineering for a homogeneous Page tree. Two entities to keep in sync. More complexity for the same result. Would be justified only if multiple content types were routed through the engine. |

### Why pure hooks

- Zero external dependency, all logic is explicit and testable
- Atomic: all operations run within the same request/transaction
- Single query to resolve a path: `find where fullpath equals requested path`
- Straightforward to understand, debug, and evolve
- Scales well for ~200 pages (typical site size)

---

## 4. Data Model

### 4.1 Page

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `title` | text | required | Used as display title in admin |
| `slug` | text | required, validated | Lowercase, alphanumeric + hyphens only. Not unique alone. |
| `type` | select: `page` \| `section` | required, default: `page` | `section` = phantom segment, no renderable content |
| `parent` | relationship → Page | optional | Self-referential. Null = root-level page. |
| `fullpath` | text | unique, indexed, read-only in admin | Computed by hooks. Source of truth for URL resolution. |
| `categories` | relationship → Category | hasMany, optional | Taxonomy tags |

**Key design decisions:**
- **`slug` is not unique** — two pages can have the same slug if they have different parents (e.g., `/services/contact` and `/support/contact`)
- **`fullpath` is the uniqueness constraint** — enforced at DB level via unique index
- **`fullpath` is read-only** in the admin UI — contributors edit `slug` and `parent`, the system computes the rest
- **`type: section`** is explicitly distinct from draft/unpublished status. A section is a structural node, not an unpublished page. It participates in the tree but returns 404 on direct navigation.

### 4.2 Redirect

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `from` | text | required, unique, indexed | The old/source path |
| `to` | text | required | The destination path |

**Key design decisions:**
- **Both fields are plain text** — not relationships. This allows redirections for any path, not just Pages managed by the engine.
- **No redirect chains**: the hooks guarantee that `to` always points to a current, valid path. When a destination moves, all redirections pointing to it are updated.
- **Manual redirections are supported**: editors can create `from → to` entries for any use case (e.g., an Actualite slug change, an external URL migration).
- Extensible: `statusCode` (301/302), `type` (auto/manual), or `createdAt` fields can be added later without schema-breaking changes.

### 4.3 Category

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `title` | text | required, unique | Display name |
| `slug` | text | required, unique | URL-safe identifier (for filtering, not routing) |

### 4.4 Actualite

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `title` | text | required | Display name |
| `year` | number | required | Publication year |
| `categories` | relationship → Category | hasMany, optional | Taxonomy tags |

### 4.5 Dossier

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `title` | text | required | Display name |
| `content` | richText | optional | Dossier body content |
| `categories` | relationship → Category | hasMany, optional | Taxonomy tags |

---

## 5. Lifecycle Hooks — Rules Engine

### 5.1 Before Save (Page)

Executed before data is persisted. Responsible for validation and fullpath computation.

**Step 1 — Slug validation**
- Enforce lowercase, alphanumeric, hyphens only
- Reject empty slugs
- Reject reserved slugs that would conflict with framework routes (`admin`, `api`, etc.)

**Step 2 — Cycle detection**
- Walk the parent chain upward from the selected parent
- If the current page ID is found in the chain → reject with error: "Cannot set a descendant as parent (circular reference)"

**Step 3 — Fullpath computation**
- If slug is `home` and no parent → fullpath = `/`
- If no parent → fullpath = `/{slug}`
- If parent → fullpath = `{parent.fullpath}/{slug}`
- Parent fullpath is resolved by walking the relationship chain (not by reading a cached value)

**Step 4 — Fullpath uniqueness check**
- Query for any other Page with the same fullpath (excluding current document ID)
- If collision → reject with error: "A page already exists at this path: {fullpath}"

**Step 5 — Homepage mutation protection**
- If the page being edited is the current homepage (existing `fullpath === '/'`):
  - Reject any slug change away from `home` → error: "The homepage slug cannot be changed."
  - Reject any parent assignment → error: "The homepage cannot have a parent."
- This complements the deletion protection in 5.3 — the homepage is fully locked: cannot be deleted, renamed, or reparented.

### 5.2 After Save (Page)

Executed after data is persisted. Responsible for redirect management and cascade propagation.

**Trigger condition**: the fullpath has changed compared to the previous version of the document.

**Step 1 — Create redirect for old path**
- Create Redirect entry: `from = old fullpath, to = new fullpath`

**Step 2 — Update existing redirect targets**
- Find all Redirects where `to === old fullpath`
- Update them: `to = new fullpath`
- This eliminates redirect chains: if A→B existed and B moved to C, A now points directly to C

**Step 3 — Remove conflicting redirect sources**
- Delete any Redirect where `from === new fullpath`
- The new path must not be a redirect source (real content takes priority over redirections)

**Step 4 — Cascade to descendants (bulk prefix replacement)**

Instead of re-saving each child individually (which would re-trigger the full hook chain recursively, risk partial failures, and scale as O(descendants)), the cascade uses a **bulk prefix replacement** strategy:

1. Compute the old and new fullpath of the current page (e.g., `/services` → `/nos-services`)
2. **Bulk-update all descendant fullpaths**: find all Pages where `fullpath` starts with `{oldFullpath}/` and replace the prefix with the new fullpath. This is a single bulk query (e.g., `updateMany` with string replacement), not individual saves.
3. **Bulk-create redirects for all affected paths**: for each page whose fullpath was changed in step 2, create a Redirect entry `from = oldFullpath → to = newFullpath`.
4. **Bulk-update redirect targets**: find all Redirects where `to` starts with `{oldFullpath}/` and replace the prefix. This maintains the no-chain guarantee across the entire subtree.
5. **Bulk-cleanup redirect sources**: delete any Redirect where `from` matches one of the new fullpaths (real content takes priority).

**Why prefix replacement instead of recursive re-save:**
- **Atomic**: a single bulk operation per step, not N individual saves that can fail mid-cascade
- **No re-entrance problem**: hooks are not re-triggered on descendants, eliminating the need for re-entrance flags entirely
- **Performance**: O(1) queries regardless of tree size, instead of O(descendants) sequential saves
- **Correctness**: since fullpath is always `{parent.fullpath}/{slug}`, changing a parent's fullpath only affects the prefix of all descendants — the suffix (each page's own slug chain below the parent) remains unchanged
- **CMS-agnostic**: any CMS with bulk update support or direct DB access can implement this (Payload's `updateMany`, Strapi's `entityService.updateMany`, direct MongoDB/PostgreSQL queries, etc.)

### 5.3 Before Delete (Page)

**Step 1 — Check for children**
- Query for any Page where `parent === current page ID`
- If children exist → **block deletion** with error: "Cannot delete this page: {N} child page(s) depend on it. Reassign or delete them first."

**Step 2 — Homepage protection**
- If the page being deleted has slug `home` and fullpath `/` → **block deletion** with error: "The homepage cannot be deleted."

**Step 3 — Cleanup redirections (on successful delete)**
- Optionally remove Redirects where `to` matches the deleted page's fullpath (they would point to a 404)
- Or leave them as-is (they become dead redirects, which is standard practice and can be cleaned up later)

---

## 6. Front-end Architecture

### 6.1 Catch-All Route

```
app/(frontend)/[[...slug]]/page.tsx
```

- **Optional catch-all** (`[[...slug]]`) captures both `/` and any nested path
- The slug parameter is an array of path segments: `['mairie', 'vie-locale']`
- Reconstruct the fullpath: `/${segments.join('/')}` (or `/` if segments is undefined/empty)

### 6.2 Path Resolution

1. Receive the fullpath from the URL
2. Query the CMS: find a Page where `fullpath === requestedPath`
3. If found and `type === 'page'` → render the Page component
4. If found and `type === 'section'` → return 404
5. If not found → return 404 (redirections are handled upstream in middleware)

### 6.3 Redirect Middleware

A Next.js middleware (`middleware.ts` at project root) intercepts every request:

**Step 0 — Path filtering (mandatory)**
- Skip middleware entirely for paths that cannot be CMS content:
  - `/_next/*` (Next.js internals, static assets, HMR)
  - `/api/*` (API routes)
  - `/admin/*` (CMS admin panel)
  - Static file extensions: `.js`, `.css`, `.ico`, `.png`, `.jpg`, `.svg`, `.woff2`, etc.
- This is implemented via Next.js `matcher` config or an early return guard
- **Without this filter, every JS/CSS/image request triggers a CMS API call** — multiplying load by 20-50x for no benefit

**Step 1 — Trailing slash normalisation**
- `/about/` → 301 redirect to `/about` (exception: `/` stays as-is)

**Step 2 — Redirect lookup**
- Lookup in Redirects collection: `where: { from: { equals: normalizedPath } }`
- If match → redirect (301) to `redirect.to`
- If no match → pass through to the catch-all route

**Performance note**: For ~200 pages and redirections, a CMS API call per request in middleware is acceptable. Future optimisation: cache redirects in memory or use an edge-compatible lookup (ISR-generated JSON, KV store, etc.).

### 6.4 Breadcrumb

The breadcrumb is built by walking the parent chain of the resolved Page:

1. Start with the current page
2. Walk `parent` relationship upward until root
3. Reverse the chain (root first)
4. For each node in the chain:
   - `label`: the page title
   - `href`: the page fullpath
   - `isClickable`: `true` if `type === 'page'`, `false` if `type === 'section'`

**Implementation options:**
- **Front-end resolution**: the catch-all page makes N queries (one per ancestor). Simple but potentially slow for deep trees.
- **CMS afterRead hook** (recommended): compute a virtual `breadcrumb` field on Page that returns the full chain in a single response. The CMS does the work, the front-end just renders.

### 6.5 Component Dispatch

The catch-all page dispatches to the appropriate component based on the entity:

```
Page (type: 'page') → <PageTemplate page={page} />
```

Fully typed: the page prop uses the generated CMS types. If a `template` field is added later (e.g., `default`, `landing`, `contact`), the dispatch can branch on it without changing the routing architecture.

### 6.6 Actualite / Dossier URLs

These content types are **not managed by the routing engine**. The front-end defines their URL structure:

```
app/(frontend)/actualites/[slug]/page.tsx
app/(frontend)/dossiers/[slug]/page.tsx
```

Or any structure the front-end developer chooses (with year segments, category segments, etc.). This is explicitly a front-end routing concern, not a CMS concern.

---

## 7. Trailing Slash & URL Normalisation

| Rule | Behavior |
|------|----------|
| Trailing slash | Normalised away. `/about/` → 301 to `/about` |
| Homepage | `/` stays as-is (the one exception) |
| Double slashes | `//about` → normalised to `/about` |
| Case sensitivity | Fullpaths are stored lowercase. Matching is case-insensitive. |
| Fullpath storage | Always without trailing slash, always starting with `/` |

Normalisation happens in the middleware, before redirect lookup.

---

## 8. SEO Considerations

### Canonical URLs
- Every Page of type `page` has a canonical URL derived from its fullpath
- The front-end layout includes `<link rel="canonical" href="{baseUrl}{fullpath}" />`
- Redirections ensure old URLs don't compete with the canonical

### Sitemap
- A Next.js sitemap route (or API endpoint) queries all Pages where `type === 'page'`
- Each entry uses the fullpath as the URL
- `lastModified` from the CMS timestamp
- Sections (`type === 'section'`) are excluded from the sitemap

### Redirect SEO
- All automatic redirections are 301 (permanent) — search engines transfer link equity
- Manual redirections default to 301 but can be set to 302 if a `statusCode` field is added later

---

## 9. Manual Redirections — Editor Responsibilities

The routing engine automates redirections **only for Pages**. Other content types and structural changes require manual intervention:

### Scenario: Actualite/Dossier slug change
- **What happens**: an editor changes the slug of an Actualite (e.g., `fete-du-village` → `festival-2026`)
- **Who handles it**: the editor creates a manual Redirect entry:
  - `from: /actualites/fete-du-village`
  - `to: /actualites/festival-2026`
- **Why manual**: the front-end owns the URL structure for these content types. The CMS cannot compute the full URL automatically.

### Scenario: Front-end base segment change
- **What happens**: the development team decides to rename `/actualites` to `/articles` in the Next.js route structure
- **Who handles it**: the developer creates a bulk redirect plan:
  - All existing Actualite URLs need redirections from `/actualites/*` to `/articles/*`
  - This can be done via a migration script or bulk creation in the Redirects collection
- **Why manual**: this is a front-end architectural change, not a CMS data change.

### Recommendation
Document these responsibilities clearly for editors and developers. Consider adding admin UI guidance (description fields, help text) on the Redirect collection to explain when and how to use it.

---

## 10. FAQ & Considerations

### Admin UX

**Q: How does the editor visualise the tree structure?**
A: In the MVP, the Page list view shows `fullpath` as a column, sortable. Editors can see the hierarchy from the paths. A dedicated tree view component can be added as a future enhancement (custom admin component rendering the tree visually), but is not required for the POC.

**Q: How does parent selection work?**
A: The `parent` field is a standard relationship field with a dropdown/search. It shows all existing Pages (both `page` and `section` types). The editor selects the parent, and the fullpath is recomputed automatically. The computed fullpath should be visible in the admin form (read-only field) so the editor sees the result before saving.

**Q: Can an editor change the type of an existing page from `page` to `section` or vice versa?**
A: Yes. Changing the type does not affect the fullpath or trigger redirections. It only changes how the front-end handles the page (render vs 404). This is safe and reversible.

### Testing Strategy

**Q: How should the routing engine be tested?**
A: Three layers:

1. **Unit tests** on the fullpath computation logic (pure function: given slug, parent chain → expected fullpath). Cover: root pages, nested pages, homepage, slug validation, cycle detection.
2. **Integration tests** on the hooks: create/update/delete pages via CMS API and assert fullpath values, redirect entries, cascade propagation, deletion blocking.
3. **E2E tests** on the front-end: navigate to URLs, verify correct page renders, verify redirections work, verify 404 on sections, verify breadcrumb.

### Performance & Caching

**Q: Is a CMS API call in the middleware a bottleneck?**
A: For ~200 redirects, no. The query is indexed (unique index on `from`), so it's a constant-time lookup. If the site scales to thousands of redirects:
- **Option 1**: Cache redirects in a memory map on server start, invalidate via webhook on Redirect collection changes
- **Option 2**: Generate a static JSON of redirects at build time (ISR) and load in middleware
- **Option 3**: Use Next.js `redirects` config at build time (limits: static, rebuild required)

**Q: Does the cascade propagation cause performance issues?**
A: The bulk prefix replacement strategy (see 5.2 Step 4) makes cascade performance a non-issue. A parent rename triggers a fixed number of bulk queries (find descendants by prefix, update fullpaths, create redirects, update redirect targets) regardless of the number of affected pages. For ~200 pages this is near-instant. A bulk regeneration endpoint can be added later as a safety net.

### Draft & Preview Compatibility

**Q: How does the routing engine interact with drafts?**
A: The design is compatible with draft/versioning systems:
- The front-end catch-all only queries published pages (status filter)
- Draft pages exist in the CMS and have a computed fullpath, but are not resolved by the front-end
- CMS preview mode (draft mode in Next.js) can bypass the status filter to show unpublished pages
- The fullpath of a draft page is reserved (uniqueness enforced) even before publication

### Miscellaneous

**Q: What happens if two pages try to occupy the same fullpath?**
A: The before-save hook checks uniqueness and rejects the second page with a clear error message. The unique index on `fullpath` is the ultimate safeguard at DB level.

**Q: What happens to redirects when a page is deleted?**
A: Redirects pointing to the deleted page's fullpath become dead (point to a 404). This is acceptable and standard practice. A cleanup can be done manually or via a periodic maintenance script.

**Q: Is there a maximum tree depth?**
A: No technical limit is imposed. The design supports unlimited depth. A configurable maximum can be added as a validation rule if needed, but is not in the POC scope.

**Q: Can the homepage have children?**
A: Yes. The homepage (slug `home`, fullpath `/`) can be a parent. Its children would have fullpaths like `/child-slug`. The homepage itself cannot be deleted or have a parent assigned.

---

## 11. Known Risks & Future Considerations

Risks documented here are **acknowledged and accepted** for the current scope (~200 pages, 1 editor, few modifications per week). They are not blockers but should be kept in mind if the scope evolves.

### 11.1 Race conditions on concurrent edits

**Scenario**: two editors rename two related pages at the exact same time, and their cascades overlap (e.g., editor A renames a parent while editor B renames one of its children).

**Impact**: redirect entries could end up inconsistent — a redirect `to` might point to an intermediate state that no longer exists.

**Why acceptable**: in practice, this site has 1 editor making a few changes per week. The probability of two conflicting tree mutations in the same second is effectively zero. If concurrent editing becomes a real need, a pessimistic lock on the Page tree (advisory lock at DB level during cascade) can be added.

### 11.2 Dead redirects accumulation

**Scenario**: over time, as pages are renamed, moved, and eventually deleted, Redirect entries pointing to deleted pages become dead (point to a 404).

**Impact**: no functional impact — a dead redirect just means a 301 to a 404, which browsers and search engines handle gracefully. However, the Redirects collection grows unboundedly.

**Mitigation (future)**: a periodic cleanup script or admin action that finds Redirects where `to` does not match any existing Page fullpath. Low priority — dead redirects are harmless and standard practice.

### 11.3 Fullpath computation depends on parent chain walk

**Scenario**: in the before-save hook (5.1 Step 3), the parent fullpath is resolved by walking the relationship chain upward. For a page at depth N, this requires N queries.

**Impact**: for typical depths (3-5 levels), this is negligible. For an exotic tree 15 levels deep, it's 15 sequential queries on every save of a leaf page.

**Why acceptable**: no real-world site has meaningful tree depth beyond 5-6 levels. The walk is only triggered on save (not on read), so it's an infrequent operation. If needed, a denormalized `depth` field or pre-fetched parent chain can optimize this later.

### 11.4 Bulk prefix replacement bypasses hooks on descendants

**Scenario**: the cascade strategy (5.2 Step 4) uses bulk updates, which do not trigger lifecycle hooks on the updated descendant pages.

**Impact**: this is by design — it's what makes the cascade safe and performant. But it means any future hook logic on Pages (e.g., a webhook, a cache invalidation) will not fire for descendants during a cascade.

**Mitigation**: if future hooks need to react to fullpath changes on any page, the cascade step should emit a list of affected page IDs so downstream systems can be notified explicitly (e.g., via a post-cascade webhook or event).

---

## 12. Summary of Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Architecture | Pure lifecycle hooks | No external dependencies, atomic, testable, explicit |
| Fullpath storage | Field on Page, unique indexed | Single query resolution, DB-enforced uniqueness |
| Phantom segments | `type: section` on Page | Homogeneous tree, no extra content types, explicit and clean |
| Redirect storage | Separate collection, text from/to | Universal (any path), supports manual and auto entries |
| Redirect chain prevention | Update all `to` fields when destination moves | Simple, guaranteed chain-free |
| Front-end routing for Pages | Catch-all `[[...slug]]` | Captures any depth including root |
| Front-end routing for Actus/Dossiers | Dedicated Next.js routes | Front-end owns URL structure, maximum flexibility |
| Redirect resolution | Next.js middleware | Intercepts before page render, clean separation |
| Trailing slashes | Normalised away (301) | Single canonical form, SEO-friendly |
| Cascade propagation | Bulk prefix replacement | O(1) queries, no re-entrance, no partial failure risk |
| Deletion with children | Blocked with error message | Data integrity, no orphaned pages |
| Homepage protection | Slug, parent, and deletion locked | Prevents accidental breakage of the root convention |
| Middleware path filtering | Skip static assets and internal routes | Prevents 20-50x unnecessary CMS API calls |
| Homepage | Page with slug `home`, fullpath `/` | Same type as other pages, one simple convention |
| Breadcrumb | CMS-computed virtual field (recommended) | Single query, no N+1 from front-end |
