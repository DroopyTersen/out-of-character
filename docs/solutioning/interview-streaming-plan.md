# Interview summary streaming and conversational focus

Main's streamed coaching reports are merged through `3819e6a` in `aa51d0b`. Reuse that implementation for this POC.

- Give the interview its own simple `{ text }` output schema and participant-only summary instructions. Use GPT-6 Sol, medium reasoning, through the same OpenAI Responses / AI SDK path as the simulator report. Never send producer directions or participant readings to the summary model.
- Share the bounded report stream, cancellation, one explicit retry, and authoritative final-status read. The browser starts generation after End, just as it does for simulator reports. Save the closed transcript independently before saving any summary result; leaving before generation starts can leave an unfinished summary.
- Make the existing report lifecycle and browser hook accept their concrete content schema. Keep coaching evaluation and interview prose separate. No new transport, queue, storage service, or general workflow framework.
- Show preparing, writing, complete, and unavailable states. Render streamed prose immediately, offer Copy only after validated completion, and discard failed drafts. Add an isolated Debugger example of the writing state.
- Preserve private interview storage, session ownership checks, original participant readings and fourteen optional topics. Summaries remain informal accounts rewritten for internal use, not trainee coaching or scores.
- Keep Sam's opening softball. Treat project/role context as a brief orientation, then follow the participant's strongest firsthand win, surprise, friction, decision, or lesson. Ask a follow-up when it adds understanding; let an answer stand when it is enough. Align the producer with that approach without a new detector or coverage target.

Verification: real SDK streaming through a substituted HTTP boundary; partial output before completion; reasoning excluded; interruption and invalid completion; owned session endpoints; transcript-first private persistence; simulator regressions; actual desktop/mobile browser flow and Debugger writing state. Run the complete repository gate and a bounded synthetic provider rehearsal. Review key commits in Claude desktop. Deployment remains a separate requested action.
