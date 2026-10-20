import { calculateCredibility } from '../src/rumors';

describe('credibility decay', () => {
  it('decays by half at the configured half-life relationship', () => {
    const created = Date.parse('2026-01-01T00:00:00Z');
    const lambda = 0.05;
    const oneHour = calculateCredibility(
      { base_score: 50, upvote_count: 0, last_boost_at: new Date(created).toISOString() },
      created + 3600000,
    );
    expect(oneHour).toBeCloseTo(50 * Math.exp(-lambda), 5);
  });
  it('clamps results to zero through one hundred', () => {
    expect(
      calculateCredibility({
        base_score: 100,
        upvote_count: 100,
        last_boost_at: new Date().toISOString(),
      }),
    ).toBe(100);
  });
});
