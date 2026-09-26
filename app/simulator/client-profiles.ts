/** Public character notes for the voice comparison screen. Scenario facts remain private. */
export const clientProfiles: Record<string, { background: string; traits: string[]; pace: string; sample: string }> = {
  morgan: {
    background: 'An experienced client decision-maker who expects consultants to defend a clear recommendation and a workable boundary.',
    traits: ['Direct', 'Authoritative', 'Dry humor', 'Challenges weak promises'],
    pace: 'Fast, clipped delivery; the actor prompt aims for roughly 220–240 words per minute.',
    sample: "I appreciate the enthusiasm, but let's spare ourselves the polished tour. Tell me what you'd actually do first, what you need from my team, and where this could go wrong. If there's a tradeoff, say it plainly. I can work with a hard answer; I can't work with a foggy one.",
  },
  avery: {
    background: 'A client carrying responsibility for a difficult decision, careful about what they disclose and agree to.',
    traits: ['Reserved', 'Cautious', 'Thoughtful', 'Firm when a real risk is dismissed'],
    pace: 'Unhurried, with space between ideas.',
    sample: "I want to be careful before I say yes. People will rely on this, and I'll have to explain it if we get it wrong. Give me a moment. I do want to hear your idea; I just need to understand what we're asking everyone to take on.",
  },
  casey: {
    background: 'A client who evaluates proposals by testing their assumptions and evidence.',
    traits: ['Analytical', 'Skeptical', 'Precise', 'Curious when an answer holds up'],
    pace: 'Measured and steady; quickens when genuinely engaged.',
    sample: "That sounds plausible, but plausible isn't the same as supported. Which assumption is doing the most work here? If we tested only one thing this week, I'd test that. Show me the result and I'll happily change my mind; until then, let's be precise about what we know.",
  },
  harper: {
    background: 'A busy decision-maker who often thinks they know where a conversation is going.',
    traits: ['Decisive', 'Impatient', 'Distractible', 'Interrupts with assumptions'],
    pace: 'Brisk and impatient.',
    sample: "Okay, I think I know where you're going. Wait, no, I jumped ahead. You're talking about the approval process, not the delivery team. Right. Give me the one decision you need from me today. I've got another call soon, but you have my attention.",
  },
  quinn: {
    background: 'A client attentive to stakeholders and how a decision will be explained to them.',
    traits: ['Diplomatic', 'Politically careful', 'Courteous edge', 'Sensitive to ownership'],
    pace: 'Polished, with meaningful pauses and subtext.',
    sample: "I can see why that sounds appealing. The question I'll get upstairs, though, is who owns the risk if the plan changes. I'd rather not put you in a position where everyone hears a different promise. Help me say what we actually know, with a clear owner for what comes next.",
  },
  riley: {
    background: 'A client with many connected needs who has trouble choosing what belongs in the first commitment.',
    traits: ['Enthusiastic', 'Expansive', 'Optimistic', 'Struggles to prioritize'],
    pace: 'Quick, energetic, and full of connected ideas.',
    sample: "Oh, this could connect beautifully with the other ideas we've been discussing. We could add a dashboard, bring in the handoff, and maybe expand the whole experience. Actually, I know I'm adding too much again. Show me the smallest first step that still leaves room for the rest, because I love the bigger picture.",
  },
  jamie: {
    background: 'A warm Midwestern client who avoids making someone feel bad, even when a proposal misses the mark.',
    traits: ['Friendly', 'Conflict-avoidant', 'Politely guarded', 'May hide a quiet no'],
    pace: 'Gentle, chatty conversational cadence.',
    sample: "Oh, that's a thoughtful proposal, and I can tell you put real time into it. I might just need a little space to think about how it would land with my team. There's one part that doesn't quite feel right yet, but I don't want you to think I'm picking it apart.",
  },
};
