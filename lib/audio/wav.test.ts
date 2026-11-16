import { describe, expect, it } from 'vitest';
import { encodeWav, mixToMono } from './wav';

const str = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.slice(o, o + n));

describe('encodeWav', () => {
  const wav = encodeWav(Float32Array.from([0, 1, -1, 0.5, 2, -2]), 16000);
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);

  it('writes a 16-bit mono PCM header', () => {
    expect(str(wav, 0, 4)).toBe('RIFF');
    expect(str(wav, 8, 4)).toBe('WAVE');
    expect(str(wav, 12, 4)).toBe('fmt ');
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint32(28, true)).toBe(32000); // byte rate
    expect(view.getUint16(32, true)).toBe(2); // block align
    expect(view.getUint16(34, true)).toBe(16);
    expect(str(wav, 36, 4)).toBe('data');
  });
  it('sizes the chunks to the sample count', () => {
    expect(wav.byteLength).toBe(44 + 6 * 2);
    expect(view.getUint32(4, true)).toBe(wav.byteLength - 8);
    expect(view.getUint32(40, true)).toBe(12);
  });
  it('converts and clamps samples', () => {
    expect([0, 1, 2, 3, 4, 5].map((i) => view.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32768, 16384, 32767, -32768]);
  });
});

describe('mixToMono', () => {
  it('averages channels', () => {
    expect(Array.from(mixToMono([Float32Array.from([1, 0]), Float32Array.from([0, 1])]))).toEqual([0.5, 0.5]);
  });
});
