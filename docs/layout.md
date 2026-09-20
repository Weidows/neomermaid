# Layout — better habits without new syntax

NeoMermaid never asks you to learn a new diagram language. Everything on this page
maps onto mermaid's own layout knobs (or a documented, reversible rearrangement of
the header), so the same source renders identically in the official preview.

```ts
render(source, {
  layout: {
    direction: 'auto',      // 'auto' | 'TB' | 'TD' | 'BT' | 'LR' | 'RL'
    nodeSpacing: 45,        // gap between sibling nodes, px
    rankSpacing: 45,        // gap between ranks, px
    wrappingWidth: 200,     // label line-break width, px (0 disables)
    curve: 'basis',         // basis | linear | step | cardinal | monotone
    diagramPadding: 8,      // canvas padding on top of `padding`
    maxAspect: 3.2,         // see "auto direction" below
  },
  contrast: 'aa',           // legibility guarantee, see theming.md
});
```

## Auto direction

A flowchart with no direction in the source is laid out top-to-bottom by mermaid.
For a wide graph that produces the classic 4:1 letterbox strip that is unreadable
in a README or a slide. NeoMermaid measures the first result and, **only when the
source did not state a direction**, tries the other orientation:

| step | result |
| --- | --- |
| source `flowchart` + 1 root → 8 services → 1 store | first attempt `TB` → 1544 × 438 (3.5:1) |
| same diagram, auto | re-rendered `LR` → **696 × 832**, warning `layout: re-rendered LR — the 3.5:1 TB attempt read badly` |

Rules, in order:

1. A direction written in the source always wins (`flowchart LR` stays `LR`).
2. `layout.direction: 'TB'` forces it, replacing whatever the source said
   (use this to switch off auto behaviour entirely).
3. `auto` only re-aims when the source was silent **and** the result is more
   extreme than `maxAspect`, and it keeps the attempt whose aspect ratio is closer
   to 1.6.
4. If the alternative render fails, the first one is kept with a warning.

`TD` and `TB` are synonyms to mermaid; NeoMermaid treats them as equal so it never
flips a diagram for a cosmetic difference.

## Spacing and line breaking

`nodeSpacing` / `rankSpacing` are the two levers that fix most "my diagram looks
cramped" complaints — mermaid's defaults (45/45) are tuned for dense engine
diagrams, not for documentation screenshots. `wrappingWidth` controls where long
labels break; leave it unset to use mermaid's own 200px default, or pass `0` to
disable wrapping and get one long line per label.

CLI equivalents: `--direction`, `--node-spacing`, `--rank-spacing`, `--wrap`,
`--curve`, `--max-aspect`. The render result reports the direction actually used
(`direction` in the JSON payload) and warns whenever it re-aimed.

## What is *not* automatic

- **Semantics.** NeoMermaid never reorders, merges or rewrites nodes and edges.
- **Silent surprises.** Every rearrangement adds a `warnings[]` entry you can
  surface in CI (`neomermaid render … --json`), so a diagram that quietly changed
  shape is visible.
- **Other families.** Auto direction applies to `flowchart`/`graph`. State
  diagrams, sequences and the rest keep exactly the arrangement mermaid gives them.
