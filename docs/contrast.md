# Contrast and legibility

The single ugliest failure mode a themed renderer can have is text you cannot
read: a white label on a light series colour, a dark label on a dark band. It is
also invisible in a screenshot diff and easy to ship — which is exactly why
NeoMermaid treats it as a *computed guarantee* instead of a design opinion.

## How it works

`contrastRatio()` composites colours the way a reader sees them (page → canvas →
surface → glyph, so translucent "glass" panels resolve correctly), then the ratio
is compared with the WCAG thresholds:

| level | body text | large text / connectors |
| --- | --- | --- |
| `aa` (default) | 4.5:1 | 3:1 |
| `aaa` | 7:1 | 4.5:1 |
| `off` | no adjustment (pixel-exact) | — |

At render time every text token is measured against each surface it is painted on;
a token that already passes is returned **untouched** (themes keep their intended
values), and one that fails is moved along its luminance axis by the smallest
amount that passes (`ensureContrast`). Connectors are treated as meaningful
graphics; node borders only at `aaa`, because a hairline border is decorative
while an arrow is not.

```ts
await render(src, { preset: 'glass/dracula' });              // aa
await render(src, { preset: 'glass/dracula', contrast: 'aaa' });
await render(src, { preset: 'glass/dracula', contrast: 'off' }); // exact colours
```

## Series colours

Multi-series families (pie slices, git branches, timeline bands, gantt sections)
are the hard case: the fill is a saturated hue, and one *fixed* label colour can
never work on all of them. `readableSeries()` pairs every fill with the better of
the two poles (`#111418` / `#ffffff` — compared by ratio, not by a luminance
threshold near the crossover where both are ~4.5:1), and when even that fails it
nudges the **fill** along its luminance axis, keeping the hue, until a legible
label exists. `maxAdjust` caps that move so a palette never stops looking like
itself.

Pie labels are a special case because the label colour cannot be chosen per slice
in CSS at all: the post-processor pairs `text.slice` elements with the
`path.pieCircle` slices *by index* and repaints each label from the fill it sits
on (`repaintSeriesLabels`). The git/timeline equivalents are set as numbered
mermaid variables **and** re-emitted as CSS rules, because NeoMermaid's own
generic `text { fill: … }` rule otherwise wins on specificity and flattens every
label to one colour — that specific interaction is what produced the 1.01:1 bug.

## Verifying, not trusting

```bash
npm run audit:legibility          # matrix: every theme × dark/light palettes + every palette
npm run audit:legibility:all      # every theme × every palette × every example
```

The audit rasterises each diagram in a real browser, then for every text element
compares the glyph colour with the colour actually painted behind it — preferring
the *declared* fill of the shape the label sits in (with a geometric containment
check, so a legend colour swatch beside a label is not mistaken for its backdrop)
and falling back to sampled pixels. It exits non-zero when anything is below its
threshold, so CI can gate on it.

Known limits, stated plainly:

- Anti-aliasing and shadows make pixel sampling on very small shapes noisy; that is
  why the declared surface is preferred when a label is genuinely contained.
- Gradients and photographic backgrounds are out of scope: `maxAspect`-style
  guarantees only cover solid and translucent surfaces NeoMermaid itself paints.
- `aaa` on a mid-tone brand colour can force a visible shift; use `off` when brand
  fidelity matters more than contrast.
