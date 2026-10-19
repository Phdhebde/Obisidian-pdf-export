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
