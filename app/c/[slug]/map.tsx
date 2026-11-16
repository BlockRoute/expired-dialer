'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import type { LayerGroup, Map as LMap, Marker } from 'leaflet';
import type { Active, Comp } from '@/lib/cma/types';
import { dateLabel, money, moneyK, ringsFor } from '@/lib/cma/seller';

export type MapComp = Comp & { id: string };
export type MapActive = Active & { id: string };
type Pt = { lat: number; lng: number };

const CARTO = 'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=cb1_41vq_1_33a632382dbe542ebbe73d37';
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const MILE_M = 1609.344;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const domText = (c: Comp) => (c.dom == null ? 'days on market n/a' : `${c.dom} days on market`);
const lot = (n: number | null) => (n == null ? 'n/a' : n >= 43_560 ? `${(n / 43_560).toFixed(2)} ac` : `${Math.round(n).toLocaleString('en-US')} sq ft`);
const num = (n: number | null) => (n == null ? 'n/a' : String(n));

function popupHtml(c: MapComp) {
  return `<div class="pop"><div class="pop-price">${money(c.soldPrice)}</div>`
    + `<div class="pop-sub">${esc(dateLabel(c.soldDate))} · ${esc(domText(c))}</div>`
    + `<div class="pop-addr">${esc(c.address)}</div>`
    + `<div class="pop-facts">${num(c.beds)} bd · ${num(c.baths)} ba · ${c.sqft.toLocaleString('en-US')} sq ft · ${money(c.ppsf)} per sq ft</div>`
    + `<a href="${esc(c.zillowUrl)}" target="_blank" rel="noreferrer noopener">View on Zillow</a></div>`;
}

function activePopupHtml(a: MapActive) {
  return `<div class="pop"><div class="pop-price">${money(a.listPrice)} asking</div>`
    + `<div class="pop-sub">${a.dom == null ? 'days on market n/a' : `${a.dom} days on market`}</div>`
    + `<div class="pop-addr">${esc(a.address)}</div>`
    + `<div class="pop-facts">${num(a.beds)} bd · ${num(a.baths)} ba · ${a.sqft ? a.sqft.toLocaleString('en-US') : 'n/a'} sq ft</div>`
    + `<a href="${esc(a.zillowUrl)}" target="_blank" rel="noreferrer noopener">View on Zillow</a></div>`;
}

export function CompExplorer({ subject, comps, actives, subjectLabel }: { subject: Pt; comps: MapComp[]; actives: MapActive[]; subjectLabel: string }) {
  const [showActives, setShowActives] = useState(true);
  const activeLayer = useRef<LayerGroup | null>(null);
  const showRef = useRef(true);
  const [selected, setSelected] = useState<string>(comps[0]?.id ?? '');
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LMap | null>(null);
  const markers = useRef<Record<string, Marker>>({});
  const select = useRef(setSelected);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !el.current) return;
      const m = L.map(el.current, { attributionControl: false, scrollWheelZoom: false });
      map.current = m;
      const streets = L.tileLayer(CARTO, { maxZoom: 19, attribution: '© OSM © CARTO' }).addTo(m);
      const sat = L.tileLayer(ESRI, { maxZoom: 19, attribution: '© Esri' });
      L.control.layers({ Streets: streets, Satellite: sat }).addTo(m);
      L.control.scale({ imperial: true, metric: false }).addTo(m);
      L.control.attribution({ prefix: false }).addTo(m);

      const home = L.marker([subject.lat, subject.lng], {
        icon: L.divIcon({ className: '', html: '<div class="pin pin-subject">⌂</div>', iconSize: [40, 40], iconAnchor: [20, 20] }),
        zIndexOffset: 1000,
      }).addTo(m);
      home.bindTooltip(esc(subjectLabel), { permanent: true, direction: 'right', offset: [18, 0], className: 'ptip' });

      const bounds = L.latLngBounds([[subject.lat, subject.lng]]);
      let far = 0;
      for (const c of comps) {
        far = Math.max(far, c.distanceMiles);
        bounds.extend([c.lat, c.lng]);
        const mk = L.marker([c.lat, c.lng], {
          icon: L.divIcon({ className: '', html: `<div class="pin pin-sold">${esc(c.id)}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] }),
        }).addTo(m);
        mk.bindTooltip(moneyK(c.soldPrice), { permanent: true, direction: 'right', offset: [12, 0], className: 'ptip' });
        mk.bindPopup(popupHtml(c));
        mk.on('click', () => select.current(c.id));
        markers.current[c.id] = mk;
      }
      const layer = L.layerGroup();
      for (const a of actives) {
        bounds.extend([a.lat, a.lng]);
        far = Math.max(far, a.distanceMiles);
        const mk = L.marker([a.lat, a.lng], {
          icon: L.divIcon({ className: '', html: `<div class="pin pin-active">${esc(a.id)}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
        });
        mk.bindTooltip(moneyK(a.listPrice), { permanent: true, direction: 'right', offset: [12, 0], className: 'ptip' });
        mk.bindPopup(activePopupHtml(a));
        mk.on('click', () => select.current(a.id));
        markers.current[a.id] = mk;
        layer.addLayer(mk);
      }
      activeLayer.current = layer;
      if (showRef.current) layer.addTo(m);
      for (const miles of ringsFor(far)) {
        L.circle([subject.lat, subject.lng], { radius: miles * MILE_M, color: '#9aa8ba', weight: 1.5, dashArray: '6 6', fill: false, interactive: false }).addTo(m);
      }
      m.fitBounds(bounds.pad(0.18));
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      markers.current = {};
      activeLayer.current = null;
    };
  }, [subject.lat, subject.lng, comps, actives, subjectLabel]);

  useEffect(() => {
    const m = map.current;
    const layer = activeLayer.current;
    if (!m || !layer) return;
    if (showActives) layer.addTo(m); else layer.remove();
  }, [showActives]);

  useEffect(() => {
    const mk = markers.current[selected];
    if (mk && map.current) mk.openPopup();
  }, [selected]);

  const sel = comps.find((c) => c.id === selected) ?? null;
  const selActive = actives.find((a) => a.id === selected) ?? null;

  return (
    <section className="explorer">
      <div className="mapwrap">
        <div ref={el} className="map" role="region" aria-label="Map of the subject home and closed sales" />
      </div>
      <div className="side">
        <div className="detail" aria-live="polite">
          {sel ? (
            <>
              <div className="sect">Sale {sel.id}</div>
              <div className="d-addr">{sel.address}</div>
              <div className="d-price">{money(sel.soldPrice)}</div>
              <dl className="grid">
                <div><dt>Sold</dt><dd>{dateLabel(sel.soldDate)}</dd></div>
                <div><dt>Days on market</dt><dd>{sel.dom == null ? 'n/a' : sel.dom}</dd></div>
                <div><dt>Beds / baths</dt><dd>{num(sel.beds)} / {num(sel.baths)}</dd></div>
                <div><dt>Sq ft</dt><dd>{sel.sqft.toLocaleString('en-US')}</dd></div>
                <div><dt>Per sq ft</dt><dd>{money(sel.ppsf)}</dd></div>
                <div><dt>Year built</dt><dd>{num(sel.yearBuilt)}</dd></div>
                <div><dt>Lot</dt><dd>{lot(sel.lotSqft)}</dd></div>
                <div><dt>Distance</dt><dd>{sel.distanceMiles.toFixed(2)} mi</dd></div>
              </dl>
              <a href={sel.zillowUrl} target="_blank" rel="noreferrer noopener">View on Zillow</a>
            </>
          ) : selActive ? (
            <>
              <div className="sect">Active {selActive.id}</div>
              <div className="d-addr">{selActive.address}</div>
              <div className="d-price">{money(selActive.listPrice)}</div>
              <dl className="grid">
                <div><dt>Days on market</dt><dd>{selActive.dom == null ? 'n/a' : selActive.dom}</dd></div>
                <div><dt>Beds / baths</dt><dd>{num(selActive.beds)} / {num(selActive.baths)}</dd></div>
                <div><dt>Sq ft</dt><dd>{selActive.sqft ? selActive.sqft.toLocaleString('en-US') : 'n/a'}</dd></div>
                <div><dt>Distance</dt><dd>{selActive.distanceMiles.toFixed(2)} mi</dd></div>
              </dl>
              <a href={selActive.zillowUrl} target="_blank" rel="noreferrer noopener">View on Zillow</a>
            </>
          ) : (
            <div className="muted">Select a sale for its details.</div>
          )}
        </div>
        <ol className="list">
          {comps.map((c) => (
            <li key={c.id}>
              <button type="button" className={c.id === selected ? 'row on' : 'row'} onClick={() => setSelected(c.id)}>
                <span className="pin pin-sold sm">{c.id}</span>
                <span className="r-main">
                  <span className="r-addr">{c.address.split(',')[0]}</span>
                  <span className="r-sub">{dateLabel(c.soldDate)} · {c.sqft.toLocaleString('en-US')} sq ft · {money(c.ppsf)} per sq ft</span>
                </span>
                <span className="r-price">{money(c.soldPrice)}</span>
              </button>
            </li>
          ))}
        </ol>
        {actives.length > 0 && (
          <>
            <div className="sect active-head">
              Active competition
              <label className="toggle">
                <input type="checkbox" checked={showActives} onChange={(e) => { showRef.current = e.target.checked; setShowActives(e.target.checked); }} /> Show on map
              </label>
            </div>
            <ol className="list">
              {actives.map((a) => (
                <li key={a.id}>
                  <button type="button" className={a.id === selected ? 'row on' : 'row'} onClick={() => setSelected(a.id)}>
                    <span className="pin pin-active sm">{a.id}</span>
                    <span className="r-main">
                      <span className="r-addr">{a.address.split(',')[0]}</span>
                      <span className="r-sub">{a.dom == null ? 'days on market n/a' : `${a.dom} days on market`} · {a.sqft ? `${a.sqft.toLocaleString('en-US')} sq ft` : 'sq ft n/a'}</span>
                    </span>
                    <span className="r-price">{money(a.listPrice)}</span>
                  </button>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </section>
  );
}
