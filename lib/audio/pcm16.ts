/** Float samples in [-1, 1] to little-endian PCM16, clamping out-of-range input. */
export function floatToPcm16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = Math.round(s < 0 ? s * 0x8000 : s * 0x7fff);
  }
  return out;
}

/**
 * Stateful box-filter downsampler (averages each output bin). Keeps the
 * fractional position and partial bin between chunks so the stream stays
 * continuous across worklet blocks.
 */
export function createDownsampler(inRate: number, outRate: number): (chunk: Float32Array) => Float32Array {
  const ratio = inRate / outRate;
  let acc = 0;
  let sum = 0;
  let count = 0;
  return (chunk) => {
    const out: number[] = [];
    for (let i = 0; i < chunk.length; i++) {
      sum += chunk[i];
      count++;
      acc += 1;
      if (acc >= ratio - 1e-9) {
        out.push(sum / count);
        acc -= ratio;
        sum = 0;
        count = 0;
      }
    }
    return Float32Array.from(out);
  };
}
