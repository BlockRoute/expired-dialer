#!/usr/bin/env python3
"""Follow-ups after the first run.

F1  Companion Noul for DNC columns: does a column's content say whether a phone
    is on a do-not-call list? Tested on every E3 column (catch "Ph2 Status"
    without flagging others).
F2  Harder coaching set: ASR-style fragments, filler, and answers whose meaning
    depends on the previous rep line; state includes a ~90s rolling transcript
    to measure latency at the design's real context size.
"""
import json, statistics, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from run import ask, PLAYBOOK, DNC_Q, E3_COLUMNS, OUT  # noqa: E402

def f1():
    headers = [c[0] for c in E3_COLUMNS]
    rows = []
    for header, samples, exp in E3_COLUMNS:
        res, _ = ask({"all_column_headers": headers, "column": {"header": header, "sample_values": samples}},
                     {"is_dnc": {"type": "noul", "instructions":
                         "Do the header and sample values in `column` say whether a phone number is on a do-not-call, DNC or litigator list (for example values like Y/N, Clean/DNC, Listed)? A column holding the phone number itself, or the phone's line type, does not count."}})
        rows.append({"header": header, "is_dnc_expected": exp == "phone_dnc", "p": round(res["answers"]["is_dnc"]["noul"], 3)})
    return rows

PRIOR = ("Rep: Hi, is this the owner of 4417 Grove Avenue? Owner: yeah who's this "
         "Rep: Daniel Yoon with eXp Realty, I saw your home came off the market and wanted to see what happened. "
         "Owner: uh yeah it just didn't move you know we had it up for like three months ")

F2_CASES = [  # (last rep line, owner fragment, expected card, expected dnc)
    ("Are you thinking of putting it back on the market?", "yeah no not really", "taking_off_market", False),
    ("Are you thinking of putting it back on the market?", "no yeah we are with the same lady", "relisting_with_agent", False),
    ("Would it make sense to sit down this week?", "i mean what would you even do different", "buying_signal", False),
    ("Would it make sense to sit down this week?", "um not right now like maybe", "timing_not_ready", False),
    ("What do you think kept it from selling?", "honestly the price i guess she had us too high", "why_didnt_it_sell", False),
    ("What do you think kept it from selling?", "i dunno you tell me", "why_didnt_it_sell", False),
    ("Is now a bad time?", "kinda im in the car", "call_me_later", False),
    ("Is now a bad time?", "uh", "none", False),
    ("Can I ask what price you'd need?", "we need to walk away with four twenty at least", "price_expectation", False),
    ("Would you be open to hearing my plan?", "man you guys keep calling all day", "agent_flood", False),
    ("Would you be open to hearing my plan?", "please just take this number off whatever list", "not_interested", True),
    ("Would you be open to hearing my plan?", "not today, try me next week", "call_me_later", False),
]

def f2():
    rows, lat = [], []
    for rep, owner, exp, exp_dnc in F2_CASES:
        state = {"call_context": "Real estate agent cold-calling the owner of a recently expired home listing in Virginia. Transcript is raw speech-to-text.",
                 "transcript_so_far": PRIOR + "Rep: " + rep, "owner_said": owner}
        res, ms = ask(state, {
            "card": {"type": "choice", "instructions": "Which response card should the agent's screen show for what the homeowner just said in `owner_said`, as an answer to the rep's last line in `transcript_so_far`?", "criteria": PLAYBOOK},
            "dnc": DNC_Q})
        a = res["answers"]; lat.append(ms)
        rows.append({"rep": rep, "owner": owner, "expected": exp, "got": a["card"]["choice"],
                     "confidence": round(a["card"]["confidence"], 3), "top2": sorted(a["card"]["probabilities"].items(), key=lambda kv: -kv[1])[:2],
                     "dnc_expected": exp_dnc, "dnc_p": round(a["dnc"]["noul"], 3), "ms": round(ms)})
    return rows, {"card_accuracy": round(sum(r["got"] == r["expected"] for r in rows) / len(rows), 3),
                  "dnc_correct": sum((r["dnc_p"] >= .5) == r["dnc_expected"] for r in rows), "n": len(rows),
                  "latency_ms_median": round(statistics.median(lat)), "latency_ms_max": round(max(lat))}

if __name__ == "__main__":
    r1 = f1()
    r2, s2 = f2()
    (OUT / "followup.json").write_text(json.dumps({"f1": r1, "f2": r2, "f2_summary": s2}, indent=2))
    print("== F1 DNC-column Noul ==")
    for r in r1:
        flag = "OK " if (r["p"] >= .5) == r["is_dnc_expected"] else "BAD"
        print(f"{flag} {r['p']:.3f} {'DNC' if r['is_dnc_expected'] else '   '} {r['header']}")
    print("\n== F2 harder coaching ==")
    print(json.dumps(s2, indent=2))
    for r in r2:
        mark = "OK " if r["got"] == r["expected"] else "MISS"
        print(f"{mark} conf={r['confidence']} got={r['got']} exp={r['expected']} dnc_p={r['dnc_p']} | {r['owner']}  top2={r['top2']}")
