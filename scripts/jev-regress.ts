// Replays the proven TypeSafe experiments (experiments/typesafe) against the live API
// using the production question builders. Exits 1 if card accuracy < 0.9 or any
// DNC-request case is wrong.
// Usage: TYPESAFE_API_KEY=... tsx scripts/jev-regress.ts
import { jev } from '../lib/typesafe/client';
import {
  appointmentNoul,
  callbackTimeNoul,
  cardChoice,
  columnFieldChoice,
  dncColumnNoul,
  dncRequestNoul,
  dncValueChoice,
  outcomeChoice,
} from '../lib/typesafe/questions';
import { DEFAULT_PLAYBOOK } from '../lib/coach/playbook-default';

const T = { timeoutMs: 20000 };
const CALL_CONTEXT = 'Real estate agent cold-calling the owner of a recently expired home listing in Virginia.';

type Choice = { type: 'choice'; choice: string; confidence: number };
type Noul = { type: 'noul'; noul: number };

// [owner utterance, expected card, expected dnc]
const E1_CASES: [string, string, boolean][] = [
  ["Hello?", "none", false],
  ["Yeah, this is Mark.", "none", false],
  ["We're going to relist with Susan, she's been great.", "relisting_with_agent", false],
  ["Honestly we're just going to stay put for now and take it off the market.", "taking_off_market", false],
  ["I think we'll just put a sign in the yard and do it ourselves this time.", "selling_themselves", false],
  ["Why would I pay six percent when it didn't even sell?", "commission_objection", false],
  ["The photos were awful and we barely had any showings.", "why_didnt_it_sell", false],
  ["Our house is worth at least 450, we're not giving it away.", "price_expectation", false],
  ["We'll probably try again in the spring when the market picks up.", "timing_not_ready", false],
  ["I'm at work, can you call me back after five?", "call_me_later", false],
  ["How did you even get this number?", "how_got_number", false],
  ["You're like the eighth agent to call me today.", "agent_flood", false],
  ["We actually rented it out last week.", "already_sold_or_leased", false],
  ["Okay, so what would you do differently than our last agent?", "buying_signal", false],
  ["Not interested.", "not_interested", false],
  ["Not interested, take me off your list.", "not_interested", true],
  ["Do not call this number again.", "not_interested", true],
  ["Stop calling me, you're the tenth agent today, put me on your do not call list.", "agent_flood", true],
  ["Look, I'm busy, don't call me again until next week.", "call_me_later", false],
  ["Lose my number.", "not_interested", true],
  ["Uh huh, go on.", "none", false],
  ["What do you charge?", "buying_signal", false],
  ["If you can get me 425 net I'd listen.", "price_expectation", false],
  ["My husband handles all that, he's not home.", "call_me_later", false],
];

const PRIOR =
  "Rep: Hi, is this the owner of 4417 Grove Avenue? Owner: yeah who's this Rep: Daniel Yoon with eXp Realty, I saw your home came off the market and wanted to see what happened. Owner: uh yeah it just didn't move you know we had it up for like three months ";

// [last rep line, owner fragment, expected card, expected dnc]
const F2_CASES: [string, string, string, boolean][] = [
  ["Are you thinking of putting it back on the market?", "yeah no not really", "taking_off_market", false],
  ["Are you thinking of putting it back on the market?", "no yeah we are with the same lady", "relisting_with_agent", false],
  ["Would it make sense to sit down this week?", "i mean what would you even do different", "buying_signal", false],
  ["Would it make sense to sit down this week?", "um not right now like maybe", "timing_not_ready", false],
  ["What do you think kept it from selling?", "honestly the price i guess she had us too high", "why_didnt_it_sell", false],
  ["What do you think kept it from selling?", "i dunno you tell me", "why_didnt_it_sell", false],
  ["Is now a bad time?", "kinda im in the car", "call_me_later", false],
  ["Is now a bad time?", "uh", "none", false],
  ["Can I ask what price you'd need?", "we need to walk away with four twenty at least", "price_expectation", false],
  ["Would you be open to hearing my plan?", "man you guys keep calling all day", "agent_flood", false],
  ["Would you be open to hearing my plan?", "please just take this number off whatever list", "not_interested", true],
  ["Would you be open to hearing my plan?", "not today, try me next week", "call_me_later", false],
];

const OUTCOMES: Record<string, string> = {
  "appointment_set": "A specific meeting or listing appointment was agreed.",
  "callback_requested": "The owner agreed to talk again later; no appointment yet.",
  "not_interested": "The owner declined and the call ended without a next step.",
  "do_not_call": "The owner asked not to be called again.",
  "relisted_elsewhere": "The owner has relisted or is relisting with another agent.",
  "off_market_or_sold": "The home sold, was rented, or was taken off the market for good.",
  "wrong_person": "The person reached is not the owner and cannot speak for the owner.",
  "voicemail_or_machine": "An answering machine or voicemail greeting; no live conversation."
};

// [transcript, expected outcome, {appt, cb_time, dnc}]
const E2_CASES: [string, string, { appt: boolean; cb_time: boolean; dnc: boolean }][] = [
  ["Rep: Hi, is this Jane? I'm Daniel with eXp, calling about 4417 Grove since the listing came off. Owner: Yes. Rep: Would you be open to me stopping by to show you what I'd do differently? Owner: Sure, Thursday at 4 works. Rep: Great, Thursday at 4.", "appointment_set", {"appt": true, "cb_time": false, "dnc": false}],
  ["Rep: Hi, this is Daniel with eXp about your home on Patterson. Owner: I'm driving, can you call me tomorrow morning around ten? Rep: Absolutely, tomorrow at ten.", "callback_requested", {"appt": false, "cb_time": true, "dnc": false}],
  ["Rep: Hi, Daniel with eXp about your listing. Owner: We're not interested, thanks. Bye.", "not_interested", {"appt": false, "cb_time": false, "dnc": false}],
  ["Rep: Hi, Daniel with eXp. Owner: Take me off your list and don't call again. Rep: Understood, I'll remove you.", "do_not_call", {"appt": false, "cb_time": false, "dnc": true}],
  ["Rep: Hi, Daniel with eXp about the Monument Ave home. Owner: We signed with Keller Williams yesterday. Rep: Congrats, best of luck.", "relisted_elsewhere", {"appt": false, "cb_time": false, "dnc": false}],
  ["Rep: Hi, about your home on Hanover. Owner: We decided to keep it and rent it out, it's leased already.", "off_market_or_sold", {"appt": false, "cb_time": false, "dnc": false}],
  ["Rep: Hi, is Robert there? Owner: This is his tenant, he doesn't live here. Rep: Okay, thank you.", "wrong_person", {"appt": false, "cb_time": false, "dnc": false}],
  ["Owner: Hi, you've reached the Parkers, leave a message after the tone. Rep: Hi, this is Daniel with eXp, give me a call back at 804-555-0100.", "voicemail_or_machine", {"appt": false, "cb_time": false, "dnc": false}],
  ["Rep: Hi, Daniel with eXp. Owner: Call me next month, maybe. Rep: Will do. Owner: Actually, just don't call back, we're done.", "do_not_call", {"appt": false, "cb_time": false, "dnc": true}],
  ["Rep: Daniel with eXp about Grove Ave. Owner: Maybe, call me after the holidays. Rep: Sounds good.", "callback_requested", {"appt": false, "cb_time": false, "dnc": false}],
];

const FIELDS: Record<string, string> = {
  "owner_full_name": "Owner's full name, or two owners' names together.",
  "owner_first_name": "Owner's first name only.",
  "owner_last_name": "Owner's last name only.",
  "property_address": "Street address of the listed home.",
  "property_city": "City of the listed home.",
  "property_zip": "ZIP code of the listed home.",
  "mailing_address": "Owner's mailing street address, which may differ from the home.",
  "list_price": "Most recent asking price.",
  "original_price": "First asking price when the listing started.",
  "days_on_market": "Days the listing was on the market.",
  "expired_date": "Date the listing expired or was withdrawn.",
  "listing_office": "The listing brokerage or agent.",
  "phone": "A phone number for the owner.",
  "phone_type": "Whether a phone is mobile/wireless or landline.",
  "phone_dnc": "Whether a phone is on a do-not-call list.",
  "scrub_date": "Date the list was checked against do-not-call registries.",
  "email": "Owner email address.",
  "mls_number": "MLS listing ID.",
  "ignore": "Anything else: status codes, internal IDs, notes, coordinates."
};

// [header, sample values, expected field]
const E3_COLUMNS: [string, string[], string][] = [
  ["Owner Name", ["SMITH JANE & JOHN", "PARKER ROBERT", "NGUYEN THI"], "owner_full_name"],
  ["Situs Address", ["4417 GROVE AVE", "210 N BOULEVARD", "8261 REEDY KNOLL CT"], "property_address"],
  ["Mail Addr", ["PO BOX 2201", "4417 GROVE AVE", "1 OCEAN DR APT 4"], "mailing_address"],
  ["LP", ["425000", "389900", "615000"], "list_price"],
  ["Orig LP", ["450000", "399900", "650000"], "original_price"],
  ["CDOM", ["94", "121", "37"], "days_on_market"],
  ["Exp Date", ["11/12/2026", "11/10/2026", "11/13/2026"], "expired_date"],
  ["List Office", ["Long & Foster", "KW Richmond", "Joyner Fine Properties"], "listing_office"],
  ["Phone 1", ["(804) 555-0142", "8045550199", "804.555.0123"], "phone"],
  ["Phone 1 Type", ["W", "L", "W"], "phone_type"],
  ["Phone 1 DNC", ["Y", "N", "N"], "phone_dnc"],
  ["Ph2 Status", ["Clean", "DNC", "Clean"], "phone_dnc"],
  ["Line", ["Wireless", "Landline", "VoIP"], "phone_type"],
  ["Scrubbed On", ["2026-11-01", "2026-11-01", "2026-11-01"], "scrub_date"],
  ["MLS #", ["2531847", "2529901", "2533012"], "mls_number"],
  ["Status", ["X", "W", "X"], "ignore"],
  ["Lat", ["37.5531", "37.5612", "37.4120"], "ignore"],
  ["First", ["Jane", "Robert", "Thi"], "owner_first_name"],
  ["Last", ["Smith", "Parker", "Nguyen"], "owner_last_name"],
  ["Zip", ["23221", "23220", "23832"], "property_zip"],
  ["E-mail 1", ["jsmith@gmail.com", "", "thi.n@yahoo.com"], "email"],
];

// [column, value, expected]
const DNC_VALUES: [string, string, string][] = [
  ["Phone 1 DNC", "Y", "do_not_call"],
  ["Phone 1 DNC", "N", "callable"],
  ["Ph2 Status", "Clean", "callable"],
  ["Ph2 Status", "DNC", "do_not_call"],
  ["DNC Flag", "TRUE", "do_not_call"],
  ["DNC Flag", "FALSE", "callable"],
  ["Federal DNC", "Listed", "do_not_call"],
  ["Federal DNC", "Not Listed", "callable"],
  ["Phone 1 DNC", "", "unknown"],
  ["Ph2 Status", "Litigator", "do_not_call"],
  ["Phone 3 DNC", "?", "unknown"],
];

const pct = (n: number, d: number) => `${n}/${d} (${(n / d).toFixed(3)})`;

async function main() {
  let failed = false;

  // E1 + F2: coaching cards and DNC-request detection (36 cases).
  let cardOk = 0;
  let dncOk = 0;
  const cardMisses: string[] = [];
  const dncMisses: string[] = [];
  const coaching: { state: object; ctx: boolean; owner: string; card: string; dnc: boolean }[] = [
    ...E1_CASES.map(([owner, card, dnc]) => ({
      state: { call_context: CALL_CONTEXT, owner_said: owner },
      ctx: false,
      owner,
      card,
      dnc,
    })),
    ...F2_CASES.map(([rep, owner, card, dnc]) => ({
      state: {
        call_context: CALL_CONTEXT + ' Transcript is raw speech-to-text.',
        transcript_so_far: PRIOR + 'Rep: ' + rep,
        owner_said: owner,
      },
      ctx: true,
      owner,
      card,
      dnc,
    })),
  ];
  for (const c of coaching) {
    const a = await jev(
      c.state,
      { card: cardChoice(DEFAULT_PLAYBOOK, c.ctx), dnc: dncRequestNoul('owner_said') },
      T,
    );
    const got = (a.card as Choice).choice;
    const p = (a.dnc as Noul).noul;
    if (got === c.card) cardOk++;
    else cardMisses.push(`  "${c.owner}" expected=${c.card} got=${got}`);
    if (p >= 0.5 === c.dnc) dncOk++;
    else dncMisses.push(`  "${c.owner}" expected=${c.dnc} p=${p.toFixed(3)}`);
  }
  const cardAcc = cardOk / coaching.length;
  console.log(`== coaching cards: ${pct(cardOk, coaching.length)}`);
  cardMisses.forEach((m) => console.log(m));
  console.log(`== DNC request: ${dncOk}/${coaching.length}`);
  dncMisses.forEach((m) => console.log(m));
  if (cardAcc < 0.9 || dncOk !== coaching.length) failed = true;

  // E2: post-call outcomes.
  let outOk = 0;
  let flagOk = 0;
  for (const [transcript, expected, flags] of E2_CASES) {
    const a = await jev(
      { transcript },
      {
        outcome: outcomeChoice(OUTCOMES),
        appt: appointmentNoul(),
        cb_time: callbackTimeNoul(),
        dnc: dncRequestNoul('transcript'),
      },
      T,
    );
    const got = (a.outcome as Choice).choice;
    if (got === expected) outOk++;
    else console.log(`  outcome expected=${expected} got=${got} | ${transcript.slice(0, 60)}`);
    for (const k of ['appt', 'cb_time', 'dnc'] as const) {
      const ok = (a[k] as Noul).noul >= 0.5 === flags[k];
      if (ok) flagOk++;
      else console.log(`  ${k} wrong (p=${(a[k] as Noul).noul.toFixed(3)}) | ${transcript.slice(0, 60)}`);
    }
  }
  console.log(`== outcomes: ${pct(outOk, E2_CASES.length)}; appt/cb_time/dnc flags: ${pct(flagOk, E2_CASES.length * 3)}`);

  // E3: column mapping, DNC-column noul, DNC cell values.
  const headers = E3_COLUMNS.map((c) => c[0]);
  let colOk = 0;
  let dncColOk = 0;
  for (const [header, samples, expected] of E3_COLUMNS) {
    const column = { header, sample_values: samples };
    const a = await jev(
      {
        file: 'Expired-listing lead export purchased from a lead vendor',
        all_column_headers: headers,
        column,
      },
      { field: columnFieldChoice(FIELDS) },
      T,
    );
    const got = (a.field as Choice).choice;
    if (got === expected) colOk++;
    else console.log(`  column "${header}" expected=${expected} got=${got}`);
    const b = await jev({ all_column_headers: headers, column }, { is_dnc: dncColumnNoul() }, T);
    if ((b.is_dnc as Noul).noul >= 0.5 === (expected === 'phone_dnc')) dncColOk++;
    else console.log(`  dnc-column flag wrong for "${header}"`);
  }
  console.log(`== columns: ${pct(colOk, E3_COLUMNS.length)}; dnc-column noul: ${pct(dncColOk, E3_COLUMNS.length)}`);

  let valOk = 0;
  for (const [column_header, cell_value, expected] of DNC_VALUES) {
    const a = await jev({ column_header, cell_value }, { meaning: dncValueChoice() }, T);
    const got = (a.meaning as Choice).choice;
    if (got === expected) valOk++;
    else console.log(`  dnc value "${column_header}"="${cell_value}" expected=${expected} got=${got}`);
  }
  console.log(`== dnc cell values: ${pct(valOk, DNC_VALUES.length)}`);

  console.log(`\ncard accuracy ${cardAcc.toFixed(3)} (threshold 0.9); DNC ${dncOk}/${coaching.length}`);
  if (failed) {
    console.error('FAIL');
    process.exit(1);
  }
  console.log('PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
