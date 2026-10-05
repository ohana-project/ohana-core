# Ohana design language

Ohana should feel like a warm family album in your pocket: rose-tinted paper, berry-ink text, one wine-coloured accent («ежевика», blackberry), a book serif for headings, and glass only on floating chrome. This document is the binding description of that language. ADR-0019 records why the interface is built on shadcn/ui and Base UI but restyled into it; `docs/architecture.md` says where the implementation lives.

## What is in this folder

| Path | What it is |
|---|---|
| `README.md` | This document: the rules every screen follows |
| `screens/*.html` | Reference prototypes, one per product screen (27). Open them in a browser to see the intended layout, copy, states, and behaviour |
| `assets/ohana.css` | The prototype's token and component stylesheet, the original source of every value below |
| `assets/ohana.js` | The prototype's runtime: icon sprite, theme switch, app shell, overlays, toasts, access-code formatting |
| `assets/fonts/`, `assets/img/` | Fonts and demo photos, present only so the prototypes render |
| `ohana-icon.svg` | The brand mark, 512×512 master |

Everything here is reference material. The web client never imports from `docs/design/`: tokens, fonts, icons, and components are ported into `apps/web` (see [Implementation](#implementation)). Do not edit the prototypes to match the implementation; when the two disagree on purpose, record the decision in this document.

## Product context and tone

Ohana is a self-hosted family PWA: a shared journal with photos, a family calendar, and wishlists. The canonical demo world, used in every prototype and in the preview route, is the space «Наша семья»: Аня (owner), Дима, Миша, and бабушка Люда. Journal entries «Поход к Чёртову креслу» and «Вареники с бабушкой»; events «День рождения Люды», «Миша — зубной врач», «Ужин у бабушки». Use this world for demo content instead of invented data or metrics.

Atmosphere: paper texture rather than a social network, berry warmth rather than corporate cool, serif headings, monospaced metadata. One screen has one main action. No gradient panels, no emoji as icons.

Russian is the primary language, English the second. The voice is warm and familial, without bureaucratese and without baby talk: «Добрый вечер, Аня», «В её списке уже четыре идеи. Забронируйте подарок тайно, пока его не заняли». Metadata is uppercase mono (`ПОНЕДЕЛЬНИК, 28 СЕНТЯБРЯ`, `ФОТО ×3`). Space names are quoted with «ёлочки». Statuses use plain words: «Актуально», «Офлайн — изменения сохраняются локально». Dates are formatted with `Intl.DateTimeFormat`.

## Colour

All values are OKLch. Derived colours are made only with `color-mix(in oklch, …)`; raw hex is allowed only for the brand mark.

| Token | Light | Dark | Role |
|---|---|---|---|
| `bg` | `oklch(97.6% 0.012 20)` | `oklch(20.5% 0.02 15)` | page background, rose paper |
| `surface` | `oklch(100% 0 0)` | `oklch(24.5% 0.022 15)` | cards, panels, popovers |
| `surface-2` | `oklch(95.4% 0.015 20)` | `oklch(28.5% 0.022 15)` | nested blocks, row hover, skeletons |
| `fg` | `oklch(25% 0.028 20)` | `oklch(93% 0.012 20)` | main text, berry ink |
| `muted` | `oklch(46% 0.026 20)` | `oklch(70% 0.022 20)` | secondary text |
| `border` | `oklch(89.5% 0.018 20)` | `oklch(32% 0.02 15)` | hairlines, dividers |
| `accent` | `oklch(45% 0.13 10)` | `oklch(74% 0.13 10)` | blackberry: primary action, links, active navigation |
| `accent-fg` | `oklch(99% 0.005 15)` | `oklch(21% 0.05 10)` | text on the accent |
| `ok` | `oklch(50% 0.1 150)` | `oklch(76% 0.11 150)` | up to date, success |
| `warn` | `oklch(51% 0.11 70)` | `oklch(80% 0.12 85)` | offline, warnings |
| `danger` | `oklch(52% 0.17 32)` | `oklch(70% 0.14 32)` | errors, deletion |
| `ring` | = `accent` | = `accent` | focus ring |

Derived tokens:

| Token | Light | Dark |
|---|---|---|
| `accent-soft` | `accent` 13% | `accent` 20% |
| `fg-soft` (hover fills) | `fg` 6% | `fg` 9% |
| `scrim` (under overlays) | `fg` 38% | black 55% |

In the dark theme a surface is always lighter than the background, so the page never looks grey.

Brand constants live outside the UI palette: rose `#F5D8D5` and ink `#4A1A48` (the mark and the app icon), and sRGB fallbacks `rgb(246 241 238)` (≈ `bg`, for `theme-color`) and `rgb(117 34 49)` (≈ `accent`).

Text meets WCAG AA: 4.5:1 for body text, 3:1 for large text and icons. The accent appears at most twice per screen, and there is one primary button per viewport.

**Avatars** are monograms, never photos or fake faces. Each member has a warm hue `--hue`; the background is `oklch(88% 0.055 hue)` and the text `oklch(38% 0.08 hue)`, inverted in the dark theme to `oklch(34% 0.055 hue)` and `oklch(88% 0.06 hue)`.

## Typography

| Role | Family | Weights |
|---|---|---|
| Display: headings, entry titles | **Literata** (serif) | 400, 500, 600, 700 |
| Body: interface, entry text | **Golos Text** (humanist sans) | 400, 500, 600 |
| Mono: access codes, dates, metadata, numbers | **JetBrains Mono** | 400, 500 |

All three are self-hosted with Cyrillic, Cyrillic Extended, Latin, and Latin Extended subsets, `font-display: swap`, and a system fallback stack.

| Token | Size | Use |
|---|---|---|
| `display` | `clamp(26px, 3vw, 34px)` | screen greeting, hero headings; `display-lg` is `clamp(22px, 2.6vw, 26px)` |
| `h1` | 24px | Literata 600, line-height 1.22, tracking −0.012em |
| `h2` | 19px | Literata 600, line-height 1.28, tracking −0.01em |
| `h3` | 16px | Golos Text 600, line-height 1.35 |
| `body` | 15.5px | line-height 1.55 |
| `sm` | 13.5px | secondary text, hints |
| `meta` | 12.5px | JetBrains Mono, `muted`, tracking 0.01em |
| `micro` | 11.5px | tab bar labels (`font-medium`), count badges |

Numbers and dates use tabular figures. Headings use `text-wrap: balance`, paragraphs `text-wrap: pretty`, and long Russian words in running text `hyphens: auto`. Navigation items and buttons never wrap; shorten the wording instead.

## Shape, spacing, elevation

| Radius | Value | Use |
|---|---|---|
| `sm` | 8px | chips, badges, small menus, menu items |
| `md` | 12px | buttons, inputs, calendar cells, popovers |
| `lg` | 18px | cards, photos, access-code input |
| `xl` | 26px | sheets, dialogs, lightbox |
| `full` | 999px | avatars, pills, FAB, toasts |

| Shadow | Light | Dark | Use |
|---|---|---|---|
| `shadow-1` | `0 1px 2px` `fg` 7% | black 30% | a card at rest |
| `shadow-2` | `0 6px 20px` `fg` 9% | black 38% | hover lift of link cards and rows |
| `shadow-3` | `0 18px 50px` `fg` 18% | black 55% | floating layers: sheets, dialogs, popovers |

There are no other shadows.

Spacing sits on a 4px grid. Page padding is `clamp(16px, 4vw, 24px)`, card padding 16–22px (default 20px), gaps between blocks 12, 28, and 40px. List rows are at least 52px tall (event rows 64px). Touch targets are at least 44px, except the `sm` and `icon-sm` button sizes (36px, the prototype's `.btn-sm` — the `sm` buttons of dense bars and the administrative bar's theme toggle).

Shell sizes: sidebar 232px, top bar 56px, tab bar 64px (the reserve `--tabbar-h`; the rendered bar is 68px, the prototype's own height — issue #62 gave the glass top hairline back, see Glass), action bar 64px (the floor `--action-bar-h`, which the reserve and the toast lift read; a row of default buttons renders 65px, see Implementation). Content width is 1104px, narrow 760px, wide 1280px; the administrative area uses 960px.

## Glass

Glass is only for **floating** chrome: top bar, tab bar, sheets, dialogs, popovers, toasts, the FAB, the offline banner, and the mobile action bar. It is never used behind long-form text, in the sidebar, or on static cards and badges.

- **Glass**: `backdrop-filter: blur(24px) saturate(1.5)` over `surface` at 90% (92% in dark, so muted, accent and danger text keep AA over black and white backdrops), a 1px `fg` 9% hairline, `shadow-3`, and an inset top highlight of white 28%. The top bar, tab bar, and action bar drop `shadow-3` and keep only the inset highlight. The prototype's tab bar and action bar keep the recipe's 1px top hairline; the tab bar keeps it too (issue #62 — the side and bottom edges stay cut, and the rendered bar is the prototype's 68px), while the action bar drops it (`border-0`), keeping only the highlight.
- **Liquid glass** (the FAB): `blur(20px) saturate(1.7)` over `surface` at 52% (48% in dark), a vertical white sheen, inner highlights, and a gradient rim drawn with `mask-composite`. It stays on the FAB because that is the one glass surface without text: over a 52% fill (48% in dark) small text cannot hold AA even at full opacity — in the dark theme the white sheen alone caps the contrast below 4.5:1 — so popovers, menus and toasts take the plain recipe instead.
- **Overlay scrim**: `scrim` with `blur(12px) saturate(1.25)`.

Every glass surface falls back to opaque `surface` with `shadow-3` under `prefers-reduced-transparency: reduce`, where `backdrop-filter` is unsupported, and wherever text on it would miss AA contrast.

## Iconography

Icons are [Hugeicons](https://hugeicons.com) Free (MIT), stroke-rounded style: 24px grid, stroke 1.5, round caps and joins. The prototype set is `home, book, calendar, gift, user, users, heart, bookmark, camera, image, plus, check, x, chevron-left, chevron-right, chevron-down, more-h, sync, cloud-off, wifi-off, bell, bell-off, repeat, clock, globe, sun, moon, trash, restore, archive, copy, lock, shield, crown, download, share, search, send, edit, log-out, settings, alert, info, file-text, star, eye, eye-off, install, cake, phone, mail, server`. New icons come from the same library and style; emoji are never used as icons. One deliberate substitution: the prototype reuses the `phone` glyph for `install`, so the implementation gives `install` the phone-with-arrow icon instead.

The **mark** is a five-petal flower with a heart, ink `#4A1A48` on rose `#F5D8D5`, on a rounded square (`ohana-icon.svg`). A round-plate variant with a thicker stroke is used at small sizes such as the top bar.

## Motion

| Token | Duration | Use |
|---|---|---|
| `fast` | 120ms | hover, press, colour changes |
| `base` | 200ms | expanding, card lift, overlay fade |
| `slow` | 340ms | sheets, dialogs, toasts |

Easing is `cubic-bezier(0.2, 0.8, 0.2, 1)`. Sheets rise 40px without overshoot, dialogs rise 14px from 98% scale, buttons press down 1px. `prefers-reduced-motion` removes transforms and the sync animation. The sync spinner is a rotating pair of arrows (`sync` icon), never a ring spinner.

## Components

Shared components live in `apps/web/src/ui`. The class names below refer to `assets/ohana.css`.

- **Button** (`.btn`): primary (accent; hover darkens 12%, lightens 10% in dark), secondary (surface, border, `shadow-1`), ghost (hover `fg-soft`), danger (`danger` 12% over `surface`, 16% on hover), link (8px side padding at the default and `lg` sizes, radius `sm`; a `sm` link keeps the `sm` padding, as `.btn-sm` follows `.btn-link`). Text sizes are the prototype's own: 15px, `sm` 14px, `lg` 16.5px. Sizes: default 44px, `lg` 52px full width, `sm` 36px, `icon` 44px round, `icon-sm` 36px round (the administrative bar's theme toggle; both 36px sizes are the touch-target exception above).
- **Input and textarea** (`.input`, `.textarea`): 46px, border darkens on hover, accent border and 3px `accent-soft` ring on focus. The textarea is at least 110px.
- **Field** (`.field`): label in `sm`/`muted`, hint in `meta`. When invalid, the border and ring turn `danger`, an error line with an icon appears under the field and is linked with `aria-describedby`, and the input shakes once.
- **Access-code input** (`.code-input`): 68px, JetBrains Mono 30px, tracking 0.18em, centred, uppercase; formats to `XXXX-XXXX` while typing (Latin letters and digits only). **Code display** (`.code-display`): a code shown once, mono, dashed accent border over `accent-soft`, selectable in one tap.
- **Card** (`.card`): surface, border, `shadow-1`, radius `lg`, padding 20px. Link cards lift on hover (`shadow-2`, −1px).
- **List and list row** (`.list-row`): at least 52px; a leading icon (20px, often in a 38px `md`-radius tile tinted `surface-2` or a semantic colour), title and subtitle, trailing content. A danger row colours its icon and title `danger`. **Pick row** (`.pick`): a selectable row with an accent check driven by `aria-pressed`.
- **Section header** (`.sec-head`): an `h2` with a trailing accent link.
- **Pill** (`.pill`): mono 11px uppercase on `accent-soft`; variants ok, warn, danger, neutral. **Count badge**: mono 11.5px on `fg-soft`.
- **Avatar**: 40px, `sm` 32, `lg` 56, `xs` 24, with monograms of 15, 13, 20 and 11px; **avatar stack** overlaps by 8px with a 2px page-background rim, wherever the stack is placed.
- **Sync status** (`.sync[data-state]`), six states:

  | State | Colour | Text (ru) |
  |---|---|---|
  | `first` | accent icon, muted text, spinning | Первая синхронизация… |
  | `updating` | accent icon, muted text, spinning | Обновляется… |
  | `synced` | ok | Актуально · 14:32 |
  | `offline` | warn | Офлайн — изменения сохраняются локально |
  | `unreachable` | danger | Сервер недоступен · Повторить |
  | `error` | danger | Ошибка синхронизации · Повторить |

  «Повторить» is a link button. On mobile the top bar shows a compact chip (icon only at 430px and below); the full form appears on the home screen and in settings. On desktop it sits in the sidebar footer.
- **Overlays**: the sheet is a bottom drawer with a grabber on mobile (radius `xl` on top, max 86% height) and a centred 460px modal on desktop. The dialog is 440px. The popover and menu sit on the plain glass recipe, with 42px items and separators. The lightbox shows a photo on a black 72% scrim with a mono caption. Dialogs trap focus and close on Esc.
- **Toast**: glass pill with an ok or danger icon; it sits above the tab bar on mobile and bottom-right on desktop, and hides after about 3 seconds.
- **Tooltip** (`[data-tip]`): inverted `fg` on `bg`, radius `sm`, `meta` size.
- **Switch** 46×28 with an accent track when on. **Segmented control** (`.seg`): pill buttons on `surface-2`, the active one on `surface` with `shadow-1`.
- **Banner** (`.banner`): `warn` 14% over surface, for the offline notice. **Skeleton** (`.skel`): shimmering `surface-2`. **Empty state** (`.empty`): 64px round icon plate, Literata 18px heading, short muted text, optional button.
- **FAB**: 56px liquid glass with an accent icon, mobile only.
- **Note block** (`.venue-note`): the soft-accent box with a 22% accent hairline — `primary-soft` fill, radius `lg`, 16px padding, a 14px gap, and a 20px accent icon over `sm` body text (issue #61). Home, the wishlist screens and the invite screen mount it.
- **Action bar** (`.editor-bar` in the prototype): the bar glass recipe, fixed directly above the tab bar and holding a screen's main actions below 920px; hidden from 920px, where the same actions live in the top bar. The journal editor, the event screen and the event editor mount it.

Domain-specific pieces (entry card, photo strip and grid, upload chip, calendar month grid and agenda, wish actions, editor title and text) belong to their features, not to `ui/`. Build them from the shared components and tokens when their ticket is implemented.

## Layout

- **Mobile (below 920px)**: a glass top bar (back arrow on a screen below its feed, space switcher, title, sync chip, user menu), content, and a glass tab bar with the visible sections (Главная, Дневник, Календарь, Вишлисты). Hidden sections simply disappear from navigation, and the layout must hold with one to four sections. The content reserves space at the bottom for the tab bar and FAB.
- **Desktop (920px and wider)**: a solid 232px sidebar (space switcher, sections, sync in the footer), a page top bar that takes the screen's desktop-only actions — the prototype's `d-only` buttons; below 920px a screen's FAB or action bar carries them — and two-column "feed + details" layouts (`1.6fr / 1fr` with a sticky side column; the home screen uses `1.55fr / 1fr` with the journal on the left). Keyboard shortcuts: N for a new entry, / for search.
- **Administrative area**: a calm solid top bar with the mark and «Админка», content up to 960px, no tab bar or sidebar.
- **Sign-in screens**: a centred column up to 420px with the logo on top and a footer note.

There is one layout breakpoint, 920px. Components adapt to their container where that is simpler. Nothing scrolls horizontally from 360px up.

## Accessibility and i18n

- Every interactive element has a visible `:focus-visible` ring (2px `ring`, 2px offset).
- The interface works fully from the keyboard; dialogs trap focus and close on Esc.
- Interactive elements carry the right ARIA (`aria-pressed`, `aria-label`, `aria-current`, `role="status"` for sync and banners).
- Colour is never the only signal: errors and states also carry an icon or text.
- Every string comes from `packages/i18n` in Russian and English, and keys are never concatenated.

Full accessibility validation still needs manual testing with assistive technology.

## Anti-patterns

- Raw hex outside the brand mark; colours outside the tokens and `color-mix`.
- Glass under long text, in the sidebar, or on static cards and badges.
- A second primary button in the viewport, or several solid buttons in one row.
- Ring spinners for sync; emoji instead of icons; icons from another library or style.
- Photo avatars or fake faces.
- Gradient panels and shadows outside the three steps.
- One radius for everything; sharp corners in icons.
- Wrapped text in navigation and buttons.
- Invented metrics and filler content instead of the «Наша семья» demo world.

## Reference screens

Each screen is implemented in the ticket that delivers its behaviour, as its own route, from the shared components and tokens. Match the prototype's layout, copy, and states; replace demo data with real data.

| Prototype | Ticket |
|---|---|
| [`admin-login`](screens/admin-login.html) | #7 Instance administrator sign-in |
| [`admin-spaces`](screens/admin-spaces.html), [`admin-space`](screens/admin-space.html), [`admin-settings`](screens/admin-settings.html) | #8 Spaces and members in the administrative area |
| [`code-entry`](screens/code-entry.html), [`onboarding`](screens/onboarding.html) | #9 Access codes and member sign-in |
| [`accounts`](screens/accounts.html) | #10 Several sign-ins on one device |
| [`install`](screens/install.html) | #11 Installable PWA shell |
| [`members`](screens/members.html), [`member-card`](screens/member-card.html), [`invite`](screens/invite.html), [`space-settings`](screens/space-settings.html) | #12 Owner management of members and codes, #23 archiving and restoring |
| [`diary`](screens/diary.html), [`diary-entry`](screens/diary-entry.html), [`diary-editor`](screens/diary-editor.html), [`drafts`](screens/drafts.html) | #15 Journal entries, drafts, and publishing (photos: #17) |
| [`trash`](screens/trash.html) | #16 Journal trash |
| [`wishlists`](screens/wishlists.html), [`wishlist-mine`](screens/wishlist-mine.html), [`wishlist-person`](screens/wishlist-person.html) | #18 Wishlist: wishes |
| [`wishlist-favorites`](screens/wishlist-favorites.html) | #19 Gift favorites and gift reservations |
| [`calendar`](screens/calendar.html), [`event`](screens/event.html), [`event-editor`](screens/event-editor.html) | #20 One-time events; #21 repeating events and occurrence exceptions |
| [`settings`](screens/settings.html) | #22 Calendar reminders (notification settings) |
| [`home`](screens/home.html) | #9 Access codes and member sign-in (the home shell with section navigation; the journal and events columns fill in with #15 and #20) |
| [`profile`](screens/profile.html) | not yet assigned |

### Known defects in the prototypes

Do not carry these into the implementation:

- `ohana.css` applies the dark avatar colours to `:root:not([data-theme='light']) .avatar` outside the dark-scheme media query, so pages without a `data-theme` attribute show dark avatars in the light theme.
- The admin login prototype lacks the theme toggle every other sign-in screen carries; the implementation pins the toggle on the shared auth layout, so the administrative sign-in carries it too (issue #63).
- `admin-settings.html` defines a glass pill (`.pill-glass`) on a static element, which breaks the glass rule. Use an ordinary ok pill.
- The launcher's sync demo colours `unreachable` as a warning; the real sync status uses `danger`, which is correct.
- The `phone` and `install` icons use the same glyph.
- `.dark-mode` in `ohana.css` is an unused selector.
- The admin-space prototype's «Коды приглашения» rows print the plaintext code (MISH-QPRT) and promise a 7-day lifetime. Only the code's hash is stored and the plaintext is shown once at issuance, so the implemented rows name the member and show the status instead, and the copy follows ADR-0005's 24-hour, one-sign-in rule. The prototypes' «Код приглашения» wording becomes «Код входа» / "Access code", following the CONTEXT.md term. The revoke dialog names the member in nominative-safe phrasing for the same reason as above.
- The prototypes use inline styles for repeated patterns (row heights, the 38px icon tile, 34px avatars, section labels). In the implementation these are component variants, never one-off styles.
- The admin login prototype's field hint promises «по умолчанию вход только с localhost»; no localhost-only restriction exists, so the implemented hint keeps only «Выдаётся при первом запуске сервера». Ticket #8 folded the password screen into `admin-settings`; the old `/admin/password` address redirects there.
- The admin-spaces prototype decorates each space row with an avatar stack of the members' monograms. The administrative spaces listing carries only a member count, not the members themselves, so the implemented rows show the space's own monogram instead. The confirmation dialog's «Сделать Диму владельцем?» declines a hard-coded name; ICU interpolation cannot decline names, so the implemented copy uses nominative-safe phrasing («{name} станет владельцем?»). The regular-role pill reads «УЧАСТНИК» in the prototype; the implementation says «Обычный участник» / "Regular member", following the CONTEXT.md term instead of the ambiguous short form. The time-zone picker lists every IANA zone the runtime knows with an English city name and a current UTC offset; the prototype's short hand-picked «Москва (UTC+3)» list returns with ticket #20's event editor if a curated list proves necessary. The header's subtitle names the demo host («на ohana.smirova.ru»); the instance's hostname is deployment data no API carries, so the implemented line keeps the count and the installation's trash retention. The rows' subtitles count entries in the prototype («128 записей»); the administrative listing carries no per-space entry count, so the implemented rows stop at the member count and the creation date. The create sheet's subtitle promises «Семья получит код приглашения после создания»; a space holds no code of its own — members' codes are issued inside the space (ADR-0005) — so the implemented line says where members and codes are added. At 390px the prototype's own header row overflows its viewport by about 17px (Chromium, fonts loaded) — title, gap and the «Новое пространство» action cannot share the row; the implementation keeps the no-horizontal-scroll rule, so the title block narrows to the title first and the action wraps beneath when the two truly cannot share the row.
- The drafts prototype's delete dialog claims «черновики не попадают в корзину»; ADR-0007 says the opposite — the author trashes their own entry, whether draft or published, and a trashed draft stays visible only to its author. The implemented copy follows the ADR: drafts move to the trash, with the same recovery window as any entry.
- The admin-settings prototype's trash hint promises «У каждого пространства своё расписание очистки»; the retention the instance administrator sets is one installation-wide value (issue #16), so the implemented hint keeps only the promise this installation makes.

## Implementation

Rules for `apps/web`:

- Tokens are CSS custom properties under `apps/web/src/ui/styles/` and are exposed to Tailwind through `@theme`.
- The class merger (`apps/web/src/lib/cn.ts`) is taught every step of the type scale, so a `text-<step>` size and a text colour passed together both survive merging, in either order; the steps it knows are kept in step with the `--text-*` tokens of `src/index.css` by a test (`src/lib/cn.test.ts`). Components import the merger only from `@/lib/cn`; Biome's `noRestrictedImports` in `apps/web/biome.json` enforces it. A custom leading goes after the step (`cn('text-meta', 'leading-4')`), since a size answers for its own line height. A second test (`src/ui/styles/colour-utilities.test.ts`) compiles the client's real stylesheet and fails on any colour utility that generates no rule — colour names are the ones the `@theme` block declares (`background`, `primary-soft`, …), not raw token names.
- The Ohana tokens fill the shadcn roles: `background` ← `bg`, `card` and `popover` ← `surface`, `primary` and `ring` ← `accent`, `destructive` ← `danger`, `border` and `input` ← `border`, `muted-foreground` ← `muted`. shadcn's `accent` role (a subtle hover fill) takes `fg-soft`, so it never collides with Ohana's brand accent.
- The theme is `data-theme="light" | "dark"` on `<html>`. It is persisted per device and follows `prefers-color-scheme` until the member chooses. The browser chrome (`theme-color`) follows the resolved theme too: `rgb(246 241 238)` in light, `rgb(117 34 49)` in dark (the sRGB fallbacks of "Colour"); the pre-paint script and the provider collapse `index.html`'s two media-keyed metas onto the resolved theme, so an explicit choice beats the system scheme there as well.
- Fonts come from the `@fontsource` packages, and icons from the Hugeicons React package.
- Icons take the size their context dictates by default, so callers do not need to pass one. The containers own the sizing rules (buttons and menu items 18px, list-row leading icons and pick checks 20px, list-row trailing icons 18px, pills 12px, the empty-state plate 28px, the tab bar's 40×28 plate a 24px glyph), an unsized icon follows the surrounding text (1em) where no container rule applies, and an explicit size still wins — through the `size` prop or a `size-*` class (other width/height classes override the 1em fallback but do not opt out of a container's rule). The prototype's `icon()` helper stamps a 20px default on every icon and lets the CSS shrink it; the implementation deliberately inverts that — no global default, the context owns the size — so an icon running inside text follows that text's size instead of the prototype's hand-set pixel attributes (the install steps' inline glyphs render at 13.5px, not the prototype's 14px).
- A preview route shows every shared component in both themes and both languages.
- The shells carry the theme toggle (issue #63): a round ghost icon button whose glyph shows the theme one tap away — the moon in the light theme, the sun in the dark, like the prototype's `data-action="theme"` buttons — and whose accessible name names that theme. The auth layout pins the 44px round at the viewport's top right of every sign-in screen; the administrative bar ends with the 36px round, which enters the button's sizes as `icon-sm` (the prototype's `.btn-icon.btn-sm` composition); and the user menu carries «Тема» and «Сменить пространство» as items between the prototype's hairlines. The menu keeps the implementation's own entries in the first group — the members screen, the owner's space settings, notifications — because the prototype's «Профиль» screen has no ticket yet; the groups stay «destinations | theme, switch space | sign out».

The administrative screens follow their prototypes (issue #79). The bar holds the prototype's 56px through a min-height, with the word mark at the prototype's own 16.5px (outside the type scale, like the button sizes), and every action in it is a 36px round — the settings and sign-out entries share the theme toggle's `icon-sm`, so the bar never wobbles. A space's screen passes the bar `back`, and the lockup gives way to «‹ Пространства» — an 18px muted chevron and a small muted label, like the prototype's `admin-space`. The administrative sign-in opens with the prototype's brand row — the lockup and the «АДМИНКА» pill on one row, 26px above the title — so the auth frame's centred logo steps aside for it (`logo={false}`); the frame's footer note sits inside the 420px column, like the prototype's `.auth-foot` inside `.auth-card`, on every sign-in screen. The spaces header is a centred `row-between`, its subtitle carrying the count and the installation's trash retention, and the rows are the list card's 68px rows led by the space's 40px monogram; the create sheet rides the shared sheet — no close X, the prototype's grabber spacing.

Some component values are the prototype's own, outside the type scale: the button's text sizes (15px, `sm` 14px, `lg` 16.5px) and the avatar monograms (11, 13, 15 and 20px for the 24, 32, 40 and 56px avatars). The class merger treats such one-off pixel sizes as sizes, so they survive beside a text colour like any step (asserted in `src/lib/cn.test.ts`). The avatar stack's rim is 2px of the page background and each avatar after the first overlaps by 8px wherever the stack is placed; the top bar hides the sync chip's text at 430px and below with `sr-only` rather than the prototype's `display: none`, so screen readers keep the status words. The focus ring rounds to the small radius: the global `:focus-visible` rule sets `border-radius: var(--radius-sm)`, so elements without a radius of their own take it while focused and a component's own radius utility wins.

Three token values moved from the prototype for WCAG AA, kept in the same commit as the contrast test that requires them (`apps/web/src/ui/styles/contrast.test.ts`): light `ok` is 50% (not 52%) and light `warn` is 51% (not 54%), because those pills' text must hold 4.5:1 over their tints, and dark `accent` is 74% (not 72%), because the primary pill's text must hold 4.5:1 over `accent-soft` on surface. The glass fill is 90% in light and 92% in dark (not the prototype's 76%) for the same reason: text on glass must keep 4.5:1 over the worst-case backdrops, and light `danger` (the failed sync label, destructive menu items) misses 4.5:1 over a black one below 88% (90% keeps a margin); `ok` and `warn` reach glass only as icons and need 3:1. The pill and banner fills and the hover accent (`accent-strong`: 12% darker in light, 10% lighter in dark) live as derived tokens (`--ok-fill`, `--warn-fill`, `--danger-fill`, `--accent-fill`, `--neutral-fill`, `--danger-tint`, `--banner-*`) so the components and the contrast test read the same values. Fills that carry text (the pills, the danger button and the destructive menu item's highlight) mix into `surface` rather than toward transparent, so they are opaque: they can sit on glass, in a sheet or a dialog footer, and a see-through tint there lets a black or white backdrop pull danger text down to about 3.8:1. The danger button's hover is 16% (not 20%), because at 20% its text misses 4.5:1 even on plain `surface`.

The shadcn `accent` role is the fg-soft hover fill everywhere the prototypes draw one, and a test (`apps/web/src/ui/styles/accent-role.test.ts`) refuses the role in feature code except as a background behind hover, focus or active — never as a text colour, a resting fill, or any other utility colour (icon fill, stroke, border, ring, outline, underline, caret, gradient stop) — along with the non-existent `accent-soft` utility (the soft accent tint's class is `primary-soft`). Until ticket #66 rebuilds the wishlists overview's rows (the prototype leads the own list with the member's avatar and the favourites link with a bare accent heart), that screen's two rows keep their leading tiles, rendered as solid accent tiles — the brand accent, not the grey hover fill the `accent` role produced before (issue #57). Until ticket #73 draws the filled accent circle behind today's number, the calendar's today cell is tinted with `primary-soft` (13% in light, 20% in dark) rather than the prototype's 7%.

Cards come in three forms beside each other (`variant` on the shared card, issue #58): the `default` the first screens were built on — vertical padding, a gap between blocks, side padding coming from its header and content slots —, the prototype's padded card (`.card-pad`: 20px on all sides, no forced gap; the content sets its own rhythm), and the list card (`.card.list`: no padding, rows flush, the corners clip them). The padded form takes plain children — its own 20px would double with the header, content and footer slots' side padding —, and the list form takes rows only. Keeping the default beside the prototype's two forms is deliberate: screens built before the forms existed stay untouched, and new screens pick a form explicitly. The prototype's inline row heights (52, 56, 60, 64, 68px) are the list row's `size` variants; a leading icon is bare by default — muted, like `.list-row .leading` — and the 38px tinted tile is opt-in through `variant="icon"`, so an avatar never sits on a tinted square; the tile's tint comes from the tone, and a tone on a bare icon colours it without a square behind it, like the prototype's accent heart in the wishlists row. The empty state stands on its own without a card, and its action button belongs in the empty state's content slot, never inside the round icon plate.

Overlays carry the prototype's overlay values (issue #59). Sheets and dialogs ship no close X — they answer Esc and a scrim tap, and Base UI traps focus; a screen that needs an explicit dismiss renders `DialogClose` or `SheetClose` itself (the photo lightbox keeps its own round X, like the prototype's). The sheet grabber keeps the prototype's `margin: 6px auto 14px` inside the drawer's 8px top padding, with the content gap in a body wrapper so the margins are exact; the mobile drawer draws only its top hairline (the `!` on the border utilities beats the glass recipe, which sorts after plain classes) and the desktop modal the full one, and the whole popup scrolls, so the bottom padding always follows the last child. The dialog footer is the prototype's confirm row: buttons side by side at every width, each grown to an equal width, 10px apart, 18px below the text — the content grid's 16px plus the footer's own 2px — so a single button sits full width, like the prototype's form-sheet actions; the row's `min-w-0` is the prototype's own `.grow { flex: 1; min-width: 0 }`, and the row's one deviation is the label: a multi-word label too long for its half wraps, where the prototype's `.btn` is `white-space: nowrap` and would overflow; a single long word runs into its own button's padding but stays inside it down to the 360px floor. Menu items take the prototype's component-scoped 14.5px (between the `sm` and `body` steps, so no `--text-*` token of its own) with the separator's `margin: 6px 4px`; the popover is as wide as its content, never below 208px; the toast is icon and text only at 14.5px — it hides itself after about three seconds and answers a swipe, with no close control. The other deliberate deviation from the prototypes: dialog titles and text stay left-aligned, where the prototype centres a dialog's text (`.overlay.center` sets `text-align: center` on every `OHANA_DIALOG` and `OHANA_CONFIRM`) — the app's dialogs also carry small forms, whose centred labels would not work.

The shared note block and the mobile action bar (issue #61) port `.venue-note` and `.editor-bar` verbatim, with two deliberate deviations beyond the bar-glass recipe's dropped top hairline (see Glass). First, the action bar's offset adds `env(safe-area-inset-bottom)` to the prototype's `bottom: var(--tabbar-h)`, so it sits above the tab bar's safe-area padding on notched phones instead of sliding under it; the member layout's bottom reserve becomes tab bar + safe-area inset + the bar's `--action-bar-h` floor + a 16px gap (replacing the plain 28px) for any screen that mounts it, and the toast viewport lifts by the inset plus the same floor, landing on that same offset while a bar is mounted, so a toast fired from a bar action never covers the buttons it reports on. Second, the bar carries a `min-height` of `--action-bar-h` (64px) that the prototype does not set, so the reserve and the lift read one token; a bar taller than the floor (the demo's default-button row renders 65px) eats into that gap. In the prototype the bar's lowest few pixels tuck under the tab bar's glass (its 64px offset against the 68px bar); the implementation keeps that flush sit against the 68px tab bar, with the tab bar painted over the tuck.

The member shell's data is built in one place (issue #62): `useMemberShell` (apps/web/src/features/member) hands every member area — home, journal, calendar, wishlist, space settings — the same space summary, section navigation, sync state and user menu, so the top bar and sidebar are identical everywhere and no area passes an empty monogram list. The stack carries the first two active members' monograms, the owner leading and the rest by creation — the store reads rows in key order, so the order is the builder's decision, not the storage's — and falls back to the signed-in member alone while nothing is downloaded; the sidebar's count line («4 участника · вы владелец») waits for a downloaded partition rather than inventing a count from the registry. The back arrow is the prototype's `.btn.btn-icon.m-only`: a real link wearing the button's `icon` classes — Base UI's `render` prop would have made it a button in a link's clothing — with the 18px chevron the button's own container rule sizes, shown below 920px only. A screen's top-bar actions that the prototype marks `d-only` ride a `desktopActions` slot rendered `hidden desktop:contents`: no display below 920px, direct flex items above. The mobile top bar carries the prototype's 1px `fg` 8% bottom hairline (the border token from 920px up), the switcher hugs its stack (`width: auto; padding: 0 6px; margin: 0 -6px` on the 44px round), the sidebar's chevron is the prototype's 20px, and an active nav item carries its own hover — the prototype declares `.nav-item.is-active` after `:hover`, and the implementation makes that order explicit instead of relying on Tailwind's variant order. Home's top-bar title is the space name, like the prototype's `data-title` on home.html.

## Licences

- **Literata, Golos Text, JetBrains Mono**: SIL Open Font License 1.1.
- **Hugeicons Free**: MIT.
- **Demo photos** in `assets/img/`: Unsplash License. They are used only in the prototypes and never ship in the web client.
