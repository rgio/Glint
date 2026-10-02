import { parseDocument } from 'htmlparser2';

/** Styled text, a link, a tappable timestamp, or a line break. */
export type Inline =
  | { kind: 'text'; text: string; bold?: boolean; italic?: boolean; href?: string }
  | { kind: 'timestamp'; text: string; seconds: number; bold?: boolean; italic?: boolean }
  | { kind: 'break' };

export type Block =
  | { kind: 'paragraph' | 'heading' | 'quote'; inlines: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] };

/** The parts of htmlparser2's DOM nodes this module reads. */
type DomNode = {
  type: string;
  name?: string;
  attribs?: Record<string, string>;
  children?: DomNode[];
  data?: string;
};

type Style = { bold?: boolean; italic?: boolean; href?: string };

// Removed along with everything inside them.
const DROPPED = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea',
  'svg', 'math', 'noscript', 'head', 'title', 'img', 'picture', 'video', 'audio', 'canvas', 'template',
]);
const BLOCKS = new Set([
  'p', 'div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'figure', 'figcaption',
  'table', 'thead', 'tbody', 'tr', 'pre', 'address', 'center', 'dl', 'dt', 'dd', 'hr',
]);
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const BOLD = new Set(['b', 'strong']);
const ITALIC = new Set(['i', 'em', 'cite']);

// m:ss, mm:ss or h:mm:ss, not glued to other digits or colons.
const TIMESTAMP = /(?<![\d:])(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?![\d:])/g;
const CLOCK_SUFFIX = /^\s?[ap]\.?m\b/i;

/** Only web and mail links survive; `javascript:` and the like are dropped. */
function safeHref(href: string | undefined): string | undefined {
  if (!href) return undefined;
  try {
    const url = new URL(href.trim());
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Splits text into plain runs and timestamps that fall within the episode. */
function withTimestamps(text: string, style: Style, durationSec: number | null): Inline[] {
  if (style.href) return [{ kind: 'text', text, ...style }];
  const out: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(TIMESTAMP)) {
    const [whole, h, m, s] = match;
    const hours = h ? Number(h) : 0;
    const minutes = Number(m);
    const seconds = Number(s);
    const total = hours * 3600 + minutes * 60 + seconds;
    const valid =
      seconds < 60 &&
      (!h || minutes < 60) &&
      // "10:30 am" is a time of day, not a position.
      !CLOCK_SUFFIX.test(text.slice(match.index + whole.length)) &&
      (durationSec === null || total <= durationSec + 1);
    if (!valid) continue;
    if (match.index > last) out.push({ kind: 'text', text: text.slice(last, match.index), ...style });
    out.push({ kind: 'timestamp', text: whole, seconds: total, bold: style.bold, italic: style.italic });
    last = match.index + whole.length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last), ...style });
  return out;
}

/** Drops leading/trailing breaks and spaces, and merges neighbouring runs with the same style. */
function tidy(inlines: Inline[]): Inline[] {
  const merged: Inline[] = [];
  for (const inline of inlines) {
    const prev = merged.at(-1);
    if (
      inline.kind === 'text' &&
      prev?.kind === 'text' &&
      prev.bold === inline.bold &&
      prev.italic === inline.italic &&
      prev.href === inline.href
    ) {
      merged[merged.length - 1] = { ...prev, text: prev.text + inline.text };
    } else {
      merged.push(inline);
    }
  }
  // Spaces next to a line break, and runs of more than two breaks, are noise.
  const out = merged
    .map((inline, i) => {
      if (inline.kind !== 'text') return inline;
      let text = inline.text;
      if (i === 0 || merged[i - 1]!.kind === 'break') text = text.replace(/^ +/, '');
      if (i === merged.length - 1 || merged[i + 1]!.kind === 'break') text = text.replace(/ +$/, '');
      return { ...inline, text };
    })
    .filter((inline) => inline.kind !== 'text' || inline.text !== '');
  while (out[0]?.kind === 'break') out.shift();
  while (out.at(-1)?.kind === 'break') out.pop();
  return out.filter((inline, i) => !(inline.kind === 'break' && out[i - 1]?.kind === 'break' && out[i - 2]?.kind === 'break'));
}

/** Plain-text notes: blank lines separate paragraphs, single newlines are line breaks. */
function plainTextToHtml(text: string): string {
  const escaped = text.replace(/&(?![#a-z0-9]+;)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/**
 * F-05: turns show notes (HTML or plain text) into a small, safe structure to render natively.
 * Only text, emphasis, line breaks, web links, headings, quotes and lists survive. Timestamps
 * within the episode's length become tappable.
 */
export function parseShowNotes(input: string | null, durationSec: number | null): Block[] {
  if (!input?.trim()) return [];
  const html = /<\/?[a-z][^>]*>/i.test(input) ? input : plainTextToHtml(input);
  const doc = parseDocument(html, { decodeEntities: true }) as unknown as DomNode;

  const blocks: Block[] = [];
  let current: Inline[] = [];

  const flush = (kind: 'paragraph' | 'heading' | 'quote' = 'paragraph') => {
    const inlines = tidy(current);
    current = [];
    if (inlines.some((i) => i.kind !== 'break')) blocks.push({ kind, inlines });
  };

  /** Inline content of a node; blocks inside it (as in a list item) become line breaks. */
  const inlinesOf = (node: DomNode, style: Style): Inline[] => {
    const saved = current;
    current = [];
    for (const child of node.children ?? []) walk(child, style, true);
    // Within one item, blocks are separated by a single line break, not a blank line.
    const result = tidy(current).filter((inline, i, all) => !(inline.kind === 'break' && all[i - 1]?.kind === 'break'));
    current = saved;
    return result;
  };

  const walk = (node: DomNode, style: Style, inline = false): void => {
    if (node.type === 'text') {
      const text = (node.data ?? '').replace(/\s+/g, ' ');
      if (text) current.push(...withTimestamps(text, style, durationSec));
      return;
    }
    if (node.type !== 'tag' || !node.name) {
      // Comments, CDATA, doctype, and script/style elements (their own node types) are dropped.
      return;
    }
    const name = node.name.toLowerCase();
    if (DROPPED.has(name)) return;
    if (name === 'br') {
      current.push({ kind: 'break' });
      return;
    }

    const children = (nextStyle: Style) => {
      for (const child of node.children ?? []) walk(child, nextStyle, inline);
    };

    if (BOLD.has(name)) return children({ ...style, bold: true });
    if (ITALIC.has(name)) return children({ ...style, italic: true });
    if (name === 'a') return children({ ...style, href: safeHref(node.attribs?.href) });

    if (name === 'ul' || name === 'ol') {
      const items = (node.children ?? [])
        .filter((c) => c.type === 'tag')
        .map((li) => inlinesOf(li, style))
        .filter((item) => item.some((i) => i.kind !== 'break'));
      if (inline) {
        // A list inside a list item: its items continue on new lines.
        for (const item of items) current.push({ kind: 'break' }, { kind: 'text', text: '• ' }, ...item);
        return;
      }
      flush();
      if (items.length) blocks.push({ kind: 'list', ordered: name === 'ol', items });
      return;
    }

    const kind = HEADINGS.has(name) ? 'heading' : name === 'blockquote' ? 'quote' : BLOCKS.has(name) || name === 'li' ? 'paragraph' : null;
    if (!kind) return children(style); // span, u, font, small, and anything unknown: keep the text.
    if (inline) {
      current.push({ kind: 'break' });
      children(style);
      current.push({ kind: 'break' });
      return;
    }
    flush();
    children(kind === 'heading' ? { ...style, bold: true } : style);
    flush(kind);
  };

  for (const child of doc.children ?? []) walk(child, {});
  flush();
  return blocks;
}
