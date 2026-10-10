import { describe, expect, it } from 'vitest';

import { buildInterests, dot, HashingEmbedder, type ProfileItem } from '../src';

const NOW = Date.UTC(2026, 9, 9);
const DAY = 86_400_000;

async function items(texts: { text: string; daysAgo: number }[]): Promise<ProfileItem[]> {
  const vecs = await new HashingEmbedder().embed(texts.map((t) => t.text));
  return texts.map((t, i) => ({ highlightId: `h${i}`, episodeId: `e${i}`, vec: vecs[i]!, createdAt: NOW - t.daysAgo * DAY, text: t.text }));
}

describe('buildInterests', () => {
  it('keeps distinct interests apart instead of averaging them', async () => {
    const profile = await items([
      { text: 'marathon training long run pace', daysAgo: 1 },
      { text: 'marathon training interval pace', daysAgo: 2 },
      { text: 'long run training pace for marathon', daysAgo: 3 },
      { text: 'tariffs trade war policy canada', daysAgo: 1 },
      { text: 'trade policy tariffs and exports', daysAgo: 2 },
      { text: 'canada tariffs trade negotiations', daysAgo: 4 },
    ]);
    const interests = buildInterests(profile, { now: NOW });
    expect(interests).toHaveLength(2);
    const groups = interests.map((i) => i.members.map((m) => m.highlightId).sort());
    expect(groups).toContainEqual(['h0', 'h1', 'h2']);
    expect(groups).toContainEqual(['h3', 'h4', 'h5']);
    // Each centroid is closer to its own members than to the other group's.
    const [a, b] = interests;
    expect(dot(a!.centroid, a!.members[0]!.vec)).toBeGreaterThan(dot(a!.centroid, b!.members[0]!.vec));
  });

  it('weights recent highlights more', async () => {
    const profile = await items([
      { text: 'sourdough bread baking', daysAgo: 300 },
      { text: 'sourdough starter hydration', daysAgo: 310 },
      { text: 'sourdough bread crust', daysAgo: 320 },
      { text: 'chess openings sicilian', daysAgo: 1 },
      { text: 'chess endgames rook', daysAgo: 2 },
      { text: 'chess opening theory', daysAgo: 3 },
    ]);
    const [top] = buildInterests(profile, { now: NOW });
    expect(top!.members.map((m) => m.text).every((t) => t.includes('chess'))).toBe(true);
    expect(top!.weight).toBeGreaterThan(0.9);
  });

  it('handles one highlight and none', async () => {
    expect(buildInterests([], { now: NOW })).toEqual([]);
    expect(buildInterests(await items([{ text: 'just one', daysAgo: 0 }]), { now: NOW })).toHaveLength(1);
  });
});
