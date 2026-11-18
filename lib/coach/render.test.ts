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
  it('fills last name and property city', () => {
    expect(
      renderSay('%lead.first_name% %lead.last_name% in %lead.city%', {
        owner_first_name: 'Jane',
        owner_last_name: 'Smith',
        property_city: 'Chester',
      }, null),
    ).toBe('Jane Smith in Chester');
  });
  it('title-cases all-caps vendor names and cities, leaves mixed case alone', () => {
    expect(
      renderSay('%lead.first_name% %lead.last_name%, %lead.city%', {
        owner_first_name: 'MARY-ANN',
        owner_last_name: "O'BRIEN",
        property_city: 'NORTH CHESTERFIELD',
      }, null),
    ).toBe("Mary-Ann O'Brien, North Chesterfield");
    expect(renderSay('%lead.last_name%', { owner_last_name: 'McDonald' }, null)).toBe('McDonald');
  });
  it('falls back to "your area" when the lead has no city', () => {
    expect(renderSay('FSBOs around %lead.city% sold', {}, null)).toBe('FSBOs around your area sold');
  });
  it('renders unknown or missing variables empty and trims', () => {
    expect(renderSay('%lead.first_name% , call %cma.range%', {}, null)).toBe(', call');
    expect(renderSay('Hello %lead.nope%', { first_name: 'A' }, null)).toBe('Hello');
  });
});
