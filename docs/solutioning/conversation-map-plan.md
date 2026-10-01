# Conversation map for the closeout interview

Status: **planning, iteration 3 (Andrew's notes on iteration 2: Sol timing and prompt caching, topics go to Sol only, Sol owns closures, truth comes only from the participant). Not implemented.** It will be built in a separate worktree on its own branch.

Scope:
- Sam's brief (`ai/interview/scenario.server.ts`)
- Sol (`ai/interview/producer.server.ts`)
- Jev's interview questions (`ai/interview/evaluate.server.ts`, `ai/interview/rubric.ts`)
- the producer orchestration (`app/server/simulator/interview-producer.ts`, `core/interview-producer.ts`)
- their wiring in `app/server/simulator/session.ts`

## Problem

In the 2026-10-01 Acme closeout test, Sol's push cues steered Sam badly:
- Cues arrived after the conversation had moved on. Sam took them 19 s later at the median (p50) and 40 s later in the worst tenth of cases (p90). Most of that delay was our own delivery rules (a 45 s check-in, 30 s cue spacing and waiting for a quiet moment), not model latency.
- Sam treated cues as orders and they overrode Andrew's feedback. There was no way to cancel a cue.
- Facts that ruled questions out were not carried forward. The participant left the project at the midpoint, and Sam still asked about the second half.
- Sam never learned what the app does.
- Sam bounced between topics, A→B→A.

## What good sounds like

Andrew's own interview with Jordan about Larkspur is the target. The pieces:
- a peer tone;
- concrete guesses left open for correction;
- either/or questions with a candid option;
- play-back with a lean;
- voicing the other side;
- opinions;
- callbacks;
- short questions;
- following the participant's turns.

The order is: what you built and who it's for → what it does → how it was built → threads that come up.

## Design in one paragraph

Sol keeps a **conversation map**: a loose graph of what's been said and the open gaps worth pulling on. Jev re-scores the open threads after every participant turn. Code ranks them and tells Sam either to **keep pulling** on the current thread or to **tug a nearby one**, naming *what's still unknown*, never a sentence to say. Sam decides how to segue. Sol and Jev both see the full transcript, and Sol also sees its previous map. Sol is the only writer of the map, and the closeout topics go to Sol only. The ranked list replaces push cues entirely, and the cue machinery is deleted.

## Three clocks

| Loop | Who | Speed | Job |
|---|---|---|---|
| Voice | Sam (GPT-Live) | realtime | Talk, listen, choose the next question |
| Turn | Jev + code | about 1 s after each participant turn | Score threads, pick keep-pulling or nearby, send a note if the pick changed |
| Map | Sol | One call at a time; starts at least 20 s after the previous call **started**, and at most 60 s apart (see Sol triggers). Call time is unknown until the Sol probe | Rewrite the map from the full transcript |

Luna (research) runs once, starting when the client is first named, and feeds the map loop.

## The map

Everything is a fact in the graph. There is no separate "constraint" node type.

### Nodes

- **Entities.** Types: person, org, product, feature, event, decision, fact, term.
  - Each has a `label`, a short `detail`, a `source` (participant, research or seed) and the passage where it first came up.
- **The participant.** This is an entity like any other, but Sol keeps two fields on it current:
  - **Vantage:** a concrete statement of what they can and can't speak to firsthand. It comes from ordinary facts in the map: their role, the parts they built, and the event that took them off the project, with its dates. For example: "On the project weeks 1–8 of 12 as tech lead on the app side; moved to another project for weeks 9–12, so can't speak to launch or later scope changes."
  - **Preferences:** standing feedback about how to interview them. For example: "Concrete questions about what was built, not open-ended ones. Said data access is covered."
- **Threads.** A thread is a gap worth pulling on, not a question. Fields:
  - `anchors`: the entities it's tied to.
  - `unknown`: what we don't know yet, e.g. "who approved cutting Billing".
  - `guess`: Sol's best guess, e.g. "Paul alone, under budget pressure". Sam turns the gap and the guess into a guess-and-leave-it-open question or an either/or. Gaps don't go stale the way pre-written questions do.
  - `related`: other threads Sol sees as the same story (see Loosely connected threads).
  - `topics`: the closeout topics it touches. There can be any number, or none. This is Sol's bookkeeping and is never sent to Sam (see Closeout topics).
  - `status`: `open`, `done` or `off`.
  - `reason`: required for `done` and `off`.
- **Edges.** Loose relations between entities: built, part-of, decided, works-for, involved, happened-during.

### Crossing out

**Sol decides; Jev reacts.** Sol owns the map, so only Sol changes a thread's status. Jev's per-turn state judgment (answered, declined, asked without getting anywhere) acts on the ranking straight away. It is never written to the map.

| Jev sees | Ranking, right away | Sol, on its next call |
|---|---|---|
| Answered | Held down | Marks it `done`, or leaves it open if there's more to it |
| Declined | Held down | Marks it `off` |
| Asked without getting anywhere | Held down for about 3 min | Rewrites the guess or the unknown, or marks it `off` |

Guidance for Sol on ruling a thread out (`off`, with a reason):
- **The participant declined,** or deflected it twice.
- **It makes no sense given what they've said.** Sol checks every open thread against the vantage on each call. Here's the Acme case: the participant moved off the project before the new tech lead started. "How did the client receive the new tech lead?" makes no sense to ask them. Sol rules it out unless they have shown they know secondhand.
- **Its premise is false.** The thread assumes something the participant has since contradicted.
- **It's fully answered.** That's `done` rather than `off`. Sol can reopen a `done` thread if the transcript disagrees later.

`off` lasts the whole interview, unless the participant brings the thread back. Threads that are `off` or `done` are not scored. They aren't listed in Sam's notes. The reasons reach Sam as facts in the participant's vantage and preferences instead, because a list of off-limits topics is still a topic list, and Acme showed Sam acts on lists.

### Who writes what

- **Sol** is the only writer. Its context holds the previous map and the full transcript (about 9k tokens at 30 min, laid out for prompt caching; see below). **Sol must account for every node on every call:**
  - unchanged nodes by ID only;
  - changed and new nodes in full;
  - dropped nodes by ID, with a reason.

  Code rebuilds the full map from this and rejects output that skips an ID. This keeps what Fable wanted from a full rewrite: Sol considers every node, and nothing disappears silently. It also keeps the output short. Output length, not input, will set Sol's latency, since a whole map is about ten times today's 160-character cue. If the Sol probe shows dangling or duplicate IDs anyway, the fallback is a full rewrite.
- **Code** never edits the map. It reads it to rank threads and to write notes.
- **Truth comes only from the participant.** A fact enters the map only from what the participant said. That includes the participant confirming something Sam said: "Yeah, exactly, it was Paul's call" counts.
  - Sam's opinions, guesses and playbacks are conversation, not evidence. They stay `unconfirmed` until the participant confirms them.
  - Research is context, labeled `source: research`. It isn't a participant fact unless the participant confirms it.
  - The summary keeps all of this separate. It's the same rule Jev already grades by (`ai/interview/rubric.ts:10`): "Sam's question, guess, suggestion, or paraphrase cannot establish a participant fact."
- **Luna's findings** come back as nodes with `source: research`. Sam frames them as "I read…".
- **The participant never sees the map.** The map is archived with the attempt and can feed the summary.

### What Sam sees (Acme at about p50)

The map note, sent after each meaningful map change:
```
About the participant: tech lead on the app side; on the project weeks 1–8 of 12, moved to another project for weeks 9–12 (can't speak to launch or later scope).
They prefer: concrete questions about what was built. Said data access is covered.
Known so far: Route Planner plans routes for Acme field crews · Paul Novak (Acme product owner) cut the Billing feature · Lena (Acme data) laid off mid-project.
```

The list note, sent when the pick changes:
```
Supersedes earlier notes.
Keep pulling (Paul cutting Billing): still unknown: whether he needed sign-off. Guess: his call alone.
Nearby: what Acme staff do in the app day to day · how job orders got into the system
```

## Loosely connected threads (still iterating)

Andrew's intuition: a thread loosely connected to the current one is an easier segue than an unconnected one. Plain hop distance carries this badly, because the product and client nodes connect to everything, so everything ends up 1–2 hops away.

**Current proposal: Sol says what's related; the graph is a backup; bands only break ties.**
1. **Right there:** threads Sol listed in `related`. Sol knows the story ("the layoff and the Billing cut are the same budget story") better than graph search.
2. **Nearby:** threads whose anchors share an edge with the current thread's anchors. The frame is defined by **degree**, not by type: any entity linked to more than about a third of the others is excluded from these paths. The product is still allowed when it's the real anchor.
3. **Elsewhere:** everything else.

Ranking sorts by score. Bands break near-ties only (within about 0.1). Natural next already measures how easy the segue is against the participant's actual words, so bands matter only when it can't tell the threads apart. This avoids tuning a weight, and the harness gets a clean A/B with bands on and off. If bands don't change the harness counters, they go.

## Jev

The ranking questions merge into **one Jev call per settled participant turn**, rather than adding a separate call. The context is the expensive part, and it's paid once per call. Jev sees the full transcript:
- **Limit:** `ai/judging.ts:64` caps input at 80k characters; a 45-minute interview is about 35k.
- **Latency:** prefill grows with input, so expect about 0.6–1 s at 35k (today it's 294 ms p50 at about 10k). The live timeout is 3 s.
- **Budget:** about 100 participant turns × up to 9k tokens per interview. This needs a number from Andrew.

**Every participant turn:**

| Judgment | Question | Use |
|---|---|---|
| Focus | Which open thread is the conversation on right now? (choice, including "none / something new") | Sets the current thread, for keep-pulling vs. nearby |
| Natural next | For each open thread: could this be the next question, given what they just said? | Highest weight |
| State | For each open thread: does the latest turn answer it, decline it, or (for the thread Sam asked about) stall it? (choice; earlier turns are context only) | Holds the thread down in the ranking until Sol decides (see Crossing out): answered and declined until Sol's next call starts, at most 2 min; stalled for 3 min |
| Substantially new | Does this turn name a person, decision, event, product part, limit or interview preference **not in this list**: `<entity labels>`? | Wakes Sol early |

Focus "something new" and Substantially new overlap. Both stay for now, and the harness shows whether one is redundant.

**When a thread is new or changed on a map update:**

| Judgment | Question | Use |
|---|---|---|
| Spicy | Would the answer reveal friction, a decision, a consequence or a lesson? | Medium weight |
| Grounding | Does Sam need this to understand the rest (what it does, for whom)? | Boost that fades over about 5 min |

**Score:**

```
w1·natural + w2·spicy + w3(t)·grounding
```
Ties go to the closer band. There's no topic bonus: closeout topics reach the ranking only through the gap threads Sol writes.

**Stickiness:** the current thread stays "keep pulling" until it's crossed out, or until a nearby thread beats it by a margin. The margin shrinks with each turn spent on the current thread, so a thread can't hold the floor forever. Too high a margin brings back overprobing; too low brings back A→B→A. The harness's A→B→A count is the tuning signal.

## Sol triggers

**What wakes Sol:**
- **Jev's "substantially new" crosses its threshold.** The client being named for the first time is one case. That first mention also starts Luna.
- **Luna's findings arrive.**
- **The timer:** 60 s have passed since the last call **started**, and at least one new settled participant turn exists. If nothing new was said, there's no call.

**Timing rules.** All gaps are measured from start to start:
- **One call in flight.** A new call never starts while one is running.
- **20 s floor.** A call can start no sooner than 20 s after the previous one started.
  - A 6 s call leaves 14 s idle before the next can start.
  - A 25 s call is followed immediately by the next, if one is pending.
- **Triggers merge.** Triggers that arrive while a call is running, or inside the 20 s floor, merge into one pending call. It reads the transcript as of when it **starts**, not as of the trigger, so it never works from a stale view.
- **Timeout: 30 s.** An abandoned call is dropped, and the pending call (if any) starts.
- **Safe to apply.** Sol is the only writer and only one call runs at a time, so a finished map always replaces the previous one cleanly.

Expected rate: 1 call a minute while people are talking, up to 3 when lots is new. That's roughly 45–90 calls in a 45-minute interview.

## Prompt caching for Sol

Sol is on the GPT-5.6-and-later rules. Sources: [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching) and [Azure Foundry prompt caching](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/prompt-caching), retrieved 2026-10-01.

**The rules that matter:**
- **Prefix only.** The cache matches an exact prefix of the rendered prompt: instructions, then the structured-output schema (prepended to the system message), then the input in order. One changed character ends the match from that point on. The minimum is 1,024 tokens.
- **Pricing on gpt-6.1-sol:**
  - cache reads cost 0.05× the input rate;
  - cache writes cost 1.25×, so writing a prefix that's never reused costs more than not caching;
  - uncached input costs 1×.
- **Explicit breakpoints.** `prompt_cache_breakpoint` on an `input_text` block marks the end of a reusable prefix.
  - `prompt_cache_options.mode: "explicit"` caches only at our breakpoints. The default `implicit` mode also writes the latest message every time.
  - Up to 4 writes per request; reads consider the latest 50 breakpoints.
  - The top-level `instructions` can't carry a breakpoint, but they're part of the prefix.
  - The cache lives at least 30 min (`ttl: "30m"`, the only value).
- **`prompt_cache_key`** routes related requests to the same cache. Stay under about 15 requests a minute per prefix and key.
- **Usage reporting.** `usage` reports `cached_tokens` (reads) and `cache_write_tokens` (writes).
- **Deployment type matters.** Breakpoints work on Standard pay-as-you-go deployments, not on PTU-M. Check which one Sol's deployment is.

**Today's Sol call is cache-hostile.** `producerContext` (`ai/interview/producer.server.ts`) sends one JSON blob in this order:
1. purpose and brief;
2. **clock** (elapsed minutes);
3. coverage, triggers, past cues, research;
4. dialogue.

The clock changes on every call, so nothing after it can match. Only the instructions, purpose and brief get cached.

**The layout for the map call.** It's append-only, with the volatile parts last:

```
instructions        static for every interview; versioned        (no breakpoint allowed)
schema              static; versioned with the instructions
seed message        participant setup + closeout topics           ◆ breakpoint
log, block 1        settled turns since the start                 ◆ breakpoint
log, block 2        settled turns since call 1                    ◆ breakpoint
  …                 one new block per call; research, the client being named and so on
                    are appended here as events, when they happen
log, block N        settled turns since call N−1                  ◆ breakpoint  ← the only cache write
tail                previous map · Jev coverage readings · why Sol woke · elapsed time   (never cached)
```

**Rules that make this work:**
1. **Nothing volatile before the log.** The clock, coverage, triggers and the previous map all go in the tail.
2. **The log is append-only and only holds settled turns.** A turn still being transcribed waits for the next call. A turn's rendering never changes: it carries a fixed ID, a speaker and minutes since the start. It is never time-relative to "now".
3. **Late arrivals become log events.** Luna's research and the client's name arrive mid-interview. Splicing them into the seed would break the cache for everything after it, so they're appended as events at the point they arrived.
4. **One block per call, each ending in a breakpoint.** Use `explicit` mode. Each call reads up to block N−1 at 0.05×, writes only block N at 1.25×, and pays 1× for the tail without writing it.
5. **Freeze the static parts.** The instructions, schema and reasoning effort are identical across all calls. Any change gets a new prompt version, which goes into the cache key.
6. **Key.** `prompt_cache_key: sol-map:<prompt version>:<attempt id>`. At 1–3 calls a minute, that's well under the limit.
7. **Pauses.** A pause under 30 min (`interview-reconnect-plan.md`) resumes warm. Longer pauses pay one rewrite.

**What it buys (rough, for a call at 30 min):**
- **Input sizes:** about 3k tokens of instructions and schema, 2k of seed, 7k of log and 2.5k of tail.
- **Uncached:** about 14.5k token-units per call.
- **Cached:** reads of about 11.7k × 0.05 ≈ 0.6k, plus a write of about 0.3k × 1.25 ≈ 0.4k, plus the 2.5k tail ≈ 3.5k. That's about 4× cheaper on input.
- **Latency:** the cache saves the prefill of about 12k tokens. Output length still dominates, which is why Sol accounts for unchanged nodes by ID only.
- **The tail is now the biggest input cost.** That's another reason to keep the map compact: `done` and `off` threads shrink to one line each.

**Rejected:** appending each map to the log as an assistant turn. That would cache the maps too, but about 2k tokens of stale map would pile up in Sol's context on every call.

**Jev.** Jev goes through TypeSafe's `experimental_evaluate`, so the prompt layout is TypeSafe's, not ours. We can still:
- pass the transcript first, rendered the same way every time;
- put the per-turn entity list inside the question text, not in the transcript state;
- check `result.usage` for cached tokens.

If TypeSafe doesn't cache prefixes, the full-transcript cost on every turn needs a conversation with them.

## What Sam receives

- **The list note.** Sent only when the current thread or the top pick changes, or Sol rewrites the top pick. It holds:
  - keep-pulling for the current thread, with its unknown and guess;
  - up to two nearby threads, by label.

  Who does what for a note:
  - **Sol** writes every word: the thread labels, unknowns and guesses.
  - **Jev** scores the threads.
  - **Code** applies the score formula, picks the threads, fills a fixed template with Sol's fields, and decides when to send.
  
  Code adds no content of its own, so no topic labels or instructions can leak in.
- **The map note.** Sent only when the compact map text changes materially, at most once every 60 s. Notes are not tied one-to-one to Sol runs, so Sol running back-to-back doesn't flood Sam.
- **Every note starts with "Supersedes earlier notes."** There's a per-interview note cap, set from the pile-up probe.
- **Protocol in the brief:**
  - Follow the participant first.
  - The list says whether there's more on the current thread and what's nearby.
  - Choose what connects to what they just said.
  - Ignoring the list is allowed.

### Delivery: the first experiment, because it blocks the design

There are two concerns:
- Notes added with `session.instructions.append` read as orders, as the old cues did.
- Notes pile up over 30 minutes, because no replace event is known.

Andrew worries `session.thinking.append` won't be firm enough. Acme shows Sam does read it: the rundowns appended there leaked their topic labels into Sam's questions. Whether it's firm *enough* is still open.

1. **Shape** (`scripts/interview-delivery-probe.mjs`, built on the 55 s single-cue protocol of `scripts/simulator-cue-probe.mjs`): 2 channels × {options vs. directions} × {gap + guess vs. a ready sentence} = 8 cells × 3 runs, plus a no-note control. Measures:
   - **uptake:** is the next question on the note's thread?
   - **parroting:** how much do the note's words overlap with Sam's next turn?
   - **leakage:** does Sam mention the note ("my notes", "off the table")?
2. **Pile-up** (`scripts/simulator-roleplay-probe.mjs`): 15 min, one note every 60 s in the winning shape. Measures:
   - uptake by minute;
   - whether Sam still acts on note N−1 after note N supersedes it.
3. **Decision: try both and listen.** Each channel gets its own note wording and brief protocol, tuned for it; `instructions.append` needs softer phrasing than `thinking.append`. Andrew listens to the recordings and picks. The probe counts are supporting evidence, not a pass/fail gate.

If notes pile up badly, the fallback is to open a fresh voice session mid-call, seeded with the brief plus the conversation so far (`interview-reconnect-plan.md` designs this for resume). That's an implementation detail and is parked.

## Closeout topics

**Only Sol sees the closeout topics. Sam never does.** Sam steers by the list note alone. This also fixes the Acme leak, where rundown labels showed up in Sam's questions.

Sol uses the topics to organize the map:
- **Tag threads** with every topic they touch. One thread can easily touch process improvement, a client quirk and a concrete fact about what was built.
- **Find gaps.** Sol reads Jev's coverage readings, which come in the tail of its context, and looks for topics that nothing on the map touches yet.
- **Write a concrete thread for each gap,** anchored to something the participant said. It's an unknown plus a guess, like any thread: "still unknown: how Acme reviewed what you shipped. Guess: Paul eyeballed demos, no formal sign-off." Never "ask about client review processes."

Gap threads compete on the same score as any other, with no bonus, so they lose to interesting threads. The topics shape what Sol writes; they don't reach Sam.

Coverage grading stays as it is. It feeds the topic UI, Sol's gap-finding and the summary. There's no end-game: if people want to keep talking, they can. When the participant asks to finish, Sam finishes.

## Sam's brief

- Shrink it to four parts:
  - identity;
  - the technique guide (below);
  - the turn-taking and backchannel block;
  - the private-context block (rewritten for list and map notes).
- **Line 61 (background):** remove "do not complete their story", "neither endorse nor deny" and "ask a better neutral question". Sam may:
  - complete their story as a guess;
  - have opinions, including about the client and people, since the report is internal only;
  - agree or push back;
  - say "I read…" about research.
  
  What stays:
  - don't invent project history;
  - tell apart what they saw firsthand, what they inferred and what they heard.
  
  The one guard is about truth, not tone. Sam's opinions are for the conversation and never count as evidence. A take reacts to what the participant said on this call, and a research-based take is attributed ("I read…"). It becomes a fact only if the participant confirms it (see Who writes what).
- **Line 63 (wrap-up):** remove the "producer direction" reference. Keep "a request to finish beats coverage and the clock".
- **Line 62 (limits):** keep as is.
- **Lines 66–67:** delete the producer-direction and rundown paragraphs.
- **Two rules for the guide:**
  - The examples are shapes; never reuse their words.
  - Callbacks quote only what this participant said.
- **"Feedback sticks"** moves to the protocol block as a rule: a comment about the interview is a standing rule for the rest of the call.
- **Decide: "Okay." as a floor return.** Andrew hands the floor back with a plain "Okay." many times, and Jordan keeps going. Line 58 currently forbids an acknowledgment without a question. GPT-Live's backchannel timing may argue for keeping the ban. The harness should try both.

### Technique guide (draft, 14)

Each technique has: what it means, when to use it, how to do it, and several "sounds like" examples. The examples are generic on purpose and avoid Acme and Jordan's exact words. GPT-Live repeats what it's given.

1. **Open on what they built.**
   - **Means:** start with the product and who it serves. It grounds every later question, and naming the client lets research start.
   - **When:** first question, and again any time you realize you can't picture the product.
   - **How:** one question, then play back what you heard.
   - **Sounds like:**
     - "What did you build, and who did you build it for?"
     - "So who's actually using this thing day to day?"
     - "Before anything else, what does it do?"
2. **Guess and leave it open.**
   - **Means:** say your best guess about what happened and leave the end open so they can correct or finish it. People correct a wrong guess faster than they answer a blank question. It's also the way to get more out of a one-line answer.
   - **When:** any time you'd otherwise ask "what were the challenges?" or "tell me more".
   - **How:** a specific guess plus a trailing "or…?"
   - **Sounds like:**
     - "I'm guessing the data wasn't ready when they wanted the AI, or…?"
     - "So they wanted to resell it, or what's the play?"
     - "Fine as in boring, or fine as in it nearly went sideways?"
3. **Either/or with the candid option.**
   - **Means:** don't ask "why". Offer two plausible answers, one of them unflattering, so the honest answer is an easy pick, and leave room for a third.
   - **When:** causes, decisions, the client, a teammate.
   - **How:** the neutral option first, the candid one second, then "or something else?"
   - **Sounds like:**
     - "A real constraint, or a convenient excuse?"
     - "Did he run the tool, or did the tool run him?"
     - "Is that a priority for them, or just a pet project?"
4. **Play it back with a lean.**
   - **Means:** restate what you understood in one sentence, then guess the unstated assumption or where the story is heading. It checks comprehension and surfaces what they took for granted.
   - **When:** after a chunk of story, or before changing threads.
   - **How:** "So… I'm guessing…?"
   - **Sounds like:**
     - "So it started as a helping hand and became the whole build. Nobody re-scoped?"
     - "So they owned the data but nobody there understood it. Did that land on you?"
     - "So the people paying aren't the people using it?"
5. **Finish their sentence.**
   - **Means:** when they're building to a point, say the implication in a few words and stop. If you're right, they speed up. If you're wrong, they correct you.
   - **When:** they slow down at the end of a setup, or list a timeline or tradeoff.
   - **How:** five words or fewer, then silence.
   - **Sounds like:**
     - "…and that ate the schedule."
     - "So nobody owned it."
     - "Before anyone had tested it."
6. **Voice the other side.**
   - **Means:** say what the exec, client or user would say, in their voice. The participant confirms or corrects, and often reveals the real dynamic.
   - **When:** they describe a stakeholder's reaction or a tension between sides.
   - **How:** "So from their chair it's: …?"
   - **Sounds like:**
     - "So from their chair it's: we paid for magic, where's the magic?"
     - "Translation: don't tell me how, just make it go away?"
     - "And their users are thinking: one more tool to log into?"
7. **Have an opinion.**
   - **Means:** Sam has a perspective and says it briefly. That includes views on the client, decisions and people. An opinion invites them to agree or correct it, and a correction is as useful as agreement. Only their answer counts as what happened.
   - **When:** after they describe a decision, a dynamic or a result.
   - **How:** one short take on what they just said, then hand the floor back.
   - **Sounds like:**
     - "Honestly, that sounds like a staffing problem dressed up as a tech problem."
     - "Cutting it sounds like the right call, even if nobody liked it."
     - "An owner who actually bends? That's rare."
8. **Red flag: react, then one impact question.**
   - **Means:** layoffs, people leaving, cut scope, reversed decisions. Acknowledge it in a few words, wait, then ask once what it broke or changed. The feeling comes out without a feelings question.
   - **When:** right when the red flag comes up.
   - **How:** two to four words, a beat, then one concrete impact question.
   - **Sounds like:**
     - "Oof. Mid-project? What did that break?"
     - "That's rough. Who picked up their work?"
     - "Yikes. Did the deadline move, or just the scope?"
9. **Call back.**
   - **Means:** link a new fact to something *they* said earlier. It shows you're listening and often surfaces a pattern.
   - **When:** a name, number or event echoes something earlier in this call.
   - **How:** name the earlier thing, in their words.
   - **Sounds like:**
     - "Wait, is this the same data you were cleaning up earlier?"
     - "That's the second person who left. Same story?"
     - "That timeline again. Is that why the testing got squeezed?"
10. **Follow their turn.**
    - **Means:** when they bring up something new (a person, a decision, a problem), go with it for a turn or two. This beats anything on the list. For a new person, pin down who they are and which side they're on in a few words, then go back to the story.
    - **When:** always.
    - **How:** one short follow-up on the new thing.
    - **Sounds like:**
      - "Hold on, who made that call?"
      - "Their side or ours?"
      - "Back up. They let the whole team go?"
11. **Define their words, gently.**
    - **Means:** when a word carries weight, ask what they mean by it, after a preface that makes it clear you aren't challenging them.
    - **When:** jargon, or loaded words like "phase two", "political" or "done".
    - **How:** a disarming preface, then "what's X versus Y?", then play it back.
    - **Sounds like:**
      - "Everyone uses this word differently. What's 'done' mean to them?"
      - "Political how? Budget, or egos?"
      - "Quick check, since teams mean different things: is 'phase two' new scope, or leftovers?"
12. **Next-team scenario.**
    - **Means:** turn a story into a lesson by putting a future team in the same spot. This is how lessons for the report get extracted.
    - **When:** after a red flag or a story that cost something, once it's been told.
    - **How:** "Next team gets this client / this setup. What do they do first?"
    - **Sounds like:**
      - "Next team gets this client tomorrow. What's the first thing you tell them?"
      - "If you wrote the contract over, what's clause one?"
      - "Same red flags show up on a new pitch. Walk away, or take it with conditions?"
13. **Short, one at a time.**
    - **Means:** under about 15 words, one question per turn, then stop. If they start talking, stop immediately.
    - **When:** every turn.
    - **How:** cut the preamble. No two-part questions.
    - **Sounds like:**
      - "Who decided that?"
      - "How long did that take?"
      - "Oh, go ahead."
14. **Talk like a peer.**
    - **Means:** casual, direct, a little informal. Make it clear the messy parts are what's wanted. Sam has no war stories of its own, but it can go first with a hunch.
    - **When:** at the opening, and whenever answers get polished.
    - **How:** plain words and hunches; no corporate phrasing.
    - **Sounds like:**
      - "Honestly, the messy parts are the useful parts."
      - "My hunch: they wanted the AI before the data. Close?"
      - "What would you never do again?"

## What gets deleted

Everything is removed outright. No parallel path is kept.

- **`app/server/simulator/interview-producer.ts`.** The cue machinery goes:
  - the current and pending cue;
  - delivery, spacing and withholding;
  - cue recovery and the 45 s check-ins;
  - the protection alarms;
  - `rundown` and `rundownText`;
  - `researchCard`.
  
  What's left becomes a small map-and-ranking orchestrator.
- **`core/interview-producer.ts`.** These go:
  - the cue, trigger and follow-through types;
  - `RundownRecord` and `ContinuityRecord`;
  - `PROTECTION_CONDITIONS`, `CHECK_IN_SIGNALS` and `CUE_OUTCOMES`;
  - `producerDirection` and the cue latency stats.
- **`ai/interview/producer.server.ts`** is replaced by Sol's map prompt.
- **`ai/interview/evaluate.server.ts` and `rubric.ts`.** These go:
  - `evaluateInterviewer` and its seven `director:*` questions, including `leading`;
  - `cue:follow-through`;
  - `cueResponseIds` and `readCueFollowThrough`.
  
  `coverageWindow`'s character caps go too, since Jev sees the full transcript.
- **`INTERVIEW_CONDITIONS`** in `core/simulator/director.ts`.
- **Sam's brief:** lines 66–67, plus the edits to lines 61 and 63 described above.
- **Tests:**
  - `ai/interview/cue.test.ts` and `producer.test.ts` are deleted;
  - most of `app/server/simulator/interview-producer.test.ts` is deleted;
  - the cue parts of `core/interview-producer.test.ts` are removed.
- **Timeline tool and storybook.** The producer, rundown and continuity lanes become map and ranking lanes. The readers for old archives are dropped.

**What stays:**
- Sam on GPT-Live;
- Jev's coverage grading, which still drives the topic UI, Sol's gap-finding and the summary;
- the archive;
- the `session.ts` wiring, adapted.

**Interplay:** `interview-reconnect-plan.md` restores "producer state" on resume. Under this plan, that state becomes map-and-ranking state.

## Evaluation

The work happens in this order:
1. **Delivery probe.** It blocks the design; see Delivery above.
2. **Sol probe, run alongside the delivery probe.** Replay the Acme transcript through the new map prompt, one call per simulated trigger, using the real timing rules. For each call, record:
   - output tokens and latency;
   - `cached_tokens` and `cache_write_tokens`;
   - skipped or duplicate node IDs.
   
   It answers three questions: whether the cache layout gets more than 80 % of input from cache after the third call, whether the ID-only format holds up, and how long a map call really takes.
3. **Harness.** The workshop acceptance script is a UI test, so it doesn't qualify. `scripts/simulator-roleplay-probe.mjs` is the starting point. The participant is played by an LLM from a fact sheet with knowledge limits (the Acme facts, including the move off the project). A scripted participant can't answer an either/or question. Runs last about 15 minutes, and the counters are computed from the archive:
   - questions asked again;
   - A→B→A switches;
   - callbacks;
   - questions about crossed-out threads;
   - the share of open-ended vs. either/or questions;
   - parroting of note text.
4. **A/B tests**, each against the previous configuration:
   - the map design vs. today;
   - bands on vs. off;
   - "Okay." returns allowed vs. banned.

The gold set is Andrew's own interviews.

## Open questions for Andrew

Settled in iteration 3:
- **Closures:** Sol decides, using the ruling-out guidance.
- **Delivery:** try both channels and listen.

Still open:
1. **The single A/B gate.** Defects (repeat questions plus questions about crossed-out threads), or style (the either/or share)?
2. **Jev spend.** What spend per interview is acceptable for full-transcript calls on every turn? This depends on whether TypeSafe caches prefixes.
3. **Gold set.** Will you record more of your own interviews?
