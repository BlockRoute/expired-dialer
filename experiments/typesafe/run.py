#!/usr/bin/env python3
"""TypeSafe (Jev) experiments for the Expired Dialer design.

E1  Live-coaching router: classify each owner utterance into a playbook card
    (Choice) + a compliance Noul for "asked not to be called".
E2  Post-call outcome: classify a finished transcript into the outcome list
    (Choice) + Nouls for appointment / callback-with-time / DNC request.
E3  Import mapping: map vendor spreadsheet columns to dialer fields (Choice),
    and interpret DNC flag spellings (Choice).

Data is synthetic, written to resemble expired-listing calls and vendor
exports. Results show whether the approach is worth adopting, not production
accuracy.

Key: read from TYPESAFE_API_KEY, else from ../../.env.local (KEY=VALUE line).
Usage: python3 -I run.py [e1|e2|e3|all]
"""
import json, os, statistics, sys, time, urllib.request, urllib.error
from pathlib import Path

API = "https://api.typesafe.ai/v1/systemone"
MODEL = os.environ.get("TYPESAFE_MODEL", "jev-latest")
HERE = Path(__file__).resolve().parent
OUT = HERE / "results"


def api_key():
    k = os.environ.get("TYPESAFE_API_KEY")
    if k:
        return k
    env = HERE.parent.parent / ".env.local"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("TYPESAFE_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"')
    sys.exit("TYPESAFE_API_KEY not set (env or ~/expired-dialer/.env.local)")


KEY = api_key()


def ask(state, questions, retries=4):
    body = json.dumps({"model": MODEL, "state": state, "questions": questions}).encode()
    for attempt in range(retries):
        req = urllib.request.Request(API, data=body, headers={
            "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
        t0 = time.perf_counter()
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.load(r)
            return data, (time.perf_counter() - t0) * 1000
        except urllib.error.HTTPError as e:
            if e.code in (429, 529) and attempt < retries - 1:
                time.sleep(2 ** attempt)
                continue
            raise SystemExit(f"HTTP {e.code}: {e.read().decode()[:500]}")


# ---------------------------------------------------------------- E1
PLAYBOOK = {
    "relisting_with_agent": "The owner says they plan to relist, or are staying, with their current or previous listing agent.",
    "taking_off_market": "The owner says they are taking the home off the market, keeping it, or no longer selling.",
    "selling_themselves": "The owner says they will sell it themselves (FSBO) or without an agent.",
    "commission_objection": "The owner objects to agent fees or commission.",
    "why_didnt_it_sell": "The owner gives or asks for a reason the listing did not sell (price, market, agent, showings, photos).",
    "price_expectation": "The owner insists the home is worth more than it was listed for, or will not take less than a specific number.",
    "timing_not_ready": "The owner wants to wait for a later season, life event, or market change before trying again.",
    "call_me_later": "The owner is busy right now and asks to talk at another time, without refusing.",
    "how_got_number": "The owner asks how the caller got their number or who the caller is.",
    "agent_flood": "The owner complains that many agents have been calling since the listing expired.",
    "already_sold_or_leased": "The owner says the home already sold, is under contract, or was rented out.",
    "buying_signal": "The owner shows interest: asks what the caller would do differently, about the caller's plan, fees, or availability to meet.",
    "not_interested": "A flat refusal with no reason given.",
    "none": "Nothing for the caller to respond to: greetings, acknowledgements, small talk, or filler.",
}

E1_CASES = [  # (owner utterance, expected card, expected dnc)
    ("Hello?", "none", False),
    ("Yeah, this is Mark.", "none", False),
    ("We're going to relist with Susan, she's been great.", "relisting_with_agent", False),
    ("Honestly we're just going to stay put for now and take it off the market.", "taking_off_market", False),
    ("I think we'll just put a sign in the yard and do it ourselves this time.", "selling_themselves", False),
    ("Why would I pay six percent when it didn't even sell?", "commission_objection", False),
    ("The photos were awful and we barely had any showings.", "why_didnt_it_sell", False),
    ("Our house is worth at least 450, we're not giving it away.", "price_expectation", False),
    ("We'll probably try again in the spring when the market picks up.", "timing_not_ready", False),
    ("I'm at work, can you call me back after five?", "call_me_later", False),
    ("How did you even get this number?", "how_got_number", False),
    ("You're like the eighth agent to call me today.", "agent_flood", False),
    ("We actually rented it out last week.", "already_sold_or_leased", False),
    ("Okay, so what would you do differently than our last agent?", "buying_signal", False),
    ("Not interested.", "not_interested", False),
    ("Not interested, take me off your list.", "not_interested", True),
    ("Do not call this number again.", "not_interested", True),
    ("Stop calling me, you're the tenth agent today, put me on your do not call list.", "agent_flood", True),
    ("Look, I'm busy, don't call me again until next week.", "call_me_later", False),
    ("Lose my number.", "not_interested", True),
    ("Uh huh, go on.", "none", False),
    ("What do you charge?", "buying_signal", False),
    ("If you can get me 425 net I'd listen.", "price_expectation", False),
    ("My husband handles all that, he's not home.", "call_me_later", False),
]

DNC_Q = {
    "type": "noul",
    "instructions": "In `owner_said`, does the homeowner ask the caller to stop calling them, remove them from a calling list, or never call this number again? A request to call at a later time is NOT a request to stop calling.",
}


def e1():
    rows, lat = [], []
    for utt, exp_card, exp_dnc in E1_CASES:
        state = {
            "call_context": "Real estate agent cold-calling the owner of a recently expired home listing in Virginia.",
            "owner_said": utt,
        }
        qs = {
            "card": {"type": "choice",
                     "instructions": "Which response card should the agent's screen show for what the homeowner just said in `owner_said`?",
                     "criteria": PLAYBOOK},
            "dnc": DNC_Q,
        }
        res, ms = ask(state, qs)
        a = res["answers"]
        lat.append(ms)
        rows.append({"utterance": utt, "expected": exp_card, "got": a["card"]["choice"],
                     "confidence": round(a["card"]["confidence"], 3),
                     "dnc_expected": exp_dnc, "dnc_p": round(a["dnc"]["noul"], 3), "ms": round(ms)})
    card_acc = sum(r["got"] == r["expected"] for r in rows) / len(rows)
    dnc_tp = [r for r in rows if r["dnc_expected"]]
    dnc_tn = [r for r in rows if not r["dnc_expected"]]
    summary = {
        "card_accuracy": round(card_acc, 3),
        "dnc_recall@0.5": sum(r["dnc_p"] >= .5 for r in dnc_tp) / len(dnc_tp),
        "dnc_false_positive@0.5": sum(r["dnc_p"] >= .5 for r in dnc_tn) / len(dnc_tn),
        "min_dnc_p_on_true": min(r["dnc_p"] for r in dnc_tp),
        "max_dnc_p_on_false": max(r["dnc_p"] for r in dnc_tn),
        "latency_ms_median": round(statistics.median(lat)),
        "latency_ms_p90": round(sorted(lat)[int(len(lat) * .9) - 1]),
        "misses": [r for r in rows if r["got"] != r["expected"]],
        "low_confidence": [r for r in rows if r["confidence"] < .6],
    }
    return rows, summary


# ---------------------------------------------------------------- E2
OUTCOMES = {
    "appointment_set": "A specific meeting or listing appointment was agreed.",
    "callback_requested": "The owner agreed to talk again later; no appointment yet.",
    "not_interested": "The owner declined and the call ended without a next step.",
    "do_not_call": "The owner asked not to be called again.",
    "relisted_elsewhere": "The owner has relisted or is relisting with another agent.",
    "off_market_or_sold": "The home sold, was rented, or was taken off the market for good.",
    "wrong_person": "The person reached is not the owner and cannot speak for the owner.",
    "voicemail_or_machine": "An answering machine or voicemail greeting; no live conversation.",
}

E2_CASES = [
    ("Rep: Hi, is this Jane? I'm Daniel with eXp, calling about 4417 Grove since the listing came off. Owner: Yes. Rep: Would you be open to me stopping by to show you what I'd do differently? Owner: Sure, Thursday at 4 works. Rep: Great, Thursday at 4.", "appointment_set", {"appt": True, "cb_time": False, "dnc": False}),
    ("Rep: Hi, this is Daniel with eXp about your home on Patterson. Owner: I'm driving, can you call me tomorrow morning around ten? Rep: Absolutely, tomorrow at ten.", "callback_requested", {"appt": False, "cb_time": True, "dnc": False}),
    ("Rep: Hi, Daniel with eXp about your listing. Owner: We're not interested, thanks. Bye.", "not_interested", {"appt": False, "cb_time": False, "dnc": False}),
    ("Rep: Hi, Daniel with eXp. Owner: Take me off your list and don't call again. Rep: Understood, I'll remove you.", "do_not_call", {"appt": False, "cb_time": False, "dnc": True}),
    ("Rep: Hi, Daniel with eXp about the Monument Ave home. Owner: We signed with Keller Williams yesterday. Rep: Congrats, best of luck.", "relisted_elsewhere", {"appt": False, "cb_time": False, "dnc": False}),
    ("Rep: Hi, about your home on Hanover. Owner: We decided to keep it and rent it out, it's leased already.", "off_market_or_sold", {"appt": False, "cb_time": False, "dnc": False}),
    ("Rep: Hi, is Robert there? Owner: This is his tenant, he doesn't live here. Rep: Okay, thank you.", "wrong_person", {"appt": False, "cb_time": False, "dnc": False}),
    ("Owner: Hi, you've reached the Parkers, leave a message after the tone. Rep: Hi, this is Daniel with eXp, give me a call back at 804-555-0100.", "voicemail_or_machine", {"appt": False, "cb_time": False, "dnc": False}),
    ("Rep: Hi, Daniel with eXp. Owner: Call me next month, maybe. Rep: Will do. Owner: Actually, just don't call back, we're done.", "do_not_call", {"appt": False, "cb_time": False, "dnc": True}),
    ("Rep: Daniel with eXp about Grove Ave. Owner: Maybe, call me after the holidays. Rep: Sounds good.", "callback_requested", {"appt": False, "cb_time": False, "dnc": False}),
]


def e2():
    rows, lat = [], []
    for transcript, exp, flags in E2_CASES:
        qs = {
            "outcome": {"type": "choice",
                        "instructions": "What was the outcome of this cold call to the owner of an expired listing, based on `transcript`? Use the final position the owner took.",
                        "criteria": OUTCOMES},
            "appt": {"type": "noul", "instructions": "In `transcript`, did the owner agree to a specific day and time to meet in person?"},
            "cb_time": {"type": "noul", "instructions": "In `transcript`, did the owner give a specific day or time for a follow-up call (not just 'later' or 'after the holidays')?"},
            "dnc": DNC_Q | {"instructions": DNC_Q["instructions"].replace("`owner_said`", "`transcript`") + " Use the owner's final word on this."},
        }
        res, ms = ask({"transcript": transcript}, qs)
        a = res["answers"]
        lat.append(ms)
        rows.append({"expected": exp, "got": a["outcome"]["choice"], "confidence": round(a["outcome"]["confidence"], 3),
                     **{f"{k}_ok": (a[k]["noul"] >= .5) == v for k, v in flags.items()},
                     **{f"{k}_p": round(a[k]["noul"], 3) for k in flags}, "ms": round(ms)})
    summary = {
        "outcome_accuracy": sum(r["got"] == r["expected"] for r in rows) / len(rows),
        "appt_acc": sum(r["appt_ok"] for r in rows) / len(rows),
        "cb_time_acc": sum(r["cb_time_ok"] for r in rows) / len(rows),
        "dnc_acc": sum(r["dnc_ok"] for r in rows) / len(rows),
        "latency_ms_median": round(statistics.median(lat)),
        "misses": [r for r in rows if r["got"] != r["expected"] or not all(r[f"{k}_ok"] for k in ("appt", "cb_time", "dnc"))],
    }
    return rows, summary


# ---------------------------------------------------------------- E3
FIELDS = {
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
    "ignore": "Anything else: status codes, internal IDs, notes, coordinates.",
}

E3_COLUMNS = [  # (header, sample values, expected)
    ("Owner Name", ["SMITH JANE & JOHN", "PARKER ROBERT", "NGUYEN THI"], "owner_full_name"),
    ("Situs Address", ["4417 GROVE AVE", "210 N BOULEVARD", "8261 REEDY KNOLL CT"], "property_address"),
    ("Mail Addr", ["PO BOX 2201", "4417 GROVE AVE", "1 OCEAN DR APT 4"], "mailing_address"),
    ("LP", ["425000", "389900", "615000"], "list_price"),
    ("Orig LP", ["450000", "399900", "650000"], "original_price"),
    ("CDOM", ["94", "121", "37"], "days_on_market"),
    ("Exp Date", ["11/12/2026", "11/10/2026", "11/13/2026"], "expired_date"),
    ("List Office", ["Long & Foster", "KW Richmond", "Joyner Fine Properties"], "listing_office"),
    ("Phone 1", ["(804) 555-0142", "8045550199", "804.555.0123"], "phone"),
    ("Phone 1 Type", ["W", "L", "W"], "phone_type"),
    ("Phone 1 DNC", ["Y", "N", "N"], "phone_dnc"),
    ("Ph2 Status", ["Clean", "DNC", "Clean"], "phone_dnc"),
    ("Line", ["Wireless", "Landline", "VoIP"], "phone_type"),
    ("Scrubbed On", ["2026-11-01", "2026-11-01", "2026-11-01"], "scrub_date"),
    ("MLS #", ["2531847", "2529901", "2533012"], "mls_number"),
    ("Status", ["X", "W", "X"], "ignore"),
    ("Lat", ["37.5531", "37.5612", "37.4120"], "ignore"),
    ("First", ["Jane", "Robert", "Thi"], "owner_first_name"),
    ("Last", ["Smith", "Parker", "Nguyen"], "owner_last_name"),
    ("Zip", ["23221", "23220", "23832"], "property_zip"),
    ("E-mail 1", ["jsmith@gmail.com", "", "thi.n@yahoo.com"], "email"),
]

DNC_VALUES = [  # (column, value, expected)
    ("Phone 1 DNC", "Y", "do_not_call"), ("Phone 1 DNC", "N", "callable"),
    ("Ph2 Status", "Clean", "callable"), ("Ph2 Status", "DNC", "do_not_call"),
    ("DNC Flag", "TRUE", "do_not_call"), ("DNC Flag", "FALSE", "callable"),
    ("Federal DNC", "Listed", "do_not_call"), ("Federal DNC", "Not Listed", "callable"),
    ("Phone 1 DNC", "", "unknown"), ("Ph2 Status", "Litigator", "do_not_call"),
    ("Phone 3 DNC", "?", "unknown"),
]


def e3():
    rows, lat = [], []
    all_headers = [c[0] for c in E3_COLUMNS]
    for header, samples, exp in E3_COLUMNS:
        state = {"file": "Expired-listing lead export purchased from a lead vendor",
                 "all_column_headers": all_headers,
                 "column": {"header": header, "sample_values": samples}}
        qs = {"field": {"type": "choice",
                        "instructions": "Which dialer field does the spreadsheet column in `column` hold? Use the header, its sample values, and the other headers in `all_column_headers` for context.",
                        "criteria": FIELDS}}
        res, ms = ask(state, qs)
        a = res["answers"]["field"]
        lat.append(ms)
        rows.append({"header": header, "expected": exp, "got": a["choice"], "confidence": round(a["confidence"], 3), "ms": round(ms)})
    dnc_rows = []
    for col, val, exp in DNC_VALUES:
        res, ms = ask({"column_header": col, "cell_value": val}, {"meaning": {
            "type": "choice",
            "instructions": "This cell is from a do-not-call column in a purchased phone list. What does `cell_value` mean for whether this phone may be dialed?",
            "criteria": {"do_not_call": "The phone is on a do-not-call or litigator list and must not be dialed.",
                         "callable": "The phone was checked and is not on a do-not-call list.",
                         "unknown": "The value is blank or does not say either way."}}})
        a = res["answers"]["meaning"]
        dnc_rows.append({"column": col, "value": val, "expected": exp, "got": a["choice"], "confidence": round(a["confidence"], 3)})
    summary = {
        "column_accuracy": round(sum(r["got"] == r["expected"] for r in rows) / len(rows), 3),
        "dnc_value_accuracy": round(sum(r["got"] == r["expected"] for r in dnc_rows) / len(dnc_rows), 3),
        "latency_ms_median": round(statistics.median(lat)),
        "column_misses": [r for r in rows if r["got"] != r["expected"]],
        "dnc_misses": [r for r in dnc_rows if r["got"] != r["expected"]],
        "low_confidence_columns": [r for r in rows if r["confidence"] < .7],
    }
    return {"columns": rows, "dnc_values": dnc_rows}, summary


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    OUT.mkdir(exist_ok=True)
    for name, fn in (("e1", e1), ("e2", e2), ("e3", e3)):
        if which in (name, "all"):
            rows, summary = fn()
            (OUT / f"{name}.json").write_text(json.dumps({"model": MODEL, "rows": rows, "summary": summary}, indent=2))
            print(f"\n== {name} ==")
            print(json.dumps(summary, indent=2))
