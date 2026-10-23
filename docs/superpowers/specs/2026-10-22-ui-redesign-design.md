# UI redesign with shadcn-svelte

Date: 2026-10-22. Status: approved.

## Goal

Make the web app look and feel like a finished product on a phone and on a desktop, without changing what it computes. Only `apps/web` changes; `@pv/core`, the worker and the stored data stay as they are.

## Decisions

- **Components:** shadcn-svelte on Bits UI. The user asked for Base UI, but Base UI is a React library and shadcn-svelte has no Base UI option, so Bits UI is the Svelte equivalent.
- **Style:** the Luma style (rounded corners, soft surfaces, roomy spacing), chosen by the user from three mockups.
- **Colours:**
  - neutral grays
  - teal for main buttons and the chart
  - green for gains, red for losses
  - a set of chart colours that work in light and dark
- **Styling:**
  - Tailwind CSS 4 through `@tailwindcss/vite`.
  - The component files are copied into `src/lib/components/ui/` and are ours to edit.
  - `app.css` keeps only the theme variables and a few base rules.
- **Font and icons:** Inter from `@fontsource-variable/inter`, bundled with the app, so the CSP `font-src 'self'` stays. Icons are from `@lucide/svelte`.
- **Charts:**
  - Both charts use shadcn-svelte's Chart component (LayerChart), with tooltips on touch and hover; uPlot is removed.
  - The value chart is an area chart. The dotted "invested" line stays.
  - Allocation is a donut with a legend.
- **Theme:**
  - Light, Dark or System, set in Settings and stored in `localStorage`. It is a display preference, not financial data.
  - System is the default.
  - It works with CSS only: the system setting goes through `prefers-color-scheme`, and a choice puts a `light` or `dark` class on `<html>`. There is no inline script, so the hash CSP stays as it is.

## Layout

- **Phone (below 1024px):**
  - A sticky top bar with the portfolio name (truncated only when it must be), the "Sample data" badge, a member picker when there is more than one member, and a lock icon button.
  - A bottom tab bar with icon and label: Home, Holdings, Add, Checks, More.
  - It respects the safe area.
- **Desktop (1024px and up):**
  - A fixed left sidebar in the shadcn sidebar style, holding Home, Holdings, Add, Checks, Income and Settings, with the name at the top and the member picker and lock at the bottom.
  - It is not the collapsible Sidebar component, so it sets no cookie and has no collapse state.
  - The content is up to 72rem wide.
- **Notices:**
  - Read-only and "new version ready" use shadcn Alert.
  - Messages keep the app's single `role="status"` line, restyled and placed above the tab bar.
- **Confirmations:** browser `confirm()` calls become AlertDialog.

## Screens

Each screen keeps its current content and wording, and gets shadcn parts:

- **Unlock and create:**
  - A centred card.
  - Create shows its steps, and the recovery code is in a code block with a copy button.
  - Restore and sample-data links become buttons.
- **Home:**
  - A net-worth card holding the big figure, the gain coloured by sign, net invested, and XIRR or return.
  - A value card with 1M/1Y/All tabs, then allocation with a "group by" select, then "Worth a look", then "Coming up" as a list.
- **Holdings:**
  - Groups are cards with their total, and rows show name, member and account, value and return.
  - The "group by" select stays.
- **Holding detail:**
  - A header with value and return, a grid of stats, and transactions in a table.
  - Actions go in buttons or a dropdown.
- **Add:**
  - A dashed drop zone with a file button.
  - Add-by-hand options become icon tiles.
  - The unknown-file help uses an Alert.
- **Forms (transaction, FD, balance, price):**
  - Field, Label and Input.
  - Dates and lists keep native inputs (`<input type="date">` and the Native Select component), because phone pickers beat custom ones.
- **Import preview:** a summary with badges, warnings as Alerts, and Import and Skip buttons.
- **Checks:** a list with a severity badge on each item.
- **Income:** a table by financial year.
- **More:** a list of links with icons.
- **Settings:** grouped cards, the theme choice, and destructive actions in red behind AlertDialog.

## Accessibility and text

- Every control keeps a visible label or an `aria-label`. The labels, button names and `data-testid`s the e2e tests use stay where they are.
- Tap targets are at least 40px, focus rings stay visible, and the contrast meets WCAG AA in both themes.
- Numbers use tabular figures.

## Testing

- The unit tests (core, price-feed, web) and the Playwright e2e tests must pass at phone and desktop sizes. Selectors are updated only where the markup has to change, for example where a confirmation dialog replaces `confirm()`.
- New e2e checks:
  - no horizontal scroll at 375px on each main screen
  - the sidebar is visible on desktop and the tab bar on a phone
  - choosing Dark puts the dark theme on `<html>`
- Every screen is reviewed by screenshot at 375px and at desktop width, in light and dark.

## Out of scope

- New features beyond the theme choice.
- Changes to calculations, importers, storage or sync.
- A React or Base UI port.
