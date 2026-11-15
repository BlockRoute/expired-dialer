import { describe, expect, it } from 'vitest';
import { createDownsampler, floatToPcm16 } from './pcm16';

describe('floatToPcm16', () => {
  it('maps and clamps float samples to int16', () => {
    const out = floatToPcm16(new Float32Array([0, 1, -1, 2, -2, 0.5]));
    expect(Array.from(out)).toEqual([0, 32767, -32768, 32767, -32768, 16384]);
  });
});

describe('createDownsampler', () => {
  it('averages 48k to 16k by a factor of 3', () => {
    const down = createDownsampler(48000, 16000);
    const out = down(new Float32Array([0.3, 0.3, 0.3, -0.6, -0.6, -0.6]));
    expect(out.length).toBe(2);
    expect(out[0]).toBeCloseTo(0.3, 5);
    expect(out[1]).toBeCloseTo(-0.6, 5);
  });

  it('carries leftover samples across chunks', () => {
    const down = createDownsampler(48000, 16000);
    const first = down(new Float32Array([0.3, 0.3]));
    const second = down(new Float32Array([0.3, 0.9, 0.9, 0.9]));
    expect(first.length).toBe(0);
    expect(second.length).toBe(2);
    expect(second[0]).toBeCloseTo(0.3, 5);
    expect(second[1]).toBeCloseTo(0.9, 5);
  });

  it('handles non-integer ratios (44.1k to 16k) with the right output length', () => {
    const down = createDownsampler(44100, 16000);
    let total = 0;
    for (let i = 0; i < 100; i++) total += down(new Float32Array(441)).length;
    expect(total).toBe(16000);
  });

  it('passes through when rates match', () => {
    const down = createDownsampler(16000, 16000);
    expect(Array.from(down(new Float32Array([0.1, 0.2])))).toEqual([
      expect.closeTo(0.1, 5),
      expect.closeTo(0.2, 5),
    ]);
  });
});
