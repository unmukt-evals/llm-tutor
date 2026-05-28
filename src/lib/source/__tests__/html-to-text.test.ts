// src/lib/source/__tests__/html-to-text.test.ts
import { describe, it, expect } from 'vitest';
import { htmlToText } from '@/lib/source/html-to-text';

describe('htmlToText', () => {
  it('strips tags and keeps text', () => {
    expect(htmlToText('<p>Hello <b>world</b></p>')).toBe('Hello world');
  });

  it('removes script and style content entirely', () => {
    const html = '<style>.a{color:red}</style><p>keep</p><script>var x=1;</script>';
    expect(htmlToText(html)).toBe('keep');
  });

  it('decodes common entities', () => {
    expect(htmlToText('<p>a &amp; b &lt; c &gt; d &quot;e&quot; &#39;f&#39; &nbsp;g</p>'))
      .toBe('a & b < c > d "e" \'f\' g');
  });

  it('collapses whitespace and newlines', () => {
    expect(htmlToText('<div>one</div>\n\n\n<div>two</div>')).toBe('one\ntwo');
  });

  it('returns empty string for empty input', () => {
    expect(htmlToText('')).toBe('');
  });
});
