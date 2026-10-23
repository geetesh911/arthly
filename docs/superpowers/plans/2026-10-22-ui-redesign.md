# UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** done on the `ui-redesign` branch, 2026-10-22. See "Changes from the plan" at the end.

**Goal:** Rebuild every screen of `apps/web` with shadcn-svelte (Bits UI, Luma style, teal theme) so the app looks finished on phones and desktops, without changing what it computes.

**Architecture:**
- Tailwind 4 comes in through `@tailwindcss/vite`. The shadcn-svelte CLI copies the component source into `src/lib/components/ui/`.
- The old global CSS moves to `src/legacy.css`, imported into Tailwind's `base` layer, so screens not yet converted keep working. Component utilities still win over it. The file is deleted in the last task.
- Each screen is then rewritten in place. Its script logic, its labels and its `data-testid`s stay the same, so the Playwright tests keep passing after every task.

**Tech stack:**
- SvelteKit 3 with the hash router, Svelte 5 and Vite 8
- Tailwind 4.3 and shadcn-svelte CLI 1.7 (preset `b1Vq856O`: Luma, neutral base, teal theme, Inter, Lucide)
- bits-ui 2 and LayerChart 2 through shadcn's Chart component
- `@lucide/svelte` and `@fontsource-variable/inter`
- Vitest and Playwright

## Global Constraints

- Only `apps/web` changes. `@pv/core`, the worker (`src/lib/worker/*`), `api.ts`, `files.ts`, `forms.ts`, `passkey.ts` and `format.ts` keep their behaviour.
- **CSP stays as it is in `vite.config.ts`:**
  - no inline scripts
  - no outside origins; the fonts are bundled, `font-src 'self'`
  - `style-src` already allows inline styles
- **Imports:**
  - Use `#lib/...` with a `.ts` or `.svelte` extension, matching the code around them.
  - Generated components get their `$lib/...` and `.js` imports rewritten to `#lib/...` and `.ts`.
- Every file starts with the SPDX line: `<!-- SPDX-License-Identifier: AGPL-3.0-only -->` for Svelte and `// SPDX-License-Identifier: AGPL-3.0-only` for TS. Generated `ui/` files get it too.
- **Tests depend on these and they stay:**
  - field labels: `Name of this portfolio`, `Your name`, `Passphrase (at least 10 characters)`, `Type it again`, `Type the code`, `Passphrase`, `Recovery code`, `Backup file (.pvault)`, `Passphrase or recovery code`
  - button names: `Next`, `Create`, `I've saved it`, `Not now`, `Continue`, `Unlock`, `Lock`, `Import`, `New portfolio`, `Restore a backup file`, `Restore`, `Save an encrypted backup`, `Export to Excel`, `Remove this portfolio from this device`
  - test ids: `recovery-code`, `import-input`, `net-worth`
  - the `role="status"` message
  - headings: the `Add` heading
- **Copy:** plain, short, and in sentence case. Keep the existing wording unless a task says otherwise.
- **Tap targets:** at least 40px on phones, and numbers use `tabular-nums`.
- **Phone below 1024px:** a top bar and a bottom tab bar. **Desktop at 1024px and up:** a fixed left sidebar with no bottom bar.

---

## File structure

- `apps/web/src/app.css`:
  - It holds the Tailwind import, the shadcn theme tokens (written by the CLI), the dark-mode setup for the system setting plus a class override, and the chart colours.
  - Base rules: body, tabular numbers, `sr-only`.
- `apps/web/src/legacy.css` is temporary. It holds the old global rules, imported as `layer(base)`, and is deleted in Task 11.
- `apps/web/components.json` is the shadcn-svelte CLI config.
- `apps/web/src/lib/utils.ts` holds `cn()` and the types the components use; it is written by the CLI.
- `apps/web/src/lib/components/ui/**` holds the generated shadcn-svelte components.
- `apps/web/src/lib/theme.ts` (new) gives `Theme = 'system' | 'light' | 'dark'`, `readTheme()`, `applyTheme()` and `setTheme()`.
- `apps/web/src/lib/theme.test.ts` (new) holds the unit tests for `applyTheme` and `readTheme`.
- `apps/web/src/lib/components/Shell.svelte` is rewritten as the top bar, sidebar, tab bar and notices.
- `apps/web/src/lib/components/Nav.ts` (new) is the list of sections both navs share.
- `apps/web/src/lib/components/PageHeader.svelte` (new) is a back link, a title and an optional actions slot, used by every screen.
- `apps/web/src/lib/components/Stat.svelte` (new) is a label with a value, used by Home and the holding detail.
- `apps/web/src/lib/components/Confirm.svelte` (new) is an AlertDialog wrapper that replaces `confirm()`.
- `apps/web/src/lib/components/ValueChart.svelte` and `Donut.svelte` are rewritten on the shadcn Chart (LayerChart).
- All the other `.svelte` files under `src/lib/components` and `src/routes` have their markup rewritten.
- `apps/web/e2e/app.spec.ts` gets layout, theme and dialog tests, plus an `openSettings` helper.
- `apps/web/e2e/layout.spec.ts` (new) checks for no horizontal scroll and for which nav each size shows.

---

### Task 1: Tailwind and shadcn-svelte foundation

**Files:**
- Modify: `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/src/app.css`, `apps/web/src/routes/+layout.svelte`
- Create: `apps/web/src/legacy.css`, `apps/web/components.json`, `apps/web/src/lib/utils.ts`, `apps/web/src/lib/components/ui/**`

**Interfaces:**
- Produces:
  - `cn(...classes)` from `#lib/utils.ts`
  - the components under `#lib/components/ui/<name>/index.ts`: button, badge, card, alert, alert-dialog, input, label, field, native-select, tabs, table, separator, checkbox, skeleton, empty, item, chart, toggle-group
  - the Tailwind tokens `bg-background`, `text-muted-foreground`, `bg-primary` and so on
  - the chart colours `--chart-1` to `--chart-7`
  - the gain and loss tokens `--gain` and `--loss`, used as `text-gain` and `text-loss`

- [ ] **Step 1: Move the old rules out of `app.css`**

  Move the whole of `src/app.css` into `src/legacy.css`, keeping its SPDX header. Then replace `src/app.css` with:

  ```css
  /* SPDX-License-Identifier: AGPL-3.0-only */
  @import 'tailwindcss';
  @import './legacy.css' layer(base);
  ```

- [ ] **Step 2: Install Tailwind and add the Vite plugin**

  Run: `pnpm --filter @pv/web add -D tailwindcss@4.3.3 @tailwindcss/vite@4.3.3`

  In `vite.config.ts`, add `import tailwindcss from '@tailwindcss/vite';` and set `plugins: [tailwindcss(), sveltekit({...})]`.

- [ ] **Step 3: Run the shadcn-svelte init**

  Run in `apps/web`:

  ```
  pnpm dlx shadcn-svelte@1.7.0 init --preset b1Vq856O --css src/app.css --lib-alias '#lib' --components-alias '#lib/components' --ui-alias '#lib/components/ui' --utils-alias '#lib/utils' --hooks-alias '#lib/hooks' --skip-preflight
  ```

  Expected:
  - `components.json` and `src/lib/utils.ts` are written.
  - Theme tokens are added to `app.css`.
  - The deps are installed: bits-ui, clsx, tailwind-merge, tailwind-variants, tw-animate-css, @lucide/svelte, and the Inter fontsource.

  If the CLI refuses because there is no `svelte.config.js`, write `components.json` by hand with these aliases and `"style"` taken from the preset, then retry `add`.

- [ ] **Step 4: Add the components**

  Run: `pnpm dlx shadcn-svelte@1.7.0 add button badge card alert alert-dialog input label field native-select tabs table separator checkbox skeleton empty item chart toggle-group -y`

  Expected: the folders appear under `src/lib/components/ui/`.

- [ ] **Step 5: Normalise the generated imports and headers**

  ```bash
  cd apps/web/src/lib
  grep -rl '\$lib/' components/ui utils.ts | xargs sed -i '' -E 's#\$lib/#\#lib/#g'
  grep -rlE "#lib/[^'\"]*\.js['\"]" components/ui | xargs sed -i '' -E "s#(\#lib/[^'\"]*)\.js(['\"])#\1.ts\2#g"
  ```

  Then add the SPDX header to every generated `.svelte` and `.ts` file that lacks one, using a small node script run from the scratchpad.

- [ ] **Step 6: Bundle the font, and add the dark mode, chart and gain/loss tokens**

  - Make sure `app.css` starts with `@import '@fontsource-variable/inter';` and that `--font-sans` names `'Inter Variable'`.
  - Replace the CLI's `@custom-variant dark` line with one that follows the system unless a class overrides it:

    ```css
    @custom-variant dark {
      &:where(.dark, .dark *) {
        @slot;
      }
      @media (prefers-color-scheme: dark) {
        &:where(:root:not(.light), :root:not(.light) *) {
          @slot;
        }
      }
    }
    ```

  - Copy the `.dark { … }` token block into `@media (prefers-color-scheme: dark) { :root:not(.light) { … } }`, so the system theme needs no script.
  - Add these tokens, with dark values in both dark blocks:
    - `--chart-1: oklch(0.6 0.118 184.7)` (teal), `--chart-2: oklch(0.769 0.188 70.08)` (amber), `--chart-3: oklch(0.558 0.288 302.3)` (violet), `--chart-4: oklch(0.546 0.245 262.9)` (blue), `--chart-5: oklch(0.656 0.241 354.3)` (pink), `--chart-6: oklch(0.648 0.2 131.7)` (lime), `--chart-7: oklch(0.708 0 0)` (gray)
    - `--gain: oklch(0.527 0.154 150)` / dark `oklch(0.792 0.209 151.7)`
    - `--loss: oklch(0.505 0.213 27.5)` / dark `oklch(0.704 0.191 22.2)`
  - Expose `--color-gain`, `--color-loss` and `--color-chart-6/7` in `@theme inline`.
  - Add `body { @apply bg-background text-foreground; font-variant-numeric: tabular-nums; }` in `@layer base`.

- [ ] **Step 7: Build, typecheck and test**

  Run: `pnpm --filter @pv/web typecheck && pnpm --filter @pv/web build && pnpm --filter @pv/web e2e`

  Expected: no errors, and all 10 e2e tests pass. The old screens still look as before, because `legacy.css` still applies.

- [ ] **Step 8: Commit** with `feat(web): Tailwind and shadcn-svelte (Luma, teal)`.

### Task 2: Theme choice (system, light, dark)

**Files:**
- Create: `apps/web/src/lib/theme.ts`, `apps/web/src/lib/theme.test.ts`
- Modify: `apps/web/src/routes/+layout.svelte`

**Interfaces:**
- Produces: `type Theme = 'system' | 'light' | 'dark'`, `readTheme(storage?: Pick<Storage,'getItem'>): Theme`, `applyTheme(root: { classList: DOMTokenList }, theme: Theme): void` and `setTheme(theme: Theme): void`. `setTheme` stores the choice and applies it to `document.documentElement`.

- [ ] **Step 1: Write the failing test**

  ```ts
  // SPDX-License-Identifier: AGPL-3.0-only
  import { describe, expect, it } from 'vitest';
  import { applyTheme, readTheme } from './theme.ts';

  function root() {
    const set = new Set<string>();
    return {
      classList: {
        add: (c: string) => set.add(c),
        remove: (...c: string[]) => c.forEach((x) => set.delete(x)),
        toggle: (c: string, on?: boolean) => (on ? set.add(c) : set.delete(c), !!on),
        contains: (c: string) => set.has(c),
      } as unknown as DOMTokenList,
      set,
    };
  }

  describe('theme', () => {
    it('puts only the chosen class on the root, and none for system', () => {
      const r = root();
      applyTheme(r, 'dark');
      expect([...r.set]).toEqual(['dark']);
      applyTheme(r, 'light');
      expect([...r.set]).toEqual(['light']);
      applyTheme(r, 'system');
      expect([...r.set]).toEqual([]);
    });

    it('reads a stored choice and falls back to system', () => {
      expect(readTheme({ getItem: () => 'dark' })).toBe('dark');
      expect(readTheme({ getItem: () => 'purple' })).toBe('system');
      expect(
        readTheme({
          getItem: () => {
            throw new Error('blocked');
          },
        }),
      ).toBe('system');
    });
  });
  ```

- [ ] **Step 2: Run it.** `pnpm --filter @pv/web test` should FAIL, because `./theme.ts` doesn't exist yet.

- [ ] **Step 3: Implement**

  ```ts
  // SPDX-License-Identifier: AGPL-3.0-only
  // Light, dark, or follow the device. A display preference, kept per device.
  export type Theme = 'system' | 'light' | 'dark';
  const KEY = 'theme';

  export function readTheme(storage: Pick<Storage, 'getItem'> = localStorage): Theme {
    try {
      const value = storage.getItem(KEY);
      return value === 'light' || value === 'dark' ? value : 'system';
    } catch {
      return 'system';
    }
  }

  export function applyTheme(root: { classList: DOMTokenList }, theme: Theme): void {
    root.classList.remove('light', 'dark');
    if (theme !== 'system') root.classList.add(theme);
  }

  export function setTheme(theme: Theme): void {
    try {
      if (theme === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, theme);
    } catch {
      // Private mode: the choice lasts until the page closes.
    }
    applyTheme(document.documentElement, theme);
  }
  ```

- [ ] **Step 4: Apply it on start.** In `+layout.svelte`'s `onMount`, call `applyTheme(document.documentElement, readTheme())` before `start()`. Also update `<meta name="theme-color">` in `app.html` to `#0f766e` with a `media="(prefers-color-scheme: light)"` variant and a dark `#0a0a0a` variant.

- [ ] **Step 5: Run the tests.** `pnpm --filter @pv/web test` should PASS, and so should typecheck.

- [ ] **Step 6: Commit** with `feat(web): light, dark or system theme`.

### Task 3: The shell (top bar, sidebar, tab bar, notices, message)

**Files:**
- Create: `apps/web/src/lib/components/Nav.ts`, `apps/web/e2e/layout.spec.ts`
- Modify: `apps/web/src/lib/components/Shell.svelte`, `apps/web/src/routes/+layout.svelte`, `apps/web/e2e/app.spec.ts`

**Interfaces:**
- Produces: `sections: { href: string; label: string; icon: Component; match: (routeId: string) => boolean; phone: boolean; desktop: boolean }[]` from `Nav.ts`.

The sections, with their Lucide icons:

| Section | Icon | Phone | Desktop |
| --- | --- | --- | --- |
| Home | `House` | yes | yes |
| Holdings | `ChartPie` | yes | yes |
| Add | `CirclePlus` | yes | yes |
| Checks | `ShieldCheck` | yes | yes |
| Income | `IndianRupee` | no | yes |
| More | `Ellipsis` | yes | no |
| Settings | `Settings` | no | yes |

- [ ] **Step 1: Write the failing layout tests** in `e2e/layout.spec.ts`. They:
  - Open sample data with `getByRole('button', { name: 'Try with sample data' })`.
  - **Phone project:** expect `getByRole('navigation', { name: 'Screens' })` to be visible, and `getByRole('navigation', { name: 'Sections' })` to be hidden.
  - **Desktop project:** the reverse.
  - **Both:** for Home, Holdings, Add, Checks and More or Settings, expect `document.documentElement.scrollWidth <= innerWidth`.

  Navigate by clicking the links, never by `page.goto`: a reload would lock the vault.

- [ ] **Step 2: Run them.** `pnpm --filter @pv/web e2e -g layout` should FAIL, because no 'Sections' navigation exists yet.

- [ ] **Step 3: Rewrite `Shell.svelte`**
  - The outer wrapper is `div.min-h-dvh lg:pl-64`.
  - **Desktop sidebar:** `aside.hidden lg:flex fixed inset-y-0 left-0 w-64 flex-col border-r bg-sidebar p-4`, holding:
    - the vault name (`font-semibold truncate`) and a `Badge variant="secondary"` "Sample data" when it's a demo
    - `<nav aria-label="Sections">` with links styled with `buttonVariants({ variant: 'ghost' })`, plus `bg-accent text-accent-foreground` and `aria-current="page"` on the active one
    - at the bottom: the member `NativeSelect` when there are 2+ members, and a `Button variant="outline"` with the `Lock` icon and the text "Lock"
  - **Phone top bar:** `header.lg:hidden sticky top-0 z-20 border-b bg-background/80 backdrop-blur pt-[env(safe-area-inset-top)]`, holding:
    - the name (`truncate font-semibold`, flex-1)
    - the badge
    - the member `NativeSelect` (size sm, max-w-[45%]) when there are 2+ members
    - `Button size="icon" variant="ghost" aria-label="Lock"` with the `Lock` icon
  - **Main:** `main.mx-auto max-w-6xl px-4 pt-4 pb-28 lg:px-8 lg:pt-8 lg:pb-12`.
  - **Notices:** before the children, a read-only `Alert variant="destructive"` with `TriangleAlert`, and an update `Alert` with `RefreshCw`. They sit in main, so they get the page's padding, which fixes the blue-block bug.
  - **Phone tabs:** `nav.lg:hidden fixed bottom-0 inset-x-0 z-20 border-t bg-background/95 backdrop-blur pb-[env(safe-area-inset-bottom)]` with `aria-label="Screens"`. It shows the phone sections as `flex-1 flex flex-col items-center gap-0.5 py-2 text-xs`, with the icon at `size-5`. The active tab is `text-primary font-medium` with `aria-current="page"`.

- [ ] **Step 4: Restyle the loading state and the message in `+layout.svelte`**
  - **Loading:** a centred `Spinner`-style `LoaderCircle` with `animate-spin` and the text "Loading…".
  - **The `role="status"` message:** `fixed inset-x-4 bottom-20 z-30 mx-auto max-w-md rounded-2xl bg-foreground px-4 py-3 text-sm text-background shadow-lg lg:bottom-6 lg:right-6 lg:left-auto`.

- [ ] **Step 5: Add an `openSettings(page)` helper to `e2e/app.spec.ts`.** It clicks the `Settings` link (exact) when visible, otherwise `More` and then `/Settings/`. Use it in the two tests that open Settings.

- [ ] **Step 6: Run `pnpm --filter @pv/web e2e`.** All tests should PASS, including the layout tests.

- [ ] **Step 7: Screenshot** Home at 375×812 and at 1280×800, in light and in dark.

- [ ] **Step 8: Commit** with `feat(web): new app shell — sidebar on desktop, tab bar with icons on phones`.

### Task 4: Charts on LayerChart

**Files:**
- Modify: `apps/web/src/lib/components/ValueChart.svelte`, `apps/web/src/lib/components/Donut.svelte`, `apps/web/package.json` (remove `uplot`)

**Interfaces:**
- Consumes: `Point` from `#lib/worker/dto.ts`, with `date`, `value`, `netInvested` and `costOnly`.
- Produces: the same props as now, `ValueChart { points: Point[] }` and `Donut { slices: [string, number][] }`.

- [ ] **Step 1: ValueChart**
  - It uses `Chart.Container` and an `AreaChart` from `layerchart`.
  - Data: `points.map(p => ({ date: new Date(p.date + 'T00:00:00Z'), value: p.value, invested: p.netInvested }))`.
  - Series:
    - `value`: colour `var(--chart-1)`, a filled area at 20% opacity
    - `invested`: colour `var(--muted-foreground)`, a dashed line, no fill
  - The y axis uses `inrShort`. The x axis shows the month, with `{ month: 'short' }` for ranges over 31 days and `{ day: 'numeric', month: 'short' }` otherwise.
  - The tooltip shows the date, Value and Invested with `inr`.
  - The height is `h-52` and the width is the container's.
  - Keep the "appears once there's more than a day of history" empty text for fewer than 2 points.

- [ ] **Step 2: Donut**
  - It uses a `PieChart` with `innerRadius` of 60% and the colours `var(--chart-1..7)` in order.
  - The legend list sits to the right on `sm+` and below on phones. Each row shows a dot, the label, `inrShort(value)` and `pct(share, 0)`, as now.
  - Keep `role="img" aria-label="Allocation"` on the chart's wrapper.

- [ ] **Step 3: Remove uplot.** Run `pnpm --filter @pv/web remove uplot` and delete the `uplot/dist/uPlot.min.css` import.

- [ ] **Step 4: Typecheck, build and e2e.** All should PASS, and net worth is still `₹12,91,439` in the Groww test.

- [ ] **Step 5: Screenshot** Home's charts on a phone and on desktop, in light and dark. Touch or hover should show the tooltip.

- [ ] **Step 6: Commit** with `feat(web): charts on shadcn Chart (LayerChart) with tooltips`.

### Task 5: Unlock and create

**Files:** Modify `apps/web/src/lib/components/Unlock.svelte` and `apps/web/src/lib/components/Create.svelte`.

- [ ] **Step 1: Unlock**
  - **Page:** `min-h-dvh grid place-items-center px-4 py-10`, with a column of `w-full max-w-sm space-y-6` inside.
  - **Brand row:** a teal rounded-2xl square with the `ShieldCheck` icon, the "Portfolio" h1 (`text-2xl font-semibold`), and the existing muted line.
  - **iOS hint:** an `Alert`.
  - **Forms:** each is a `Card` with `CardHeader` (title, plus the description where one exists) and `CardContent`, using `Field`, `Label` and `Input` (the `id`s link label and input).
    - The portfolio picker uses `NativeSelect`.
    - The buttons are `Button class="w-full"` for Unlock and Restore. "Use fingerprint" is a `Button variant="outline"` with the `Fingerprint` icon.
    - The recovery and passphrase toggles are `Button variant="link" size="sm"`.
  - **The secondary actions card** (New portfolio, Restore a backup file, Try with sample data) is a `div.grid gap-2` of `Button variant="ghost"` items, each with an icon: `Plus`, `Upload`, `Sparkles`.
  - Keep every label and button name exactly.

- [ ] **Step 2: Create**
  - Each step is a `Card` with a small "Step n of 4" `CardDescription`.
  - The recovery code is a `div.rounded-xl border bg-muted p-4 font-mono text-lg tracking-wider break-all` with `data-testid="recovery-code"`, plus a `Button variant="outline" size="sm"` "Copy" that uses `navigator.clipboard`.
  - The mismatch text is `text-destructive text-sm`.
  - The Back buttons are `variant="ghost"`.

- [ ] **Step 3: Run e2e.** The create, lock/unlock and restore tests should PASS.

- [ ] **Step 4: Screenshot** the unlock screen, each create step, and restore, on a phone, light and dark.

- [ ] **Step 5: Commit** with `feat(web): unlock and create screens on shadcn`.

### Task 6: Home and checks list

**Files:**
- Create: `apps/web/src/lib/components/Stat.svelte`, `apps/web/src/lib/components/PageHeader.svelte`
- Modify: `apps/web/src/routes/+page.svelte`, `apps/web/src/lib/components/CheckList.svelte`, `apps/web/src/routes/checks/+page.svelte`

**Interfaces:**
- Produces:
  - `Stat { label: string; value: string; tone?: 'gain' | 'loss' | undefined; hint?: string | undefined; testid?: string | undefined; size?: 'lg' | 'md' }`
  - `PageHeader { title: string; back?: { href: string; label: string } | undefined; actions?: Snippet | undefined; description?: string | undefined }`. It renders the back link as `Button variant="ghost" size="sm"` with `ChevronLeft`, then an `h1.text-2xl font-semibold tracking-tight` and the actions on the right.

- [ ] **Step 1: Home**
  - **Hero card:**
    - The net worth figure is `text-4xl font-semibold` with `data-testid="net-worth"`.
    - Below it, a gain line shows `+₹…` in `text-gain` or `text-loss`, and the return or XIRR as a `Badge variant="secondary"`.
    - Under a `Separator`, a 2-column grid of `Stat`s shows Net invested and XIRR or Return.
  - **Value card:** a `CardHeader` holding the title "Value" and the `Tabs` (1M/1Y/All) on the right, with `ValueChart` in `CardContent` and the cost-only note as `text-xs text-muted-foreground`.
  - **Allocation card:** a `NativeSelect` for "Group allocation by" (keep the aria-label) and the `Donut`.
  - **Grid:** on desktop the cards sit in `lg:grid-cols-3`. The hero takes the full width, Value spans 2 columns, and Allocation takes 1. "Worth a look" and "Coming up" each take half the width.
  - **Coming up:** an `Item` list with the date in a small rounded box, the name with the kind as muted text, and the amount on the right.
  - **Welcome state:** the `Empty` component with the `Wallet` icon, the existing text, and a `Button href="#/add"` "Add holdings".
  - **Footer:** "Prices updated … · As of …" in `text-xs text-muted-foreground`.

- [ ] **Step 2: CheckList**
  - Each check is an `Item` with `variant="outline"`, a leading `TriangleAlert` (for `warn`) or `Info` icon, and the message.
  - The actions are a `Button size="sm" variant="secondary"` "Fix" (as `href`), or "Restore the other version", plus a `Button size="sm" variant="ghost"` "Not a problem".
  - The empty state is a `CircleCheck` with "Everything checks out."

- [ ] **Step 3: Checks page.** It uses `PageHeader title="Checks"`, with `CheckList` in a `Card`.

- [ ] **Step 4: Run e2e** and screenshot Home on a phone and on desktop, in light and dark.

- [ ] **Step 5: Commit** with `feat(web): home and checks on shadcn`.

### Task 7: Holdings and holding detail

**Files:**
- Create: `apps/web/src/lib/components/Confirm.svelte`
- Modify: `apps/web/src/routes/holdings/+page.svelte`, `apps/web/src/routes/holdings/[key]/+page.svelte`

**Interfaces:**
- Produces: `Confirm { open: boolean (bindable); title: string; description: string; action: string; destructive?: boolean; onConfirm: () => void | Promise<void> }`, built on `AlertDialog`.

- [ ] **Step 1: Confirm.svelte.** The Root is bound to `open`. It has a title and a description, a Cancel button, and an Action that calls `onConfirm` and then closes. The Action is `buttonVariants({ variant: destructive ? 'destructive' : 'default' })`.

- [ ] **Step 2: Holdings list**
  - It uses `PageHeader title="Holdings"` with a `NativeSelect` action (aria-label "Group holdings by").
  - Each section is a `Card`: a `CardHeader` row holds the name and total, and the list is the rows.
  - Each row is an `<a>` styled as `flex items-center gap-3 rounded-xl px-3 py-3 hover:bg-muted`, holding:
    - a 36px rounded avatar with the first letter of the asset class, coloured by class with `bg-chart-n/15 text-chart-n`
    - the name (`font-medium truncate`) and the member and account (muted, xs)
    - on the right, the value and the return line in `text-gain` or `text-loss`
  - The estimate `*` stays, with its footnote.
  - Loading shows `Skeleton` rows, and the empty state uses `Empty`.

- [ ] **Step 3: Holding detail**
  - `PageHeader` has back = Holdings, the title is the name, and the description is the member, account, class and status.
  - **Stats card:** a grid of `Stat`s, `grid-cols-2 sm:grid-cols-3`.
  - **Value over time:** a card with `ValueChart`.
  - **Transactions:** a card with the shadcn `Table` inside an `overflow-x-auto` wrapper. Each row's delete is a `Button size="icon" variant="ghost" aria-label="Delete"` with `Trash2`, which opens `Confirm` ("Delete this transaction?"). "Add a transaction" is a `Button variant="outline" size="sm"` with `Plus`.
  - **Lots:** a `Table`.
  - **Groups:** `Checkbox` with `Label` rows.
  - **Details:** `Field`, `Input` and `NativeSelect` in a form. Edit and Cancel are `Button variant="ghost" size="sm"`.

- [ ] **Step 4: Run e2e.** The holdings tests should PASS. Screenshot both screens on a phone and on desktop.

- [ ] **Step 5: Commit** with `feat(web): holdings screens on shadcn`.

### Task 8: Add hub and import preview

**Files:** Modify `apps/web/src/routes/add/+page.svelte` and `apps/web/src/lib/components/ImportPreview.svelte`.

- [ ] **Step 1: Add hub**
  - Keep the `h1` "Add", using `PageHeader`.
  - **Import card:**
    - The drop zone is a `label` styled `flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed p-8 text-center`. It shows `border-primary bg-primary/5` while dragging.
    - It holds the `FileUp` icon, the text "Choose files" (or "Reading…" while busy) styled as `buttonVariants()`, and the hidden input with `data-testid="import-input"`.
    - Below it, the supported-files text and the "Whose files are these?" `NativeSelect`.
  - **Unknown file:** an `Alert` with the headings in a `code` block and a "Copy headings" `Button variant="outline" size="sm"`.
  - **Add by hand:** a `grid grid-cols-2 gap-3` of tile links (`rounded-2xl border p-4 hover:bg-muted`), each with an icon and a label:
    - Transaction: `ArrowLeftRight`
    - FD, bond or SGB: `Landmark`
    - PPF, EPF or cash: `PiggyBank`
    - Price: `Tag`
  - The template link is `Button variant="link"`.

- [ ] **Step 2: ImportPreview**
  - It is a `Card`, with the file name as the title and the importer and date as the description.
  - **Counts:** a row of Badges for new, changed, duplicates and already there. Keep the exact sentence "{n} new, {m} changed." as a muted line, because e2e looks for "12 new, 0 changed.".
  - **Totals:** an `Alert`, using the default variant when they match and destructive when they don't, with the existing text.
  - **Other blocks:** warnings are `Alert`s, fund matches are an `Item` list with a "Not this fund" `Button variant="link" size="sm"`, and the changes list uses `Checkbox` rows.
  - **Buttons:** `Button` "Import" and `Button variant="ghost"` "Cancel". When it's up to date, show "Already up to date. Nothing new in this file." with a `CircleCheck` icon and a "Done" button.

- [ ] **Step 3: Run e2e.** The import tests should PASS. Screenshot the preview for the MF and PPF fixtures.

- [ ] **Step 4: Commit** with `feat(web): add screen and import preview on shadcn`.

### Task 9: The four add-by-hand forms

**Files:** Modify `apps/web/src/routes/add/{transaction,fd,balance,price}/+page.svelte`.

- [ ] **Step 1: Convert each form**
  - Each uses `PageHeader` with back = Add.
  - The form is a `Card` with `CardContent class="space-y-4"`, using `Field`, `Label` and `Input` (`inputmode` kept) and `NativeSelect` for every `<select>`.
  - Two-column pairs (start and maturity, units and price) are `grid grid-cols-2 gap-3`.
  - Help text is `FieldDescription`.
  - Save is `Button class="w-full sm:w-auto"`.
  - Keep every label text, `required`, `bind:` and `onchange` exactly.

- [ ] **Step 2: Run e2e and typecheck.** Both should PASS. Screenshot each form on a phone.

- [ ] **Step 3: Commit** with `feat(web): add-by-hand forms on shadcn`.

### Task 10: Checks, Income, More and Settings, with dialogs and the theme choice

**Files:**
- Modify: `apps/web/src/routes/income/+page.svelte`, `apps/web/src/routes/more/+page.svelte`, `apps/web/src/routes/settings/+page.svelte`, `apps/web/e2e/app.spec.ts`

- [ ] **Step 1: Write the failing e2e tests**
  - In 'export to Excel', replace `page.once('dialog', …)` with clicking `getByRole('alertdialog').getByRole('button', { name: 'Export' })` after `Export to Excel`.
  - In 'restore a backup file', click `getByRole('alertdialog').getByRole('button', { name: 'Remove' })`.
  - Add the test 'choose dark theme': open Settings, click `getByRole('radio', { name: 'Dark' })`, and expect `html` to have class `dark`. Reload, unlock with the passphrase, and expect `html` still to have class `dark`.

- [ ] **Step 2: Run them.** They should FAIL, because no alertdialog or Dark radio exists yet.

- [ ] **Step 3: Settings**
  - The page uses `PageHeader` with back = More, shown only on phones.
  - Each block is a `Card` with a `CardHeader` title and description.
  - Add an "Appearance" card first, with a `ToggleGroup type="single"` of System, Light and Dark (`Monitor`, `Sun`, `Moon` icons). Its value comes from `readTheme()` and changes call `setTheme`. Make sure each item has `role="radio"` (Bits UI ToggleGroup single does this).
  - **Backup buttons:** the primary is `Button`, the exports are `variant="outline"`, and each export opens `Confirm` (title "Export without encryption?", the existing text, action "Export").
  - **Members, Groups and import history:** `Item` rows, with an `Input` and a `Button` add row.
  - **Unlocking:** the change-passphrase form uses `Field`s. "Make a new recovery code" opens `Confirm`, and the new code shows in the same mono box as in Create.
  - **Auto-lock:** an `Input type="number"`.
  - **Undo import:** opens `Confirm` ("Undo this import?", action "Undo").
  - **About:** the version, and `Button variant="destructive"` "Remove this portfolio from this device", which opens `Confirm` (destructive, action "Remove").

- [ ] **Step 4: Income.** It uses `PageHeader` with a `NativeSelect` year action (aria-label "Financial year"). Interest and Dividends become `Tabs`. The table is a `Table` with a bold total row, and the note is muted text.

- [ ] **Step 5: More.** It is an `Item` list of links with icons: Income per year (`IndianRupee`) and Settings, backup and export (`Settings`), each with a `ChevronRight`.

- [ ] **Step 6: Run e2e.** All should PASS.

- [ ] **Step 7: Commit** with `feat(web): settings, income and more on shadcn; dialogs replace confirm()`.

### Task 11: Remove the legacy CSS, review, docs

**Files:**
- Delete: `apps/web/src/legacy.css`
- Modify: `apps/web/src/app.css`, `README.md`, `CHANGELOG.md`, `docs/superpowers/plans/2026-10-22-v1-phases.md` ("Changes from the spec")

- [ ] **Step 1: Delete the legacy CSS.** Remove `legacy.css` and its import. Run `grep -rnE 'class="[^"]*\b(card|row|grow|muted|small|pill|notice|button|link|primary|good|bad|stack|scroll|code)\b' apps/web/src`. It should print nothing; convert any leftovers.

- [ ] **Step 2: Run the whole suite**
  - Unit tests: core 113, price-feed 8, web 9 (7 plus 2 theme)
  - `pnpm lint`, `pnpm typecheck`, `pnpm build`
  - `pnpm --filter @pv/web e2e`, at phone and desktop

  Expected: all PASS.

- [ ] **Step 3: Review screenshots.** Take every screen at 375×812 and 1280×800, in light and dark. Check the spacing, the contrast, truncation, horizontal scroll and the focus rings, and fix what's off.

- [ ] **Step 4: Check the bundle.** Run `du -sh apps/web/build` and compare with before (uPlot is out, LayerChart and the font are in). Report the number.

- [ ] **Step 5: Docs**
  - **README:** add one line about the new look and the theme choice.
  - **CHANGELOG:** add "New look built with shadcn-svelte; light/dark/system theme; sidebar on desktop".
  - **Plan doc, "Changes from the spec":**
    - The UI is built on shadcn-svelte and Bits UI. Base UI is React-only.
    - The desktop nav is a simple fixed sidebar, not shadcn's collapsible Sidebar, so it sets no cookie and has no collapse state.
    - Messages keep the app's own `role="status"` line instead of Sonner, because it is one line and the tests use it.

- [ ] **Step 6: Commit** with `chore(web): drop legacy CSS; docs for the new look`.

## Changes from the plan

- **Confirmations:** one shared dialog and `ask()` in `src/lib/confirm.svelte.ts`, instead of a `Confirm` component with props per screen. Each `confirm()` became one awaited line.
- **Form fields:** a small `FormField` (a label wrapping its control, plus a hint) replaces shadcn's Field. Field, Item and Label were removed as unused.
- **Licence headers:** the copied shadcn-svelte files keep their MIT licence, with `SPDX-License-Identifier: MIT` and a LICENSE.md in that folder. The plan said AGPL, which would have been wrong. The licence test allows MIT for that folder only.
- **Tap targets:** buttons, inputs and selects are 40px tall below 640px. Selects use 16px text on phones, so iOS doesn't zoom.
- **Brand teal:** `--brand` is a brighter teal for icons and links. In dark mode, `--primary` is a button fill and too dim for text.
- **Fonts:** only Inter's Latin and Latin Extended files (₹ is in Latin Extended) are bundled. That is 133 KB instead of seven subsets at 213 KB, which matters because the service worker precaches every file.
- **Layout test:** besides page width, it fails when a card clips its content or a figure is cut off. It also opens a holding's page.
- **Bug found and fixed:** unlocking with a passphrase or recovery code never opened the app, because the worker's `unlock()` returns nothing and the screen waited for a value. The e2e test missed it because `name: 'Lock'` also matched "Unlock". The match is now exact.
