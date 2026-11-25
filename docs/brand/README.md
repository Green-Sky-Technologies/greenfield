# Greenfield brand

Greenfield is a Green Sky product. It sits in the same family as the greensky.tech site (near-black
ground, warm off-white type, hairline rules, a 32-unit pixel mark, one green) without copying it.

**Tagline:** Design in the open.

The source of truth for the look is the "Greenfield brand and editor" design canvas. This folder
is a copy for the repo:

| File                                                                                       | What it is                                                         |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| [`mockups/brand-sheet.html`](mockups/brand-sheet.html) / [`.png`](mockups/brand-sheet.png) | The brand sheet: marks, palettes, type, rules                      |
| [`mockups/editor.html`](mockups/editor.html) / [`.png`](mockups/editor.png)                | The editor, dark theme: what the finished product should feel like |

The mockups are static HTML for reference, not app code. Open them in a browser from this folder.
They load the mark files from `apps/web/public/` and fonts from Google Fonts.

## Principles

1. **Square.** No rounded corners in the app chrome (buttons, inputs, panels, menus, avatars).
   Radius belongs to the user's designs, not to ours.
2. **Rules, not cards.** Panels and sections are split by 1 px hairlines. Nothing floats on a
   shadow except menus and the comment composer.
3. **Green is you.** Your selection, focus rings and primary buttons are field green. Nothing else
   in the chrome is green.
4. **Ember is the agent.** Whatever Claude is touching is outlined in ember with a "Claude ·
   editing" tag; values it changed carry an ember marker. You can always tell your edits from the
   agent's (SPEC §9 D24).

## Colour

Two app themes. Dark is the default; light follows the system setting when the user picks it.

| Token    | Dark                     | Light                 | Use                                                                         |
| -------- | ------------------------ | --------------------- | --------------------------------------------------------------------------- |
| `ground` | `#0b0c0a`                | `#f3f0e8`             | Canvas backdrop and app ground                                              |
| `panel`  | `#121410`                | `#fbf9f4`             | Side panels and bars                                                        |
| `raise`  | `#1b1e18`                | `#e8e4da`             | Hover, inputs, menus, cards inside chat                                     |
| `rule`   | `rgba(236,232,222,0.12)` | `rgba(20,21,15,0.12)` | Hairlines between panels and sections                                       |
| `ink`    | `#ece8de`                | `#14150f`             | Headings, values, primary text                                              |
| `body`   | `#b9b5ac`                | `#55534c`             | Labels and secondary text                                                   |
| `field`  | `#3fd67f`                | `#1b733f`             | You: selection, focus, primary action                                       |
| `ember`  | `#ff9a4d`                | `#a54a0f`             | The agent: its edits, its cursor, its turn                                  |
| `danger` | `#f2554f`                | `#8c1515`             | Errors and destructive actions (not on the brand sheet; added in Story 5.3) |

- Text on `field` or `ember` fills is `ground` (dark) for contrast, as in the mockup's Share and
  "Ask Claude" buttons.
- Every text colour above passes 4.5:1 on `ground`, `panel` and `raise` in its theme, including
  11 px labels. Check new pairs before adding them.
- The canvas dot grid is `ink` at 9% opacity, 1 px dots every 16 px.
- The marketing site's `--void` `#070709` is used for the brand sheet and favicon tile; inside
  the app, `ground` replaces it.

## Type

| Face               | Weights              | Where                                                                                              |
| ------------------ | -------------------- | -------------------------------------------------------------------------------------------------- |
| Cormorant Garamond | 300, 400, italic 300 | The wordmark and marketing only. Shared with greensky.tech.                                        |
| IBM Plex Sans      | 400, 500, 600        | All app chrome: 12 px controls, 13 px chat and body, 600 for section and selection heads           |
| IBM Plex Mono      | 400, 500             | Labels (11 px, uppercase, 0.1em tracking), numeric values in fields, shortcuts, file and layer ids |

Use tabular numbers in every numeric field so values don't jump while dragging. All three
faces are on Google Fonts under the OFL.

## Marks and logos

All in `apps/web/public/`. Pixel art: always `shape-rendering="crispEdges"`, and scale in
whole multiples of the grid (CSS `image-rendering: pixelated` when scaling a bitmap of it).

| File                                 | Grid      | Use                                                                      |
| ------------------------------------ | --------- | ------------------------------------------------------------------------ |
| `greenfield-mark.svg`                | 32        | The full mark, at 64 px and up (64, 96, 128, 256)                        |
| `greenfield-mark-on-light.svg`       | 32        | The same on light grounds                                                |
| `greenfield-mark-small.svg`          | 16        | Below 64 px: 16 px in the top bar and tabs, 32 px beside text            |
| `greenfield-mark-small-on-light.svg` | 16        | The same on light grounds                                                |
| `greenfield-favicon.svg`             | 16        | The small mark on a `#070709` tile, so it reads on any tab colour        |
| `greenfield-logo.svg`                | 32 + text | Mark at 96 px with the Cormorant 400 wordmark, outlined (no font needed) |
| `greenfield-logo-on-light.svg`       | 32 + text | The same on light grounds                                                |

The mark is a selection box with four corner handles, with a dithered green field rising inside
it: the blank canvas, already being worked. It shares the Green Sky mark's grid, crisp edges and
bone-on-void colouring. Don't redraw the full mark at sizes between 16-grid multiples; use the
small mark.

**In-app lockup:** the small mark at 16 px (top bar) or 32 px, then "Greenfield" in Cormorant
Garamond 400, about 19 px beside a 16 px mark. Everything else in the app is Plex.

## Voice

Plain and specific. Say what happened and what the user can do next ("Changed 3 layers · Undo
all"), not what the agent felt. The agent is "Claude" in the UI. Labels are short nouns; buttons
are verbs.

## Where this lands in the build

- **Story 9.1:** these files.
- **Story 5.3:** app chrome tokens in `apps/web/src/app/globals.css` (today still the CrunchDesign
  Solarized theme) and `components/logo.tsx`, from the tables above.
- **Story 2.1 and 2.2:** the fork's theme and icons, from the same tokens and marks.

### Note on the editor mockup

The mockup draws the layers and inspector panels as part of the Greenfield chrome. For v1 those
panels are the embedded editor's own, themed in the fork to match (SPEC §9 D20), so the shell
owns only the top bar, agent pane and comment actions. The mockup is the target look for both.
