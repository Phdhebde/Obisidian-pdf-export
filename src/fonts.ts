/*
 * The fonts every report is set in, bundled into main.js as base64.
 *
 * The community plugin store installs main.js, manifest.json and styles.css
 * only, so a fonts/ folder next to them would never reach a user. esbuild
 * inlines each TTF (see the `.ttf` loader in esbuild.config.mjs); the files
 * are shipped unmodified, under the SIL Open Font License — see fonts/.
 */
import LiberationSansRegular from '../fonts/LiberationSans-Regular.ttf';
import LiberationSansBold from '../fonts/LiberationSans-Bold.ttf';
import LiberationSansItalic from '../fonts/LiberationSans-Italic.ttf';
import LiberationSansBoldItalic from '../fonts/LiberationSans-BoldItalic.ttf';
import ArchivoBlackRegular from '../fonts/ArchivoBlack-Regular.ttf';
import LiberationMonoRegular from '../fonts/LiberationMono-Regular.ttf';
import LiberationMonoBold from '../fonts/LiberationMono-Bold.ttf';

/** pdfmake virtual file system: file name -> base64 TTF. */
export const FONT_VFS: Record<string, string> = {
  'LiberationSans-Regular.ttf': LiberationSansRegular,
  'LiberationSans-Bold.ttf': LiberationSansBold,
  'LiberationSans-Italic.ttf': LiberationSansItalic,
  'LiberationSans-BoldItalic.ttf': LiberationSansBoldItalic,
  'ArchivoBlack-Regular.ttf': ArchivoBlackRegular,
  'LiberationMono-Regular.ttf': LiberationMonoRegular,
  'LiberationMono-Bold.ttf': LiberationMonoBold
};
