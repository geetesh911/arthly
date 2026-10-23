# Fund Holdings Implementation Plan

**Goal:** Fetch official fund portfolios through the relay and base portfolio analytics on their underlying holdings.

**Architecture:** Allowlisted source discovery and bounded workbook proxy in the relay; Excel parser and typed public dataset in core; cached ingestion and DTOs in the worker; pure exposure calculations and existing Svelte UI components.

**Constraints:** Preserve prior work and encrypted cache compatibility. No investor holdings in relay requests. No paid vendor integration or fabricated holdings. Use current project dependencies and prefix every shell command with `rtk`.

- [x] Parse real AMC workbooks with formatted percentage handling, dated scheme identities, security types and total validation; add fixture-driven tests first.
- [x] Add source discovery for PPFAS/Nippon/HDFC/Zerodha and allowlisted workbook proxy with bounded bytes and redirects; test malformed data and source failures.
- [x] Add whole-dataset client ingestion, merge-on-failure, encrypted persistence and optional public-feed generation/read support.
- [x] Calculate direct plus indirect stock/sector/cap/asset exposure, preserve uncovered amounts, handle FoFs and stock overlap; test arithmetic before implementation.
- [x] Add fund holding details, dated sources, value coverage and direct/indirect stock columns; test member filtering and browser interactions.
- [x] Run independent review, unit tests, type checking, lint, production build and phone/desktop E2E; verify live official file parsing.

Verified on 2026-10-23:

- Live discovery and ingestion: 136 official workbooks, 248 portfolios, 17,691 holdings, zero failures. Source coverage: PPFAS 7, Nippon India 107, HDFC 111, Zerodha 23 portfolios.
- Compared normalized report identities against the current AMFI list (14,165 schemes): 247 of 248 reports match; the differently named Nippon Quarterly Interval product remains unmatched without an explicit identifier or verified alias.
- Ran the exposure engine over all 248 reports, including nested funds, stock consolidation and overlap, with portfolio value conserved.
- 226 unit tests and 26 Playwright tests pass. Type checking, ESLint, formatting and the production build pass. Inspected phone/desktop screenshots for fund details and search; no horizontal overflow.
- Independent review findings were fixed and regression tested: derivatives-only worksheets, rounded percentage marks, verified unlabeled subtotals, scheme-name matching, malformed public-feed identifiers and daily refresh cadence.

Limits: four AMC adapters, dated monthly physical holdings, no derivative hedge netting, NSE index membership as a market-cap proxy. Unsupported/ambiguous funds remain unclassified. Current-value allocations are estimates, not fund-level stock returns or confirmed live positions. The allocation planner retains instrument-level targets; the separate underlying asset split expands available fund disclosures.
