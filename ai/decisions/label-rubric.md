# Decisions comparison: independent labels

Version: `decisions-labels-v1`. Labels describe observable behavior, independent of either provider's answer. Read only the supplied input and this rubric; do not use future dialogue, stored Jev readings, provider identity, or latency to decide correctness.

## Silence

The input is the last eight transcript passages at a hypothetical check after four seconds without transcript growth. This gap alone does not prove that a speaker finished. `trainee` is the participant; `client` is the interviewer. Transcript punctuation is fallible.

Label the conversational state at the end of the supplied dialogue:

- `continue`: a completed participant answer or a request to repeat/clarify needs an interviewer response; an interviewer reaction, agreement, summary, or thanks without another question does not transfer the floor. Declining one topic leaves the interview open.
- `wait`: a question or invitation awaits the participant, the participant is still developing a thought, or the participant asked for time/quiet. A backchannel or explicit invitation to continue does not complete the participant's answer.
- `finished`: the participant asked to end and the interviewer said goodbye.
- `ambiguous`: the available words support multiple states. Explain what is missing. Do not force a label based on elapsed time.

Use all eight passages as context, but answer about the final state, not a previously answered question. A complaint about a pause can establish the next turn only when that complaint is already inside the input. Never read the later complaint to label an earlier cutoff.

Return one item per case:

```json
{
  "caseId": "example",
  "state": "continue",
  "evidenceIds": ["p7", "p8"],
  "reason": "The participant completed an answer and the interviewer only acknowledged it.",
  "severityIfWrong": "major"
}
```

Use `critical` for speaking over an explicit request to wait or continuing a finished interview; `major` for another wrong next-turn decision. `ambiguous` cases remain in coverage reports but outside binary accuracy and calibration denominators until adjudicated. Preserve inherited labels and independent labels separately when they differ.

## Thread readings and final grades

Label thread readings from the transcript prefix plus the map available at that cutoff. Project novelty and new interview preferences are separate questions. Only participant evidence can answer or decline a gap. A clarification is not a stall. A declined subject includes an adjacent version of that same subject, but does not decline unrelated gaps. Identify acceptable next-thread IDs as a set; equivalent useful choices must not be penalized just for differing from Jev.

For final grading, use the shipped objective criteria and reading rubrics with the transcript prefix. Cite participant passage IDs. Distinguish `not-yet`, `touched`, `explored`, and `set-aside`; uncertainty about one detail does not erase supported evidence about another. Public research and interviewer suggestions do not establish participant facts. A selected passage must support the claimed objective, not merely mention similar words.

For scored readings, return an acceptable interval on the existing 0–4 rubric, an evidence ID, and a reason. Use unavailable when the dialogue does not support observation. Preserve ambiguity; do not make either evaluated provider the authority.

## Outcome grading

- `pass`: supported decision, valid evidence, and acceptable downstream action.
- `minor`: a defensible alternate ranking or score within the labeled interval; no incorrect action. Counts as acceptable.
- `major`: wrong coverage, unsupported score, missed useful continuation, or poor thread choice.
- `critical`: ignored explicit boundary, unsupported objective credit from the wrong speaker, acted after cancellation, or false termination of a continuing interview.
- `unscorable`: missing input, ambiguous label, or unreconstructable state. Report separately, never as a pass.

Classify failures as `semantic`, `evidence`, `calibration`, `state-reconstruction`, `transport`, `timeout`, `refusal`, `stale-result`, or `label-defect`. Adapter integrity and stale-result failures are deterministic checks, not semantic judge votes.
