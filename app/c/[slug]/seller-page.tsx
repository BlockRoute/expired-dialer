import { closestMatch, dateLabel, money, moneyK, streetOf, WINDOW_LABEL, type PublishedCma } from '@/lib/cma/seller';
import { CompExplorer, type MapActive, type MapComp } from './map';
import { SELLER_CSS } from './seller-css';

const FOOTER_CREDENTIAL = 'eXp Realty · Seller Representative Specialist (SRS) · danielyoonrealty.com';

const lot = (n: number | null) => (n == null ? 'n/a' : n >= 43_560 ? `${(n / 43_560).toFixed(2)} acres` : `${Math.round(n).toLocaleString('en-US')} sq ft`);
const show = (n: number | null) => (n == null ? 'n/a' : String(n));

/** Presentational: takes the get_published_cma row as props, so it renders with no database. */
export function SellerPage({ cma, fontClassName }: { cma: PublishedCma; fontClassName: string }) {
  const street = streetOf(cma.address);
  const place = cma.address.split(',').slice(1).join(',').trim();
  const s = cma.subject;
  const comps: MapComp[] = [...cma.comps]
    .sort((a, b) => b.soldDate.localeCompare(a.soldDate))
    .map((c, i) => ({ ...c, id: String(i + 1) }));
  const actives: MapActive[] = cma.actives.map((a, i) => ({ ...a, id: String.fromCharCode(65 + (i % 26)) }));
  const window = cma.time_window ? WINDOW_LABEL[cma.time_window] ?? cma.time_window : null;
  const far = comps.reduce((m, c) => Math.max(m, c.distanceMiles), 0);
  const heading = `Closed sales${window ? ` · ${window}` : ''}`;
  const closest = closestMatch(s, comps);
  const { low, high, medianPpsf } = cma.price_range;
  const prepared = dateLabel(cma.published_at);

  return (
    <div className={`${fontClassName} seller`}>
      <style>{SELLER_CSS}</style>
      <main className="wrap">
        <header>
          <div className="sect">Comparable sales</div>
          <h1>{street}</h1>
          <p className="sub">
            {place ? `${place} · ` : ''}{heading}
            {comps.length > 0 ? ` · within ${far.toFixed(1)} mi` : ''}
          </p>
        </header>

        <ul className="facts">
          <li><span>Beds</span><b>{show(s.beds)}</b></li>
          <li><span>Baths</span><b>{show(s.baths)}</b></li>
          <li><span>Sq ft</span><b>{s.sqft ? s.sqft.toLocaleString('en-US') : 'n/a'}</b></li>
          <li><span>Year built</span><b>{show(s.yearBuilt)}</b></li>
          <li><span>Lot</span><b>{lot(s.lotSqft)}</b></li>
          <li><span>Tax assessment</span><b>{s.taxAssessed ? money(s.taxAssessed) : 'n/a'}</b></li>
        </ul>

        <div className="sect list-head">{heading}</div>
        <CompExplorer subject={{ lat: s.lat, lng: s.lng }} comps={comps} actives={actives} subjectLabel={street} />

        <section className="value">
          <div className="sect">What the sales indicate</div>
          <div className="range">{moneyK(low)}–{moneyK(high)}</div>
          <p>
            Median {money(medianPpsf)} per sq ft across {comps.length} closed {comps.length === 1 ? 'sale' : 'sales'}
            {s.sqft ? `, applied to ${s.sqft.toLocaleString('en-US')} sq ft` : ''}.
            {closest
              ? ` Closest match: ${closest.address.split(',')[0]}, ${closest.sqft.toLocaleString('en-US')} sq ft, sold ${dateLabel(closest.soldDate)} for ${money(closest.soldPrice)} (${money(closest.ppsf)} per sq ft).`
              : ''}
          </p>
          {(cma.favor_note || cma.weigh_note) && (
            <div className="notes">
              {cma.favor_note && (
                <div><div className="sect">Works in your favor</div><p>{cma.favor_note}</p></div>
              )}
              {cma.weigh_note && (
                <div><div className="sect">Buyers will weigh</div><p>{cma.weigh_note}</p></div>
              )}
            </div>
          )}
          <div className="tablewrap">
            <table>
              <thead>
                <tr><th>Home</th><th>Sold</th><th className="n">Price</th><th className="n">Sq ft</th><th className="n">Per sq ft</th><th className="n">Days on market</th></tr>
              </thead>
              <tbody>
                <tr className="subject">
                  <td>{street} (your home)</td><td>n/a</td><td className="n">{moneyK(low)}–{moneyK(high)}</td>
                  <td className="n">{s.sqft ? s.sqft.toLocaleString('en-US') : 'n/a'}</td><td className="n">{money(medianPpsf)}</td><td className="n">n/a</td>
                </tr>
                {comps.map((c) => (
                  <tr key={c.zpid}>
                    <td>{c.id}. {c.address.split(',')[0]}</td><td>{dateLabel(c.soldDate)}</td><td className="n">{money(c.soldPrice)}</td>
                    <td className="n">{c.sqft.toLocaleString('en-US')}</td><td className="n">{money(c.ppsf)}</td><td className="n">{c.dom == null ? 'n/a' : c.dom}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">Prepared {prepared}.</p>
        </section>

        <footer>
          <div className="who">Daniel Yoon</div>
          <div>{FOOTER_CREDENTIAL}</div>
          <p className="disc">
            Data from public records and MLS feeds as published on Zillow, retrieved on or before {prepared}. Days on market runs from the
            first Zillow listing date to closing; new-build listings often go up before construction starts. This is a broker price opinion,
            not an appraisal.
          </p>
        </footer>
      </main>
    </div>
  );
}
