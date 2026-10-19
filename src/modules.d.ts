/** Font files, inlined by esbuild's base64 loader. */
declare module '*.ttf' {
  const base64: string;
  export default base64;
}

/** pdfmake's browser build, as far as the plugin uses it. */
declare module 'pdfmake/build/pdfmake.js' {
  /** The PDFKit document stream `getStream()` hands back. */
  export interface PdfStream {
    on(event: 'readable' | 'end', listener: () => void): void;
    on(event: 'error', listener: (error: Error) => void): void;
    read(size: number): Uint8Array | null;
    end(): void;
  }

  export interface PdfMake {
    vfs?: Record<string, string>;
    fonts?: Record<string, Record<string, string>>;
    createPdf(definition: object): { getStream(): PdfStream };
  }

  const pdfMake: PdfMake;
  export default pdfMake;
}

/** Electron's `require`, which Obsidian exposes on the window of the desktop app. */
interface Window {
  require?: (module: 'electron') => { shell: { showItemInFolder(fullPath: string): void } };
}
