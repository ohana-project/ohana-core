# Handoff: issue #6, Ohana design system

You are finishing GitHub issue #6 ("Design system: Ohana's visual language"). Read the issue first (`gh issue view 6`): its acceptance criteria are the finish line. This file tells you what is already done, what was decided and why, and the remaining steps in order.

## Read before coding

1. `docs/design/README.md` is the **spec**: every token value, component anatomy, glass recipe, layout rule, and the prototype defects to avoid. This handoff never repeats its values; look them up there.
2. `docs/design/assets/ohana.css` is the prototype stylesheet the spec was extracted from. When the spec is silent on a detail (a hover mix, a transition, a pixel size), copy it from here.
3. `docs/design/screens/*.html` are the reference screens. Serve them with `python3 -m http.server -d docs/design` and open `/screens/home.html` to compare the look while you build.
4. `docs/architecture.md`, section "Web client". It is binding, and it includes the definition of done.
5. `AGENTS.md`. Add and remove dependencies only through `pnpm add` / `pnpm remove`, and add components only through `pnpm exec shadcn add`. Never hand-edit a `package.json`.

## State when you start

- Branch `design-system/reference-docs` has **uncommitted** step-0 work:
  - `docs/design/` (spec, 27 screens, prototype assets);
  - the `docs/architecture.md` update;
  - a Biome override in `packages/config/biome.json` that excludes `docs/design/screens/**` and `docs/design/assets/**`.
- The raw export `.design/` (untracked) may still exist. It must be deleted before `pnpm lint` passes. Nothing in it is needed any more. If it is still there, ask the human to delete it rather than deleting it yourself.
- `apps/web` is still the stock shadcn `base-nova` scaffold:
  - `src/index.css` has the neutral theme, a `.dark` class variant, and Geist;
  - `src/ui/button.tsx` and `src/ui/card.tsx` are unstyled defaults;
  - `components.json` has `iconLibrary: "lucide"`.
- Playwright is not installed anywhere in the repo.

Ask the human whether to commit step 0 and open its PR before you start step 1. After that, work in one branch and PR per step (or pair small adjacent steps). Keep each PR green on `pnpm lint`, `pnpm typecheck` and `pnpm test`.

## Decisions already made

The human approved these; do not reopen them.

- **Token roles.** Ohana tokens fill shadcn's semantic roles, as mapped in the spec's "Implementation" section. The collision to watch: shadcn's `accent` is a subtle hover fill, so it takes Ohana's `fg-soft`. Ohana's brand accent is `primary`. Ohana-only tokens stay as extra Tailwind colours:
  - `surface-2`, `ok`, `warn`;
  - `primary-soft` (Ohana's `accent-soft`), `scrim`;
  - the three shadows and the motion durations and easing.
- **Theme.** `data-theme="light" | "dark"` sits on `<html>` and is always set to the resolved value. The member's choice (light, dark, or system) is stored in `localStorage`, and "system" follows `prefers-color-scheme` live. An inline script in `apps/web/index.html` sets the attribute before first paint so there is no flash. The Tailwind dark variant becomes `@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));`.
- **Fonts.** `@fontsource-variable/literata`, `@fontsource-variable/golos-text` and `@fontsource-variable/jetbrains-mono`. All three are verified to ship Cyrillic and Cyrillic-ext subsets. Remove `@fontsource-variable/geist`.
- **Icons.** `@hugeicons/react` + `@hugeicons/core-free-icons`, and set `components.json` `iconLibrary` to `hugeicons`. shadcn's generated usage passes `strokeWidth={2}`, but Ohana uses **1.5**, so wrap it once in `src/ui/icon.tsx` and use only that wrapper. Remove `lucide-react` once nothing imports it.
- **Toasts.** Use Base UI's Toast primitive (`@base-ui/react/toast`). Do not use shadcn's `sonner` item, because it pulls in `next-themes` and duplicates our theme provider.
- **Access-code input.** A single text input that formats to `XXXX-XXXX` as the member types, like the prototype (`docs/design/assets/ohana.js`, "код входа"). Do not use segmented OTP boxes: pasting a whole code must just work.
- **Breakpoint.** One layout breakpoint at 920px. Expose it to Tailwind as `--breakpoint-desktop: 57.5rem` and use the `desktop:` prefix. Do not reuse `md`/`lg` for the shell switch.
- **Shared vs feature components.** Only the components in the spec's "Components" list go in `src/ui/`. Domain pieces (entry card, calendar grid, wish actions, photo upload, editor, lightbox) are built later by their feature tickets. The spec's "Reference screens" table says which ticket builds which screen. #6 builds none of the product screens.

## Steps

### 1. Foundations

Replace the stock theme in `apps/web/src/index.css` with Ohana's:

- `src/ui/styles/tokens.css`:
  - every token from the spec, light and dark;
  - the brand constants;
  - motion tokens;
  - shell sizes (sidebar, top bar, tab bar, content widths, page padding).
- `src/ui/styles/glass.css`:
  - `@utility glass` and `@utility glass-liquid`, with the spec's formulas;
  - the fallback to opaque `surface` + `shadow-3` under `prefers-reduced-transparency: reduce` and `@supports not (backdrop-filter…)`;
  - the overlay scrim.
- `src/index.css`:
  - imports the two files;
  - an `@theme inline` block that maps the shadcn roles, the radius scale (8/12/18/26/full, written out, not `calc()` off `--radius`), Ohana's font sizes as `--text-*`, the fonts, shadows, and the breakpoint;
  - base styles: body type, heading roles, `:focus-visible` ring, `::selection`, and the `prefers-reduced-motion` reset.
- The theme provider in `src/app/`, the pre-paint script in `index.html`, and `<meta name="theme-color">` for both schemes using the fallback sRGB values.
- `public/favicon.svg`: replace the Vite logo with `docs/design/ohana-icon.svg`.
- A token contrast test (for example `src/ui/styles/contrast.test.ts`):
  - parse `tokens.css`, convert OKLch to sRGB (`pnpm add -D culori`), and assert WCAG ratios for every text-on-background pair the spec uses, in both themes;
  - body text needs 4.5:1, large text and icons need 3:1;
  - include `muted`, `primary` and each semantic colour on `bg`/`surface`, each pill's text over its tinted fill, `primary-foreground` on `primary`, and text over glass composited on both extremes (white and black backdrops).
  - The light `warn` pill text is the likeliest failure. If a token has to move, change it in `tokens.css` and in the spec's colour table in the same commit, and say why in the PR.

**Done when:**

- No neutral shadcn colour or Geist reference remains.
- The contrast test passes.
- The existing `health-card` and `language-switcher` tests still pass.
- Toggling `data-theme` in devtools switches the palette.
- With reduced transparency emulated, glass renders opaque.

### 2. Icons and mark

- `src/ui/icon.tsx`: the Hugeicons wrapper (stroke 1.5, `aria-hidden` by default, sized by the parent's font size or a `size` prop).
- `src/ui/logo.tsx`: the square mark and the round small-size variant, both inline SVG from `docs/design/assets/ohana.js` (`LOGO_MARK`, `LOGO_ROUND`), plus the wordmark lockup (`.logo` in `ohana.css`).
- For each icon in the spec's list, find the Hugeicons stroke-rounded equivalent. The prototype's paths are Hugeicons paths, so compare by eye. Give `install` a distinct glyph, since the prototype reuses `phone`.

**Done when:** every icon the spec lists renders through `Icon`, and `lucide-react` is removed.

### 3. Restyle the shadcn components

Add them with `pnpm exec shadcn add`. All of these exist in the `base-nova` registry:

- `button`, `input`, `textarea`, `label`, `field`
- `dialog`, `sheet`, `drawer`, `popover`, `dropdown-menu`, `tabs`, `toggle-group`, `tooltip`
- `avatar`, `badge`, `item`, `skeleton`, `empty`, `switch`, `separator`, `spinner`

Restyle every one of them, plus the existing `card`, to the spec. The defaults are much smaller than Ohana's (for example a 32px button, where Ohana's is 44px).

| Component | What to match |
|---|---|
| Button | Variants primary, secondary, ghost, destructive, link; sizes sm, default, lg, icon; press moves it down 1px |
| Input / textarea / field | Heights, focus ring, invalid state with icon, `aria-describedby`, one shake on invalid |
| Dialog | 440px, liquid glass |
| Sheet | Bottom drawer with a grabber below 920px, centred 460px modal from 920px up |
| Popover / menu | Liquid glass, 42px items, danger item, separators |
| Tabs / toggle-group | The pill-shaped `.seg` look |
| Tooltip | Inverted `fg`/`bg` |
| Avatar | Monogram with a per-member `hue` prop; sizes xs, sm, default, lg. Keep the dark colours inside the dark theme only (the prototype leaks them; see the spec's "Known defects") |
| Badge | Becomes the Ohana pill: primary, ok, warn, danger, neutral |
| Item | Becomes the list row: min-height variants replacing the prototype's inline 52/56/60/64/68px, a leading icon tile with a `tone` (neutral `surface-2` or a semantic tint), a danger row, a link row with hover |
| Card | Surface, border, `shadow-1`; link cards lift on hover |
| Skeleton | Shimmer |
| Empty | Round icon plate and a serif heading |
| Switch | 46×28 |

- Keep Base UI's behaviour (focus trap, Esc, ARIA, positioning). Change appearance only.
- Delete the size and variant names Ohana doesn't use instead of leaving dead options.
- Any component text a user sees (a close button's label, for example) goes through `packages/i18n`.

**Done when:** every component in this step has every state from the spec (hover, focus-visible, active, disabled, invalid where relevant) and renders correctly in both themes.

### 4. Ohana-specific components

Put these in `src/ui/`, built on the step-3 pieces:

- `AccessCodeInput`: the format rule from the decisions above, mono 30px, and the invalid state. `CodeDisplay`: shown once, selectable in one tap, with a copy action.
- `SyncStatus`:
  - the six states with the spec's colours and icons;
  - the spinning `sync` icon (not a ring), which stops under reduced motion;
  - compact chip and full forms;
  - an `onRetry` for `unreachable`/`error`;
  - `role="status"`;
  - all text from i18n (ru/en), with time formatted through `Intl.DateTimeFormat`.
- `Toast`: a Base UI Toast viewport and a helper, liquid-glass pill, ok and danger tones. It sits above the tab bar on mobile and bottom-right on desktop.
- The rest:
  - `SectionHeader`;
  - `Banner` (offline notice);
  - `ErrorState` (the empty-state layout with a danger tone and a retry);
  - `CountBadge`;
  - `AvatarStack`;
  - `PickRow` (`aria-pressed` with a check);
  - `Fab` (mobile only, liquid glass).

**Done when:**

- Vitest + Testing Library tests cover:
  - `AccessCodeInput`: typing, pasting a lowercase code with junk characters, the 8-character cap, and clearing the invalid state on input;
  - `SyncStatus`: the retry shown only in the two failure states, and `role="status"`;
  - `Field`: the error linked through `aria-describedby`.
- `pnpm test` passes.

### 5. Layouts

- **Visual shell pieces** in `src/ui/`: `TopBar` (glass, sticky), `TabBar` (glass, fixed, safe-area padding), `Sidebar` (solid, 232px), `AdminTopBar`, `AuthLayout` frame.
- **Assembled layouts** in `src/app/layouts/`:
  - member: tab bar below 920px, sidebar from 920px up;
  - admin: the admin top bar and 960px content;
  - auth: a centred 420px column.
- Layouts take their data as props: space name, visible sections, active section, sync state, user menu actions. Sign-in, section visibility and sync don't exist yet (#9, #13, #14). Do not wire routes or fake stores to them. Only the preview route mounts them in #6.
- The layout must hold with 1 to 4 visible sections. Content reserves space for the tab bar and the FAB.

**Done when:** from 360px to 1920px wide there is no horizontal scroll, and the shell switches exactly at 920px.

### 6. Preview route

- Add a TanStack file route (for example `src/routes/design.tsx` → `/design`), not linked from navigation. It shows:
  - every shared component in every variant and state;
  - the three layouts;
  - the token swatches and type scale.
- It has its own theme switch (light / dark / system) and language switch (reuse `features/language`).
- Demo content comes from the «Наша семья» world, and every string lives in `packages/i18n` under one namespace (for example `designPreview`) in **both** `ru.json` and `en.json`.
- Use no photos from `docs/design/assets/img/`; they must not ship in the client.

**Done when:** every component from steps 3 to 5 appears on `/design` and has been checked by eye in all four theme × language combinations.

### 7. Playwright

- Install `@playwright/test` in `apps/web`, add a `test:e2e` script, and add a CI job that runs it next to the existing checks.
- Specs against the preview route:
  - it renders in light and dark, in ru and en;
  - no horizontal overflow at 360, 390, 820, 1024 and 1440 widths;
  - a focus ring is visible when tabbing through the interactive components;
  - the dialog and sheet trap focus and close on Esc;
  - `AccessCodeInput` formats a pasted code.

**Done when:** the Playwright job runs green in CI.

### 8. Close-out

- Update `docs/design/README.md` for anything that changed on purpose, such as a token adjusted for contrast or an icon substitution.
- Update the web client section of `docs/architecture.md` if the structure differs from what it says (`app/layouts/`, the preview route).
- Check every acceptance criterion in issue #6 against the preview route, and list any you couldn't meet in the final PR.
- Delete this handoff file in the final PR.

**Done when:** every #6 acceptance box can be ticked with a pointer to the code or test that satisfies it, and the only exception is the manual assistive-technology testing the issue itself defers.

## Gotchas

- The prototype uses `data-theme` plus a no-attribute "system" mode. The app always sets the attribute, so drop the prototype's duplicated `@media (prefers-color-scheme: dark) :root:not([data-theme='light'])` blocks. They exist only for pages without the attribute.
- The prototype's liquid-glass layers need their own dark-theme overrides (see `.popover`, `.toast` and `.fab` in `ohana.css`). The shared glass tokens alone don't cover them.
- `apps/web/src/routeTree.gen.ts` is generated by the router plugin when Vite runs (`pnpm dev` or `pnpm build`); run one after adding a route. Don't write it by hand.
- Commit messages end with the `Co-Authored-By` trailer from the session's attribution instructions, and PR descriptions end with the Claude Code line. Branch off `main`, and commit or push only when the human asks.
