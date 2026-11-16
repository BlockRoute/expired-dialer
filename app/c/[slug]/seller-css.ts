// Tokens and layout from the cma-comp-map skill, Step 4. Scoped to .seller so nothing leaks to the app.
export const SELLER_CSS = `
.seller{--bg:#f5f6f8;--surface:#ffffff;--ink:#1b1f24;--muted:#5f6772;--line:#e2e5ea;--accent:#2f4a6d;--active:#4f7a6c;--chip:#eef1f5;--ring:#9aa8ba;
  background:var(--bg);color:var(--ink);min-height:100vh;font-variant-numeric:tabular-nums;line-height:1.5}
@media (prefers-color-scheme: dark){.seller{--bg:#101317;--surface:#171b20;--ink:#e7ebef;--muted:#9aa3ad;--line:#282e36;--accent:#9db6d6;--active:#86b5a6;--chip:#1e242b}}
.seller *{box-sizing:border-box}
.seller .wrap{max-width:1180px;margin:0 auto;padding:28px 20px 40px}
.seller h1{font-size:clamp(26px,4vw,38px);line-height:1.15;margin:4px 0 6px;font-weight:700;letter-spacing:-0.01em}
.seller .sub{margin:0;color:var(--muted)}
.seller .sect{color:var(--accent);font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.seller .list-head{margin:26px 0 10px}
.seller .facts{display:flex;flex-wrap:wrap;gap:10px;list-style:none;padding:0;margin:20px 0 0}
.seller .facts li{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:10px 14px;min-width:96px}
.seller .facts span{display:block;color:var(--muted);font-size:12px}
.seller .facts b{font-size:17px;font-weight:700}
.seller .explorer{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:16px;align-items:start}
.seller .map{height:560px;border:1px solid var(--line);border-radius:12px;background:var(--chip);z-index:0}
.seller .side{display:flex;flex-direction:column;gap:12px}
.seller .detail,.seller .value{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:16px}
.seller .value{margin-top:22px;padding:22px}
.seller .d-addr{font-weight:600;margin-top:2px}
.seller .d-price{font-size:28px;font-weight:700;margin:2px 0 10px}
.seller .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 14px;margin:0 0 12px}
.seller .grid dt{color:var(--muted);font-size:12px}
.seller .grid dd{margin:0;font-weight:600}
.seller a{color:var(--accent);font-weight:600}
.seller .list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.seller .row{width:100%;display:flex;align-items:center;gap:10px;text-align:left;font:inherit;color:inherit;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:8px 10px;cursor:pointer}
.seller .row.on{border-color:var(--accent);background:var(--chip)}
.seller .r-main{flex:1;min-width:0;display:flex;flex-direction:column}
.seller .r-addr{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.seller .r-sub{color:var(--muted);font-size:12px}
.seller .r-price{font-weight:700}
.seller .pin{display:flex;align-items:center;justify-content:center;border-radius:50%;color:#fff;font-weight:700;font-size:13px;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)}
.seller .pin-sold{width:28px;height:28px;background:var(--accent)}
.seller .pin-sold.sm{width:24px;height:24px;flex:none;box-shadow:none}
.seller .pin-subject{width:40px;height:40px;background:#14181c;font-size:20px;border-radius:12px}
.seller .ptip{background:var(--surface);color:var(--ink);border:1px solid var(--line);font-weight:700;font-size:12px;box-shadow:none;padding:1px 6px}
.seller .ptip::before{display:none}
.seller .leaflet-control-attribution{font-size:10px;opacity:.65}
.seller .leaflet-popup-content{margin:12px 14px}
.seller .pop-price{font-size:18px;font-weight:700}
.seller .pop-sub,.seller .pop-facts{color:#5f6772;font-size:12px}
.seller .pop-addr{font-weight:600;margin:4px 0 2px}
.seller .range{font-size:clamp(28px,5vw,42px);font-weight:700;margin:6px 0 4px;color:var(--ink)}
.seller .value p{margin:6px 0}
.seller .notes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin:14px 0}
.seller .muted{color:var(--muted);font-size:13px}
.seller .tablewrap{overflow-x:auto;margin-top:14px}
.seller table{width:100%;border-collapse:collapse;font-size:14px}
.seller th,.seller td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
.seller th{color:var(--muted);font-size:12px;font-weight:600}
.seller .n{text-align:right}
.seller tr.subject td{background:var(--chip);font-weight:700}
.seller footer{margin-top:28px;color:var(--muted);font-size:13px}
.seller footer .who{color:var(--ink);font-weight:700;font-size:15px}
.seller footer .disc{max-width:760px}
@media (max-width:860px){
  .seller .explorer{grid-template-columns:minmax(0,1fr)}
  .seller .map{height:440px}
  .seller .notes{grid-template-columns:minmax(0,1fr)}
}
`;
