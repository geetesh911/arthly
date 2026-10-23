# Portfolio Analytics Implementation Plan

**Goal:** Add five requested allocation/concentration analytics and practical planning tools.

**Architecture:** Pure calculations in core consume existing Holding values plus AMFI and NSE metadata. The data worker serves a plain analytics DTO. Svelte composes existing cards, charts, tables and controls.

**Tech stack:** TypeScript, Svelte 5, shadcn-svelte, Vitest, Playwright.

- [x] Add failing core tests for cap/strategy classification, consolidated exposures, eligible denominators and rebalance arithmetic; run `rtk pnpm --filter @pv/core test`.
- [x] Implement reference CSV parsing and whole-list loading, with saved metadata on failure; connect relay and public-feed generation/read paths. Add source failure tests.
- [x] Implement pure portfolio analytics and validated target allocation; expose these through DataService with member filtering and encrypted saved targets.
- [x] Build Analytics using existing components; add Home, sidebar and More links. Label scopes, unknowns, source dates and estimation limits.
- [x] Add worker/filter/cache tests and Playwright analytics scenarios; run unit tests, typecheck, lint, production build and phone/desktop E2E. Inspect the rendered page and repair any layout issues.

Validation: 179 unit tests and 24 browser tests pass. Type checking, lint, production build and diff checks pass. Desktop and phone screenshots reviewed. All four live NSE constituent CSVs parsed successfully (755 unique securities at verification). Independent review identified identifier aliases in concentration calculations; regression tests now cover NSE symbol-to-ISIN matching and US/BSE symbols. Failed classification refreshes retain saved data and mark it stale.
