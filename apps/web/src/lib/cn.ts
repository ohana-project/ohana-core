import { createCn } from 'cn/config'

/*
 * The app's class merger, taught the Ohana type scale. tailwind-merge
 * (and the `cn` engine it configures) only knows the default Tailwind
 * text sizes, so it reads every custom --text-* step of src/index.css
 * as a text colour: `text-meta` beside `text-muted` then deletes the
 * size — or the colour, in the other order. Declaring the steps as a
 * font-size group keeps size and colour independent (docs/design/
 * README.md, "Typography"; issue #56).
 *
 * TYPE_SCALE must name every --text-* token of src/index.css — `sm`
 * re-states a default Tailwind name (the theme re-values it to 13.5px),
 * the rest are Ohana-only; the sync is asserted in cn.test.ts.
 */
export const TYPE_SCALE = [
  'display',
  'display-lg',
  'h1',
  'h2',
  'h3',
  'body',
  'sm',
  'meta',
  'micro',
] as const

export const cn = createCn({
  extend: {
    classGroups: {
      'font-size': [{ text: [...TYPE_SCALE] }],
    },
  },
})
