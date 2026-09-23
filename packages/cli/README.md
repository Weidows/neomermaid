# @neomermaid/cli

**Render Mermaid diagrams to beautiful PNG / SVG / PDF — and to text — from the terminal.**

Same Mermaid syntax, none of the 2018 styling. Built for people who want a diagram in a
README, and for agents that need one without an image.

- **No Chromium download** — it reuses a Chrome or Edge already installed on the machine
- **120 looks** — 6 themes × 20 palettes (`--preset tech/dracula`, `--preset glass/catppuccin-latte`)
- **Readable by construction** — text colours are measured against their backgrounds (WCAG)
  and fixed when they fail; `--contrast aaa` for the strict bar
- **Agent-friendly** — `--json` on every command, stable payloads, non-zero exit on failure
- **ASCII output** — `neomermaid ascii diagram.mmd` prints Unicode box drawing

## Install

```bash
npm install -g @neomermaid/cli
```

Requires Node 20+ and a local Chrome/Edge (auto-detected; override with `CHROME_PATH` or
`NEOMMERMAID_BROWSER`).

## Usage

```bash
# SVG (default), PNG, PDF, or a standalone HTML page
neomermaid render diagram.mmd -o diagram.svg
neomermaid render diagram.mmd -o diagram.png --preset neon/dracula --scale 2
neomermaid render diagram.mmd -o diagram.pdf --format pdf

# from stdin, into a pipe
cat diagram.mmd | neomermaid render - -o - --format svg > out.svg

# text output an agent or a terminal can read
neomermaid ascii diagram.mmd --width 104 --colour

# explore what is available
neomermaid themes          # 6 themes
neomermaid palettes        # 20 palettes
neomermaid presets         # all 120 combinations
neomermaid examples        # the built-in example corpus
neomermaid doctor          # browser + bundle diagnostics

# render a whole directory × several presets (used by this repo's CI)
neomermaid gallery examples -o .gallery --presets neon/dracula,tech/nord --scale 1
```

### Flags worth knowing

| flag | what it does |
| --- | --- |
| `--preset <theme>/<palette>` | the look; `--theme`/`--palette` also work separately |
| `--background <css\|transparent\|theme>` | `transparent` for diagrams on their own page |
| `--canvas <solid\|gradient\|grid\|dots\|transparent>` | the surface behind the diagram |
| `--scale <n>` | raster scale for png/pdf (default 2) |
| `--contrast <aa\|aaa\|off>` | legibility guarantee (default `aa` = 4.5:1) |
| `--direction <auto\|TB\|BT\|LR\|RL>` | `auto` re-aims a flowchart whose source states none |
| `--node-spacing`, `--rank-spacing`, `--wrap`, `--curve`, `--max-aspect` | layout, without touching the source |
| `--stroke-width`, `--edge-width`, `--radius`, `--edge-dash`, `--font-family`, `--uppercase`, … | per-token style overrides |
| `-j, --json` | machine-readable result (includes `direction` and `warnings`) |
| `--embed` | include the SVG in the JSON payload |

### For agents

```bash
neomermaid render diagram.mmd -o diagram.png --preset tech/dracula --json
```

```json
{
  "ok": true,
  "preset": "tech/dracula",
  "direction": "LR",
  "width": 696,
  "height": 832,
  "warnings": []
}
```

Failures are also JSON (`{"ok": false, "error": "..."}`) with a non-zero exit code, so a
caller never has to parse prose.

## Links

- **Repository & docs** — https://github.com/Weidows/neomermaid
- [CLI reference](https://github.com/Weidows/neomermaid/blob/main/docs/cli.md) ·
  [Theming](https://github.com/Weidows/neomermaid/blob/main/docs/theming.md) ·
  [Layout](https://github.com/Weidows/neomermaid/blob/main/docs/layout.md) ·
  [Contrast](https://github.com/Weidows/neomermaid/blob/main/docs/contrast.md)
- **SDK** — [`@neomermaid/core`](https://www.npmjs.com/package/@neomermaid/core)
- **Live demo** — https://blog.weidows.tech/neomermaid/
- **VS Code extension** — NeoMermaid (live preview, theme picker, export to PNG/SVG)

## License

MIT
