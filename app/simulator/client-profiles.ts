/** Public character notes for the voice comparison screen. Scenario facts remain private. */
export const clientProfiles: Record<string, { background: string; traits: string[]; pace: string }> = {
  morgan: {
    background: 'An experienced client decision-maker who expects consultants to defend a clear recommendation. No fixed personal biography is defined.',
    traits: ['Direct', 'Authoritative', 'Dry humor', 'Challenges weak promises'],
    pace: 'Fast, clipped delivery; the actor prompt aims for roughly 220–240 words per minute.',
  },
  avery: {
    background: 'A client carrying responsibility for a difficult decision, careful about what they disclose. No fixed personal biography is defined.',
    traits: ['Reserved', 'Cautious', 'Thoughtful', 'Firm when a real risk is dismissed'],
    pace: 'Unhurried, with space between ideas.',
  },
  casey: {
    background: 'A client who evaluates proposals by testing their assumptions and evidence. No fixed personal biography is defined.',
    traits: ['Analytical', 'Skeptical', 'Precise', 'Curious when an answer holds up'],
    pace: 'Measured and steady; quickens when genuinely engaged.',
  },
  harper: {
    background: 'A busy decision-maker who often thinks they know where a conversation is going. No fixed personal biography is defined.',
    traits: ['Decisive', 'Impatient', 'Distractible', 'Interrupts with assumptions'],
    pace: 'Brisk and impatient.',
  },
  quinn: {
    background: 'A client attentive to stakeholders and how a decision will be explained to them. No fixed personal biography is defined.',
    traits: ['Diplomatic', 'Politically careful', 'Courteous edge', 'Sensitive to ownership'],
    pace: 'Polished, with meaningful pauses and subtext.',
  },
  riley: {
    background: 'A client with many connected needs who has trouble choosing what belongs in the first commitment. No fixed personal biography is defined.',
    traits: ['Enthusiastic', 'Expansive', 'Optimistic', 'Struggles to prioritize'],
    pace: 'Quick, energetic, and full of connected ideas.',
  },
  jamie: {
    background: 'A warm Midwestern client who avoids making someone feel bad, even when a proposal misses the mark. No fixed personal biography is defined.',
    traits: ['Friendly', 'Conflict-avoidant', 'Politely guarded', 'May hide a quiet no'],
    pace: 'Gentle, chatty conversational cadence.',
  },
};
