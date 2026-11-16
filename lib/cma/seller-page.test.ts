import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SellerPage } from '@/app/c/[slug]/seller-page';
import { notFoundMetadata, sellerMetadata, ringsFor, closestMatch, streetOf } from './seller';
import { PUBLISHED } from './fixtures/published';

const html = () => renderToStaticMarkup(createElement(SellerPage, { cma: PUBLISHED, fontClassName: 'f' }));

describe('SellerPage', () => {
  it('renders the street as the heading and the exact footer credential line', () => {
    const h = html();
    expect(h).toContain('<h1');
    expect(h).toContain('4417 Grove Ave');
    expect(h).toContain('eXp Realty · Seller Representative Specialist (SRS) · danielyoonrealty.com');
  });

  it('has no em-dash, exclamation mark in copy, Luxury Division or AVM wording', () => {
    const h = html();
    expect(h).not.toContain('—');
    expect(h).not.toMatch(/Luxury Division|Zestimate/i);
    expect(h.replace(/<[^>]*>/g, ' ')).not.toContain('!');
  });

  it('shows the range, notes, comps and the data disclaimer', () => {
    const h = html();
    expect(h).toContain('$395k–$415k');
    expect(h).toContain('Works in your favor');
    expect(h).toContain('Corner lot with a detached garage.');
    expect(h).toContain('Buyers will weigh');
    expect(h).toContain('Closed sales · last 3 months');
    expect(h).toContain('4501 Grove Ave');
    expect(h).toContain('broker price opinion, not an appraisal');
    expect(h).toContain('Days on market runs from the first Zillow listing date to closing');
  });

  it('shows the active toggle and active rows when actives exist, and omits them otherwise', () => {
    const h = html();
    expect(h).toContain('Active competition');
    expect(h).toContain('type="checkbox"');
    expect(h).toContain('4425 Grove Ave');
    const none = renderToStaticMarkup(createElement(SellerPage, { cma: { ...PUBLISHED, actives: [] }, fontClassName: 'f' }));
    expect(none).not.toContain('Active competition');
    expect(none).not.toContain('type="checkbox"');
  });

  it('omits an empty note section', () => {
    const h = renderToStaticMarkup(createElement(SellerPage, { cma: { ...PUBLISHED, favor_note: null }, fontClassName: 'f' }));
    expect(h).not.toContain('Works in your favor');
    expect(h).toContain('Buyers will weigh');
  });
});

describe('sellerMetadata', () => {
  it('titles the page "<street> Comps" and marks it noindex', () => {
    const m = sellerMetadata(PUBLISHED.address);
    expect(m.title).toBe('4417 Grove Ave Comps');
    expect(m.robots).toBe('noindex');
  });
  it('sets a neutral description and openGraph so the app text is not inherited', () => {
    const m = sellerMetadata(PUBLISHED.address);
    expect(m.description).toBe('Recent closed sales near 4417 Grove Ave');
    expect(m.openGraph).toMatchObject({ title: '4417 Grove Ave Comps', description: 'Recent closed sales near 4417 Grove Ave' });
    expect(JSON.stringify(m)).not.toMatch(/cold-calling|dialer|workspace/i);
    expect(JSON.stringify(m)).not.toMatch(/—|!/);
  });
  it('not-found metadata is neutral and noindex too', () => {
    const m = notFoundMetadata();
    expect(m.robots).toBe('noindex');
    expect(JSON.stringify(m)).not.toMatch(/cold-calling|workspace/i);
    expect(m.description).toBeTruthy();
    expect(m.openGraph).toBeTruthy();
  });
});

describe('seller helpers', () => {
  it('streetOf takes the part before the first comma', () => expect(streetOf(PUBLISHED.address)).toBe('4417 Grove Ave'));
  it('ringsFor sizes rings to the comp spread', () => {
    expect(ringsFor(0.2)).toEqual([0.1, 0.2]);
    expect(ringsFor(0.5)).toEqual([0.25, 0.5]);
    expect(ringsFor(1.4)).toEqual([0.5, 1]);
  });
  it('closestMatch picks the comp nearest the subject sqft, newest on a tie', () => {
    expect(closestMatch(PUBLISHED.subject, PUBLISHED.comps)?.zpid).toBe('1002');
  });
});
