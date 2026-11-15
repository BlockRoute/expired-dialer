import type { PlaybookCardRow } from '../db/types';
import type { JevQuestion } from './client';

// Wording is copied verbatim from experiments/typesafe/run.py and followup.py.

export const DNC_REQUEST_INSTRUCTIONS =
  'In `owner_said`, does the homeowner ask the caller to stop calling them, remove them from a calling list, or never call this number again? A request to call at a later time is NOT a request to stop calling.';

export function dncRequestNoul(path: 'owner_said' | 'transcript'): JevQuestion {
  if (path === 'owner_said') return { type: 'noul', instructions: DNC_REQUEST_INSTRUCTIONS };
  return {
    type: 'noul',
    instructions:
      DNC_REQUEST_INSTRUCTIONS.replace('`owner_said`', '`transcript`') +
      " Use the owner's final word on this.",
  };
}

const NONE_CRITERIA = 'Nothing for the caller to respond to: greetings, acknowledgements, small talk, or filler.';

export function cardChoice(
  cards: Pick<PlaybookCardRow, 'key' | 'criteria'>[],
  withContext: boolean,
): JevQuestion {
  const criteria: Record<string, string> = {};
  for (const c of cards) if (c.criteria) criteria[c.key] = c.criteria;
  criteria.none = NONE_CRITERIA;
  return {
    type: 'choice',
    instructions: withContext
      ? "Which response card should the agent's screen show for what the homeowner just said in `owner_said`, as an answer to the rep's last line in `transcript_so_far`?"
      : "Which response card should the agent's screen show for what the homeowner just said in `owner_said`?",
    criteria,
  };
}

export function outcomeChoice(outcomes: Record<string, string>): JevQuestion {
  return {
    type: 'choice',
    instructions:
      'What was the outcome of this cold call to the owner of an expired listing, based on `transcript`? Use the final position the owner took.',
    criteria: outcomes,
  };
}

export function appointmentNoul(): JevQuestion {
  return {
    type: 'noul',
    instructions: 'In `transcript`, did the owner agree to a specific day and time to meet in person?',
  };
}

export function callbackTimeNoul(): JevQuestion {
  return {
    type: 'noul',
    instructions:
      "In `transcript`, did the owner give a specific day or time for a follow-up call (not just 'later' or 'after the holidays')?",
  };
}

export function columnFieldChoice(fields: Record<string, string>): JevQuestion {
  return {
    type: 'choice',
    instructions:
      'Which dialer field does the spreadsheet column in `column` hold? Use the header, its sample values, and the other headers in `all_column_headers` for context.',
    criteria: fields,
  };
}

export function dncColumnNoul(): JevQuestion {
  return {
    type: 'noul',
    instructions:
      'Do the header and sample values in `column` say whether a phone number is on a do-not-call, DNC or litigator list (for example values like Y/N, Clean/DNC, Listed)? A column holding the phone number itself, or the phone\'s line type, does not count.',
  };
}

export function dncValueChoice(): JevQuestion {
  return {
    type: 'choice',
    instructions:
      'This cell is from a do-not-call column in a purchased phone list. What does `cell_value` mean for whether this phone may be dialed?',
    criteria: {
      do_not_call: 'The phone is on a do-not-call or litigator list and must not be dialed.',
      callable: 'The phone was checked and is not on a do-not-call list.',
      unknown: 'The value is blank or does not say either way.',
    },
  };
}
