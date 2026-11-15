import { describe, expect, it } from 'vitest';
import { renderSay } from './render';

describe('renderSay', () => {
  it('fills name and CMA range', () => {
    expect(renderSay('Hi %lead.first_name%, %cma.range%', { first_name: 'Jane' }, { low: 395000, high: 415000 })).toBe(
      'Hi Jane, $395k–$415k',
    );
  });
  it('formats list price and DOM, accepts the DB column name', () => {
    expect(
      renderSay('%lead.first_name% at %lead.list_price% after %lead.days_on_market% days', {
        owner_first_name: 'Sam',
        list_price: 425000,
        days_on_market: 61,
      }, null),
    ).toBe('Sam at $425k after 61 days');
  });
  it('renders unknown or missing variables empty and trims', () => {
    expect(renderSay('%lead.first_name% , call %cma.range%', {}, null)).toBe(', call');
    expect(renderSay('Hello %lead.nope%', { first_name: 'A' }, null)).toBe('Hello');
  });
});
