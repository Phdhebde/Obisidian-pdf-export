# Third-party notices

The released `main.js` bundles the following software and assets.

| Component | License | Notes |
|---|---|---|
| [pdfmake](https://github.com/bpampuch/pdfmake) (with pdfkit, fontkit and svg-to-pdfkit) | MIT | PDF layout and rendering |
| [marked](https://github.com/markedjs/marked) | MIT | Markdown lexer |
| [Lucide](https://lucide.dev) icons | ISC | Callout icons, embedded as SVG paths in `src/icons.ts` |
| Liberation Sans, Liberation Mono | SIL OFL 1.1 | Embedded unmodified — see [`fonts/OFL.txt`](fonts/OFL.txt) |
| Archivo Black | SIL OFL 1.1 | Embedded unmodified — see [`fonts/OFL.txt`](fonts/OFL.txt) |

The license texts of the npm packages ship with them in `node_modules/`; esbuild
keeps their legal comments in the bundle.

## Documentation site

The documentation site (`website/`) serves these fonts itself, instead of loading them from Google Fonts.

| Component | License | Notes |
|---|---|---|
| [Inter](https://github.com/rsms/inter) — Copyright 2016 The Inter Project Authors | SIL OFL 1.1 | Variable font, latin and latin-ext subsets from [Fontsource](https://fontsource.org), unmodified, in `website/*/docs/assets/fonts/` |
| [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) — Copyright 2020 The JetBrains Mono Project Authors | SIL OFL 1.1 | Same |
