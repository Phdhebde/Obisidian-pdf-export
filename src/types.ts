/*
 * Shared types for PDF Report Exporter.
 *
 * `Preset` describes a report template as it is persisted in data.json, or
 * shared as JSON. migratePreset() in storage.ts backfills whatever a stored or
 * imported preset lacks, so a partial one stays loadable.
 */

import { t, type MessageKey } from './i18n.ts';

/* ------------------------------------------------------------------ */
/* TLP                                                                 */
/* ------------------------------------------------------------------ */

/** The TLP 2.0 levels this plugin recognises. */
export const TLP_KEYS = ['RED', 'AMBER+STRICT', 'AMBER', 'GREEN', 'CLEAR'] as const;
export type TlpKey = (typeof TLP_KEYS)[number];

/** Fallback when the note declares no TLP, or an unrecognised one. */
export const TLP_DEFAULT: TlpKey = 'CLEAR';

export interface TlpColor {
  /** Badge fill, and the colour of the "TLP:x" marking in the footer. */
  bg: string;
  /** Text colour on top of `bg`. */
  fg: string;
}

export interface TlpReminderEntry {
  key: TlpKey;
  text: string;
}

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

export const SECTION_KEYS = ['cover', 'references', 'tlp', 'toc', 'body'] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

/** User-facing section name, shown in the settings tab and the preset picker. */
export function sectionLabel(key: SectionKey): string {
  return t(`section.${key}` as MessageKey);
}

export function isSectionKey(v: unknown): v is SectionKey {
  return typeof v === 'string' && (SECTION_KEYS as readonly string[]).includes(v);
}

/* ------------------------------------------------------------------ */
/* Headings and table of contents                                      */
/* ------------------------------------------------------------------ */

/** The six Markdown heading levels, `#` to `######`. */
export const HEADING_LEVELS = 6;

export const NUMBERING_STYLES = [
  'none',
  'decimal',
  'upperAlpha',
  'lowerAlpha',
  'upperRoman',
  'lowerRoman'
] as const;
export type NumberingStyle = (typeof NUMBERING_STYLES)[number];

export function isNumberingStyle(v: unknown): v is NumberingStyle {
  return typeof v === 'string' && (NUMBERING_STYLES as readonly string[]).includes(v);
}

/** Per heading level, both arrays indexed from 0 for `#` to 5 for `######`. */
export interface PresetToc {
  /** Whether the level is listed in the table of contents. */
  levels: boolean[];
  /** How the level's own number is formatted in front of its title. */
  numbering: NumberingStyle[];
  /**
   * Prefix each number with those of its numbered parents — `2.1`, `1.A`,
   * `2.a` — instead of printing the level's own number alone.
   */
  hierarchical: boolean;
  /** Start a new page before every heading of the level. */
  pageBreak: boolean[];
}

/* ------------------------------------------------------------------ */
/* Preset                                                              */
/* ------------------------------------------------------------------ */

export interface PresetColors {
  /** H1 headings, TOC level-1 entries, diamond bullets. */
  brand: string;
  /** Header band of the built-in decoration. */
  banner: string;
  /** Footer band of the built-in decoration. */
  dark: string;
  headerText: string;
  footerText: string;
  tableHeaderBg: string;
  tableHeaderText: string;
  tableBodyBg: string;
  tableBorder: string;
  link: string;
  tocTitle: string;
  text: string;
}

export interface PresetFonts {
  bodyFont: string;
  headingFont: string;
  monoFont: string;
  /**
   * Body text size in points. Every other size in the document is derived from
   * it, so the whole report scales together instead of the body drifting away
   * from its headings. 11 reproduces the sizes the generator hard-coded before.
   */
  bodySize: number;
}

export interface CoverLayout {
  x: number;
  titleY: number;
  titleSize: number;
  /** The horizontal rule under the cover title. */
  showRule: boolean;
  ruleY: number;
  ruleW: number;
  subtitleY: number;
  subtitleSize: number;
  acronymY: number;
  acronymSize: number;
  /** Soft wrap width for the cover title, in characters. */
  titleMaxChars: number;
  /** Client logo, positioned from the top-left of the page, in points. */
  logoX: number;
  logoY: number;
  /** Width the logo is scaled to; its height follows the aspect ratio. */
  logoW: number;
}

export interface PresetLayout {
  /** [left, top, right, bottom] in PDF points. */
  pageMargins: [number, number, number, number];
  headerY: number;
  headerRight: number;
  footerY: number;
  footerRight: number;
  /**
   * Page-number template for the footer. `{{page}}` and `{{total}}` are
   * substituted; an empty template prints no page number at all.
   */
  pagination: string;
  /**
   * Draw the built-in cover decoration and header/footer bands, in the preset's
   * colours, wherever no image replaces them.
   */
  decor: boolean;
  cover: CoverLayout;
}

/**
 * Fixed strings the generator prints. They live on the preset so that each
 * template carries its own wording, in its own language.
 */
export interface PresetLabels {
  references: string;
  status: string;
  contacts: string;
  /** First column header of the contacts table. */
  contactColumn: string;
  contactRole: string;
  contactEmail: string;
  recipients: string;
  recipientColumn: string;
  recipientRole: string;
  recipientEmail: string;
  versionColumn: string;
  versionDate: string;
  versionState: string;
  tlpReminder: string;
  tlpReminderSubtitle: string;
  toc: string;
}

/** What to do with an `![[note]]` transclusion in the body. */
export type TransclusionMode = 'inline' | 'warn';

export interface PresetAssets {
  /**
   * A plugin-relative path to an imported image, or null for none — in which
   * case the built-in decoration is drawn, if the preset asks for it.
   */
  coverBg: string | null;
  frame: string | null;
  /**
   * Default client logo for this template. A note may name its own with a
   * `logo:` key in its frontmatter, which wins over this one.
   */
  clientLogo: string | null;
}

export interface Preset {
  id: string;
  name: string;
  colors: PresetColors;
  fonts: PresetFonts;
  layout: PresetLayout;
  tlp: Record<string, TlpColor>;
  tlpReminder: TlpReminderEntry[];
  /** Ordered and filtered: only the sections listed are emitted, in this order. */
  sections: SectionKey[];
  /** Which headings are numbered, and which reach the table of contents. */
  toc: PresetToc;
  assets: PresetAssets;
  labels: PresetLabels;
  /**
   * Always print the "Recipients" table on the references page, even when
   * the note declares none — a blank form to fill in by hand. A note that does
   * declare recipients prints the table regardless of this flag.
   */
  showRecipients: boolean;
  /** Draw the Lucide icon of each callout type, as Obsidian does. */
  calloutIcons: boolean;
  /** Diamond bullets for top-level lists under a "Recommendations" heading. */
  diamondBullets: boolean;
  /** Justify body text or align it left. */
  justify: boolean;
  transclusions: TransclusionMode;
}

/* ------------------------------------------------------------------ */
/* Per-export variables (resolved from note frontmatter)               */
/* ------------------------------------------------------------------ */

export interface DocVersion {
  version?: string;
  date?: string;
  etat?: string;
}

/**
 * A frontmatter value as text: strings as they are, numbers and booleans
 * written out, anything else (a list, an object, nothing) as empty.
 */
export function asText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

export interface DocContact {
  nom?: string;
  poste?: string;
  courriel?: string;
  /** Fills the middle column when `poste` is absent — useful for recipients. */
  societe?: string;
}

/** True once a contact carries anything worth printing. */
export function hasContactContent(c: DocContact | null | undefined): boolean {
  if (!c || typeof c !== 'object') return false;
  return Boolean((c.nom || c.poste || c.courriel || c.societe || '').trim());
}

export interface ReportVars {
  docTitle: string;
  client: string;
  /** Null when the note declares no TLP level. */
  tlp: TlpKey | null;
  coverTitle: string;
  coverSubtitle: string;
  coverSubtitle2: string;
  tocTitle: string;
  versions: DocVersion[];
  contacts: DocContact[];
  /** Optional "Recipients" block on the references page. */
  recipients: DocContact[];
  /** Author, for the PDF metadata block. */
  author: string;
  /** Client logo named by the note's frontmatter: a vault path or a link. */
  clientLogo?: string;
  /** Section override declared in the note's frontmatter, if any. */
  sections?: SectionKey[];
}

/* ------------------------------------------------------------------ */
/* Plugin data (data.json)                                             */
/* ------------------------------------------------------------------ */

/** What to do when the target PDF already exists. */
export type ConflictMode = 'ask' | 'overwrite' | 'increment';

/** One audience a note can be exported for, such as a client. */
export interface ExportProfile {
  id: string;
  name: string;
  /** Audience levels whose passages stay; passages marked with any other level are removed. */
  keep: string[];
  /** Appended to the PDF name, so versions do not overwrite each other. */
  suffix: string;
  /** Print a "[passage removed]" mark where something was cut. */
  placeholder: boolean;
  /** TLP marking for this version; null keeps the note's own. */
  tlp: TlpKey | null;
}

export interface PluginData {
  /** Bumped when the shape changes; drives migrate(). */
  schemaVersion: number;
  presets: Preset[];
  /** Vault-relative output folder; empty means the vault root. */
  outputFolder: string;
  /** Filename template, e.g. "{{note}}" or "{{date}} - {{client}} - {{title}}". */
  filenameTemplate: string;
  conflictMode: ConflictMode;
  rememberLast: boolean;
  lastPresetId?: string;
  /** Skip the preset picker and always use `lastPresetId`. */
  alwaysUseLast: boolean;
  /** Pre-filled into the frontmatter inserted by the template command. */
  defaultContacts: DocContact[];
  /** Audience levels a note may mark passages with, lower case. */
  audienceLevels: string[];
  profiles: ExportProfile[];
  /** Label and highlight the restricted passages a version keeps. */
  markConfidential: boolean;
  /** Append a line to a log note after each restricted export. */
  logExports: boolean;
}

export const CURRENT_SCHEMA_VERSION = 1;
