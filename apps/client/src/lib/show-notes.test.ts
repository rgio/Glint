import { describe, expect, it } from 'vitest';

import { parseShowNotes, type Inline } from './show-notes';

const HOUR = 3600;

/** Renders inlines back to a compact string, to keep expectations readable. */
const flat = (inlines: Inline[]) =>
  inlines
    .map((i) => {
      if (i.kind === 'break') return '⏎';
      if (i.kind === 'timestamp') return `[${i.text}=${i.seconds}s]`;
      let text = i.text;
      if (i.bold) text = `**${text}**`;
      if (i.italic) text = `_${text}_`;
      if (i.href) text = `<${text}|${i.href}>`;
      return text;
    })
    .join('');

const summarize = (html: string | null, duration: number | null = HOUR) =>
  parseShowNotes(html, duration).map((b) =>
    b.kind === 'list' ? `${b.ordered ? 'ol' : 'ul'}: ${b.items.map(flat).join(' | ')}` : `${b.kind}: ${flat(b.inlines)}`,
  );

describe('parseShowNotes', () => {
  it('returns nothing for empty notes', () => {
    expect(summarize(null)).toEqual([]);
    expect(summarize('   ')).toEqual([]);
    expect(summarize('<p> </p><div></div>')).toEqual([]);
  });

  it('keeps paragraphs, headings, quotes and emphasis', () => {
    expect(
      summarize('<h2>Guests</h2><p>With <strong>Ann</strong> and <em>Bo</em>.</p><blockquote>Quoted</blockquote>'),
    ).toEqual(['heading: **Guests**', 'paragraph: With **Ann** and _Bo_.', 'quote: Quoted']);
  });

  it('collapses whitespace and decodes entities', () => {
    expect(summarize('<p>  Tom&nbsp;&amp;\n   Jerry &lt;3  </p>')).toEqual(['paragraph: Tom & Jerry <3']);
  });

  it('turns <br> into line breaks, trimming spaces and extra breaks', () => {
    expect(summarize('<p><br>One <br> Two<br><br><br><br>Three<br></p>')).toEqual(['paragraph: One⏎Two⏎⏎Three']);
  });

  it('treats plain-text notes as paragraphs and lines', () => {
    expect(summarize('First line\nsecond line\n\nNew paragraph & more < less')).toEqual([
      'paragraph: First line⏎second line',
      'paragraph: New paragraph & more < less',
    ]);
  });

  it('drops scripts, styles, frames, forms and images with their contents', () => {
    expect(
      summarize(
        '<p>Safe<script>alert(1)</script><style>p{}</style><iframe src="x">frame</iframe>' +
          '<img src="https://t.example/pixel.gif" alt="tracking"> text</p><form><input value="x">form</form>',
      ),
    ).toEqual(['paragraph: Safe text']);
  });

  it('follows HTML paragraph rules: a block element closes an open <p>', () => {
    expect(summarize('<p>Before<div>inside</div>after</p>')).toEqual([
      'paragraph: Before',
      'paragraph: inside',
      'paragraph: after',
    ]);
  });

  it('keeps web and mail links but drops other schemes', () => {
    expect(
      summarize(
        '<p><a href="https://example.com/a">site</a> <a href="mailto:hi@example.com">mail</a> ' +
          '<a href="javascript:alert(1)">bad</a> <a href="/relative">rel</a></p>',
      ),
    ).toEqual(['paragraph: <site|https://example.com/a> <mail|mailto:hi@example.com> bad rel']);
  });

  it('makes timestamps within the episode tappable', () => {
    expect(summarize('<p>00:00 Intro<br>(12:34) Topic<br>1:02:03 - Outro</p>', 2 * HOUR)).toEqual([
      'paragraph: [00:00=0s] Intro⏎([12:34=754s]) Topic⏎[1:02:03=3723s] - Outro',
    ]);
  });

  it('ignores times past the end, clock times, malformed times and timestamps inside links', () => {
    expect(
      summarize(
        '<p>Past the end 59:00. Recorded at 10:30 am and 7:15pm. Not times: 12:345, 1:2:3, 99:61, 1:75:00. ' +
          '<a href="https://example.com">at 05:00</a></p>',
        30 * 60,
      ),
    ).toEqual([
      'paragraph: Past the end 59:00. Recorded at 10:30 am and 7:15pm. Not times: 12:345, 1:2:3, 99:61, 1:75:00. <at 05:00|https://example.com/>',
    ]);
  });

  it('allows any timestamp when the duration is unknown', () => {
    expect(summarize('<p>at 2:10:00</p>', null)).toEqual(['paragraph: at [2:10:00=7800s]']);
  });

  it('keeps lists, folding nested lists and blocks into their item', () => {
    expect(
      summarize('<ol><li>One</li><li><p>Two</p><ul><li>Two a</li></ul></li><li> </li></ol><ul><li><b>Bold</b> 3:00</li></ul>'),
    ).toEqual(['ol: One | Two⏎• Two a', 'ul: **Bold** [3:00=180s]']);
  });

  it('keeps the text of unknown and presentational tags', () => {
    expect(summarize('<p><span style="color:red">Red</span> <font>old</font> <custom-tag>new</custom-tag></p>')).toEqual([
      'paragraph: Red old new',
    ]);
  });
});
