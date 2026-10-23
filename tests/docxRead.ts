/*
 * Reading a .docx back in the tests: its parts as text, a well-formedness
 * check, and a way to build small Word templates without shipping fixtures.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

/** Every XML part of a package, by path. */
export function parts(bytes: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, data] of Object.entries(unzipSync(bytes))) {
    if (/\.(xml|rels)$/.test(path)) out[path] = strFromU8(data);
  }
  return out;
}

/** All the text of a package's XML parts, for leak checks. */
export function allXml(bytes: Uint8Array): string {
  return Object.values(parts(bytes)).join('\n');
}

/**
 * Throw unless `xml` is well formed: tags balanced and properly nested,
 * attributes quoted, no bare ampersand. Word refuses a file over any of these.
 */
export function assertWellFormed(xml: string, name = 'part'): void {
  const stack: string[] = [];
  const bare = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.exec(xml);
  if (bare) throw new Error(`${name}: bare & at ${bare.index}: ${xml.slice(bare.index, bare.index + 40)}`);
  for (const m of xml.matchAll(/<[^>]*>/g)) {
    const tag = m[0];
    if (tag.startsWith('<?') || tag.startsWith('<!')) continue;
    if (tag.startsWith('</')) {
      const name_ = tag.slice(2, -1).trim();
      const open = stack.pop();
      if (open !== name_) throw new Error(`${name}: </${name_}> closes <${open}> at ${m.index}: ${xml.slice(Math.max(0, (m.index ?? 0) - 120), (m.index ?? 0) + 20)}`);
      continue;
    }
    const nameMatch = /^<([A-Za-z_][\w:.-]*)/.exec(tag);
    if (!nameMatch) throw new Error(`${name}: malformed tag ${tag}`);
    const attrs = tag.slice(nameMatch[0].length, tag.endsWith('/>') ? -2 : -1);
    const rest = attrs.replace(/\s+[\w:.-]+="[^"]*"/g, '').trim();
    if (rest) throw new Error(`${name}: malformed attributes in ${tag}`);
    if (!tag.endsWith('/>')) stack.push(nameMatch[1]);
  }
  if (stack.length) throw new Error(`${name}: unclosed <${stack.join('>, <')}>`);
}

export function assertPackageWellFormed(bytes: Uint8Array): void {
  for (const [path, xml] of Object.entries(parts(bytes))) assertWellFormed(xml, path);
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';

/** A Word template, as Word would save one, from a body and its styles. */
export function makeTemplate(o: {
  body: string;
  styles?: string;
  header?: string;
  dotx?: boolean;
  extra?: Record<string, string>;
}): Uint8Array {
  const main = o.dotx
    ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml'
    : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
  const files: Record<string, string> = {
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      `<Override PartName="/word/document.xml" ContentType="${main}"/>` +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      (o.header ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' : '') +
      '</Types>',
    '_rels/.rels':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      `<Relationship Id="rId1" Type="${REL}officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/_rels/document.xml.rels':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      `<Relationship Id="rId1" Type="${REL}styles" Target="styles.xml"/>` +
      (o.header ? `<Relationship Id="rId2" Type="${REL}header" Target="header1.xml"/>` : '') +
      '</Relationships>',
    'word/document.xml':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${o.body}` +
      `<w:sectPr>${o.header ? '<w:headerReference w:type="default" r:id="rId2"/>' : ''}<w:pgSz w:w="11906" w:h="16838"/>` +
      '<w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>',
    'word/styles.xml':
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${W}">` +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      (o.styles ?? '') +
      '</w:styles>',
    ...(o.header
      ? { 'word/header1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="${W}" xmlns:r="${R}">${o.header}</w:hdr>` }
      : {}),
    ...(o.extra ?? {})
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
}
