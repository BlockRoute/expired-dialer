import { describe, it, expect } from 'vitest';
import { indicatedValue } from './value';
import type { Comp, Subject } from './types';

const subject = { sqft: 2010 } as Subject;
const comp = (soldPrice: number, sqft: number) => ({ soldPrice, sqft, ppsf: soldPrice / sqft }) as Comp;

describe('indicatedValue', () => {
  // ppsf: 190, 210, 200, 220, 239.4737, 200 -> sorted 190,200,200,210,220,239.4737
  const comps = [
    comp(380000, 2000),
    comp(399000, 1900),
    comp(420000, 2100),
    comp(440000, 2000),
    comp(455000, 1900),
    comp(410000, 2050),
  ];

  it('uses median $/sqft x subject sqft, with the interquartile span rounded out to $5k', () => {
    // median = (200 + 210) / 2 = 205; point = 205 x 2010 = 412,050
    // Q1 = 200 (index 1.25), Q3 = 210 + 0.75 x 10 = 217.5 (index 3.75)
    // low = 200 x 2010 = 402,000 -> 400,000; high = 217.5 x 2010 = 437,175 -> 440,000
    expect(indicatedValue(subject, comps)).toEqual({ medianPpsf: 205, point: 412050, low: 400000, high: 440000 });
  });

  it('throws without comps or subject sqft rather than inventing a value', () => {
    expect(() => indicatedValue(subject, [])).toThrow();
    expect(() => indicatedValue({ sqft: null } as Subject, comps)).toThrow();
  });
});
