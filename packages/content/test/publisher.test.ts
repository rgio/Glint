import { describe, expect, it } from 'vitest';

import { mergeCues, parsePublisherTranscript, parseSrt, parseVtt, sourceForType, TranscriptFormatError } from '../src';

describe('sourceForType', () => {
  it('maps timed MIME types, and extensions when the type is missing', () => {
    expect(sourceForType('application/json', 'https://e.com/t')).toBe('publisher_json');
    expect(sourceForType('text/vtt; charset=utf-8', 'https://e.com/t')).toBe('publisher_vtt');
    expect(sourceForType('application/x-subrip', 'https://e.com/t')).toBe('publisher_srt');
    expect(sourceForType(null, 'https://e.com/t.srt?x=1')).toBe('publisher_srt');
    expect(sourceForType('text/html', 'https://e.com/t.vtt')).toBeNull();
    expect(sourceForType('text/plain', 'https://e.com/t.txt')).toBeNull();
  });
});

describe('parseVtt', () => {
  it('reads cues, voice spans and cue settings, skipping notes', () => {
    const vtt = `WEBVTT

NOTE made by hand

1
00:00:01.000 --> 00:00:04.500 align:start
<v Ana Ruiz>Hello <i>there</i> &amp; welcome.</v>

00:04.500 --> 00:07.000
No speaker here.`;
    expect(parseVtt(vtt)).toEqual([
      { startMs: 1000, endMs: 4500, speaker: 'Ana Ruiz', text: 'Hello there & welcome.' },
      { startMs: 4500, endMs: 7000, speaker: null, text: 'No speaker here.' },
    ]);
  });

  it('rejects files without the header', () => {
    expect(() => parseVtt('00:01.000 --> 00:02.000\nhi')).toThrow(TranscriptFormatError);
  });
});

describe('parseSrt', () => {
  it('reads numbered cues with comma milliseconds', () => {
    const srt = '﻿1\r\n00:00:01,000 --> 00:00:02,250\r\nFirst line\r\nsecond line\r\n\r\n2\r\n00:01:00,000 --> 00:01:03,000\r\nLater.\r\n';
    expect(parseSrt(srt)).toEqual([
      { startMs: 1000, endMs: 2250, speaker: null, text: 'First line second line' },
      { startMs: 60_000, endMs: 63_000, speaker: null, text: 'Later.' },
    ]);
  });
});

describe('Podcasting 2.0 JSON', () => {
  it('merges word-level cues into sentence-sized segments per speaker', () => {
    const words = 'This is the first sentence of the show and it runs on a bit. Short one.'.split(' ');
    const json = JSON.stringify({
      version: '1.0.0',
      segments: [
        ...words.map((body, i) => ({ speaker: 'Host', startTime: i * 0.5, endTime: i * 0.5 + 0.5, body })),
        { speaker: 'Guest', startTime: 20, endTime: 21, body: 'Hi!' },
      ],
    });
    const segments = parsePublisherTranscript('publisher_json', json);
    expect(segments.map((s) => [s.speaker, s.text])).toEqual([
      ['Host', 'This is the first sentence of the show and it runs on a bit.'],
      ['Host', 'Short one.'],
      ['Guest', 'Hi!'],
    ]);
    expect(segments[0]).toMatchObject({ startMs: 0, endMs: 7000 });
  });

  it('caps a merged segment at 20 seconds', () => {
    const cues = Array.from({ length: 50 }, (_, i) => ({ startMs: i * 1000, endMs: i * 1000 + 1000, speaker: null, text: 'word' }));
    expect(mergeCues(cues).every((s) => s.endMs - s.startMs <= 20_000)).toBe(true);
  });

  it('rejects JSON without segments', () => {
    expect(() => parsePublisherTranscript('publisher_json', '{"foo":1}')).toThrow(TranscriptFormatError);
    expect(() => parsePublisherTranscript('publisher_json', 'not json')).toThrow(TranscriptFormatError);
  });
});
