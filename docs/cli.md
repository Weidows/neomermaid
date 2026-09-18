# CLI reference

```bash
neomermaid <command> [options]
```

| command | what it does |
|---|---|
| `render <input.mmd\|->` | render one diagram (use `-` or pipe for stdin) |
| `gallery [dir]` | render every `.mmd` in a folder in several presets + an HTML index |
| `themes` | list themes, palettes and presets (`--json` for machines) |
| `examples` | list the built-in example corpus (`--json`) |
| `doctor` | report the browser it will use, bundle path/size, versions |
| `help`, `version` | usage / version |

`neomermaid flow.mmd -o flow.png` also works — the `render` verb is optional when
the first argument looks like a diagram file.

## render

```
-o, --out <file>        output path (omit for SVG on stdout)
-f, --format <fmt>      svg | png | pdf | html (default: inferred from --out, else svg)
-t, --theme <name>      minimal | neon | tech | cartoon | glass | blueprint
-p, --palette <name>    dracula | one-dark-pro | nord | gruvbox-dark | catppuccin-mocha |
                        tokyo-night | monokai | rose-pine | github-light | solarized-light | nord-light
    --preset <t/p>      shorthand, e.g. neon/dracula (wins over --theme/--palette)
    --background <c>    'theme' (default) | 'transparent' | any CSS colour
    --canvas <style>    solid | gradient | grid | dots | transparent
    --padding <px>      canvas padding (default 16)
-s, --scale <n>         raster scale for png/pdf (default 2 → 2× device pixels)
```

Style overrides — identical to the SDK's `styling` tokens (`docs/theming.md`):

```
--stroke-width <n>   --edge-width <n>     --radius <n>        --cluster-radius <n>
--edge-dash <d>      --arrow-scale <n>    --shadow-blur <n>   --shadow-y <n>
--glow <n>           --font-family <f>    --font-size <n>     --font-weight <n>
--letter-spacing <n> --uppercase          --fill <mode>       --animate
--sketch             --pattern-size <n>
--stroke-color <c>   --node-color <c>     --text-color <c>    --edge-color <c>
--bg-color <c>       --accent <c>
```

Mermaid passthrough:

```
--curve <name>       basis | linear | step | cardinal | monotoneX … (flowchart curves)
--security <level>   loose (default, keeps classDef) | strict
--mermaid-json <j>   raw mermaid config object, merged last
```

Automation:

```
-j, --json           machine-readable result on stdout, errors as {"ok": false, …}
    --embed          include the rendered SVG (or base64 bytes) in the JSON payload
    --quiet          no progress chatter on stderr
    --browser <path> use a specific Chrome/Edge/Chromium binary
```

## Exit codes

| code | meaning |
|---|---|
| 0 | success |
| 1 | render or IO failure (details in `--json` `error`, or on stderr) |
| 2 | unknown command / usage error |

## Environment

| variable | purpose |
|---|---|
| `NEOMERMAID_BROWSER` | explicit browser path (also: `CHROME_PATH`, `PUPPETEER_EXECUTABLE_PATH`) |

The CLI never downloads a browser: it discovers Chrome, Edge, Brave, Chromium or a
cached Playwright/Puppeteer build. `neomermaid doctor` prints what it found.

## Examples

```bash
# PNG for a README, 2× for retina
neomermaid render examples/release-flow.mmd -o docs/flow.png --preset glass/nord

# transparent SVG for a dark website
neomermaid render flow.mmd -o flow.svg --theme tech --palette tokyo-night --background transparent

# from a pipe, machine readable (agent-friendly)
cat flow.mmd | neomermaid render - --preset neon/dracula --json

# heavy styling without leaving the shell
neomermaid render flow.mmd -o flow.png --theme minimal --radius 0 --stroke-width 3 \
  --edge-width 2.5 --font-size 17 --fill flat --stroke-color '#111' --edge-color '#111'

# a whole folder in six looks, plus an HTML index to eyeball them
neomermaid gallery examples -o .gallery --presets minimal/github-light,neon/dracula,tech/tokyo-night
```

## Using it from Node

```ts
import { Pilot, withPilot, findBrowsers } from '@neomermaid/cli';

await withPilot({ scale: 2 }, async (pilot) => {
  const result = await pilot.render('flowchart LR\n A-->B', { preset: 'neon/dracula' });
  const png = await pilot.toPng(result.svg, {
    width: result.width, height: result.height, scale: 2, background: result.background,
  });
  // png is a Buffer
});
```

`Pilot` keeps one browser (and one page) alive, so loop over many diagrams instead
of paying browser start-up per render. Mermaid's render is serialised internally —
concurrent `render()` calls are safe.
