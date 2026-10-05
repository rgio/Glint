import { describe, expect, it } from 'vitest';

import { htmlToText } from './format';

describe('htmlToText', () => {
  it('keeps text and line breaks, and drops script and style contents', () => {
    expect(htmlToText('<p>One</p><p>Two &amp; three</p><script>alert(1)</script><style>p { color: red }</style>')).toBe(
      'One\nTwo & three',
    );
  });
});
