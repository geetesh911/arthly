# Contributing

Thanks for helping. The most useful contributions are new importers, since every broker and bank exports files differently.

## Ground rules

- **No personal data in the repo, ever.** Fixtures are synthetic: see [Fixtures](#fixtures).
- **No servers that see user data.** Everything runs in the browser.
- **Plugins ship with the app.** Nothing is downloaded at runtime; every plugin is reviewed here.
- Every source file starts with `// SPDX-License-Identifier: AGPL-3.0-only` (or the comment style of its language). A test checks this.
- Tests come first. `pnpm test`, `pnpm typecheck` and `pnpm lint` must pass.

## Plugins

A plugin is one folder with its code, its `fixtures/` and its tests, plus one line in its registry.

| Kind         | Folder                                      | Registry                |
| ------------ | ------------------------------------------- | ----------------------- |
| Importer     | `packages/core/src/plugins/importers/<id>/` | `importers/index.ts`    |
| Asset type   | `packages/core/src/plugins/assets/<kind>/`  | `assets/index.ts`       |
| Price source | `packages/core/src/plugins/prices/<id>/`    | used by the data worker |
| Exporter     | `packages/core/src/plugins/exporters/<id>/` | `exporters/index.ts`    |

### Writing an importer

An importer has two functions (see `packages/core/src/import/types.ts`):

- `detect(file)` returns a score from 0 to 1. Judge by heading text, never by cell position, because exports move things around. The best score of at least 0.6 wins.
- `parse(file, ctx)` returns an `ImportDraft`: accounts, instruments, transactions and holdings snapshots, plus the file's own totals when it has them, so the app can check its sums.

Rules for drafts:

- **Typed fields only.** Names are the only free text.
- **Mask references:** account, folio and client numbers go through `mask()`, which keeps the last 4 characters.
- **Never copy** PAN, phone numbers, emails, addresses or holder names into a draft.
- **Give ISINs or AMFI codes** where the file has them. When it doesn't, fund names are matched against AMFI's list, and the user confirms each match.

Start from `groww-mf-holdings`; it is short.

## Fixtures

Fixtures are copies of real exports with every personal value and every number replaced. See [packages/core/src/plugins/importers/FIXTURES.md](packages/core/src/plugins/importers/FIXTURES.md).

Each importer test parses its fixture and compares the draft with a saved snapshot (`*.draft.json`). A shared test scans every parsed draft for anything that looks like a PAN, phone number or email, and fails if it finds one.

If you can't make a fixture, open an issue with the file's column headings only. The app offers to copy them when it doesn't recognise a file.

## Pull requests

- Keep each pull request to one change.
- Describe what you tested, and with which kind of file.
- Changes to encryption, sync or the change-log format need a note in the design spec.
