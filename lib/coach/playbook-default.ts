export type DefaultPlaybookCard = {
  key: string;
  title: string;
  criteria: string;
  say: string;
  why?: string;
};

// Criteria from experiments/typesafe/run.py, with the four revised definitions
// (call_me_later, timing_not_ready, taking_off_market, not_interested) from the
// 36/36 retest. `none` is not listed: cardChoice() adds it.
export const DEFAULT_PLAYBOOK: DefaultPlaybookCard[] = [
  {
    key: 'relisting_with_agent',
    title: 'Relisting with their agent',
    criteria: 'The owner says they plan to relist, or are staying, with their current or previous listing agent.',
    say: "That makes sense, %lead.first_name%, loyalty counts. Can I ask what you'd want to be different the second time around? If the answer is nothing, I'll leave you to it.",
  },
  {
    key: 'taking_off_market',
    title: 'Taking it off the market',
    criteria: 'The owner says they are not selling now or not putting it back on the market: keeping it, staying put, done with selling.',
    say: "Totally fair. Is that a for-good decision, or more of a take-a-break-and-see? I'd rather check back once in a while than keep bugging you.",
  },
  {
    key: 'selling_themselves',
    title: 'Selling it themselves',
    criteria: 'The owner says they will sell it themselves (FSBO) or without an agent.',
    say: "Good for you, plenty of people do. If it doesn't move in 30 days, would it be okay if I check back? And I'm happy to send you what buyers in your area are actually paying.",
  },
  {
    key: 'commission_objection',
    title: 'Commission objection',
    criteria: 'The owner objects to agent fees or commission.',
    say: "I hear you, and it's a fair thing to push on. Can I show you what I'd do for the fee, and then you judge whether it's worth it? If not, no hard feelings.",
  },
  {
    key: 'why_didnt_it_sell',
    title: "Why it didn't sell",
    criteria: 'The owner gives or asks for a reason the listing did not sell (price, market, agent, showings, photos).',
    say: "That's useful, thank you. From what I see, a home like yours usually stalls on price or presentation, not the house itself. Would it help if I walked through what I'd change?",
  },
  {
    key: 'price_expectation',
    title: 'Price expectation',
    criteria: 'The owner insists the home is worth more than it was listed for, or will not take less than a specific number.',
    say: "I'm not going to tell you what it's worth over the phone. Let me pull the recent sales close to you and we can look at it together, so the number comes from buyers and not from me.",
  },
  {
    key: 'timing_not_ready',
    title: 'Not ready yet',
    criteria: 'The owner isn\'t ready to sell yet and points to a later season, life event, or market change (months away), or is vaguely noncommittal about selling again. About the timing of SELLING, not of this call.',
    say: "Understood, no rush. Would it be okay if I send you a quick market update every month or so, and we pick it back up when the timing feels right?",
  },
  {
    key: 'call_me_later',
    title: 'Call back later',
    criteria: "The owner can't talk right now (busy, driving, at work, spouse not home) and points to a call later today or within about a week. About the timing of THIS conversation.",
    say: "Of course, sorry to catch you at a bad time. What's better, later today or tomorrow? I'll keep it to two minutes.",
  },
  {
    key: 'how_got_number',
    title: 'How did you get my number?',
    criteria: 'The owner asks how the caller got their number or who the caller is.',
    say: "Fair question. I'm Daniel Yoon with eXp Realty here in Richmond. Your listing came off the market and the number was on the public record. I'm only calling to see if you still want to sell.",
  },
  {
    key: 'agent_flood',
    title: 'Too many agent calls',
    criteria: 'The owner complains that many agents have been calling since the listing expired.',
    say: "I know, it's a lot, and I'm sorry. I'll be quick: I'm not here to pitch you, I just want to know if selling is still something you want. If not, I'll note it and stop.",
  },
  {
    key: 'already_sold_or_leased',
    title: 'Already sold or leased',
    criteria: 'The owner says the home already sold, is under contract, or was rented out.',
    say: "Congratulations, glad it worked out. Thanks for telling me, I'll update my notes. If anything changes down the road, I'm around.",
  },
  {
    key: 'buying_signal',
    title: 'Interested',
    criteria: "The owner shows interest: asks what the caller would do differently, about the caller's plan, fees, or availability to meet.",
    say: "Glad you asked. In short: sharper pricing from the start, real photos and video, and I stay on top of showings. Easiest is 20 minutes at the house. Does Thursday or Friday work?",
  },
  {
    key: 'not_interested',
    title: 'Flat no',
    criteria: "A flat refusal of the caller with no reason or plan given (e.g. 'not interested', 'no thanks').",
    say: "No problem at all. Just so I know whether to follow up, is it that you're done with selling, or just not interested in talking to me?",
  },
];
