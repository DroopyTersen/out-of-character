# Compact simulator implementation

September 26, 2026. Implement the [mobile v3 concept](../mockups/simulator-mobile-compact-v3.png), with one correction from Andrew: client behavioral stats stay private. The older generated brief's stats are superseded by this decision.

## Scope

- Remove behavior stats from trainee selection, public catalog payloads, and browser types. Preserve the server-side actor stats and judging behavior.
- Use a small client strip with the existing two-channel audio animation. Open a session brief containing only public client information, scenario, role, lead, objectives, and service capabilities.
- Remove the last-transcript-line preview. Keep the full transcript available on demand.
- Present actual coaching as a single dismissible overlay toast over the client area. It reserves no layout space, does not cover objectives or call controls, does not expire automatically, and can be reopened from the lightbulb. A new hint can appear after dismissal; routine score updates cannot bring the dismissed hint back.
- Keep all five sales objectives and seven trainee skills compact on phones. Retain readable type and accessible touch targets. Use the same content hierarchy on desktop, with objectives and skills side by side.
- Reuse existing dialog and animation primitives. Keep the DIY workshop on production components and provide isolated feedback/brief states.

## Checkpoints

1. Plan and privacy boundary. Review the plan with Opus; remove stats from public payloads and selection.
2. Implement the compact conversation, brief and transcript dialogs, overlay toast and responsive styles. Review code and first screenshots with Opus; fix material feedback.
3. A second screenshot critique/refinement, keyboard and dismissal tests, existing workshop/audio checks, full repository gate, and final review. Commit explicit paths after each coherent checkpoint.

## Acceptance

- The catalog excludes stats while the actor still receives the authored values.
- The brief never displays stats or hidden objectives. It scrolls internally, supports Escape and restores focus.
- Showing/dismissing a toast causes no objective/skill movement. Reopening works; the same hint remains dismissed across evaluation revisions. No automatic toast during connecting, ending, or unavailable feedback.
- Transcript opens with focus inside and returns focus to its trigger. Opening either dialog leaves the live session running.
- Phone and desktop screenshots at 320, 390, 1024 and 1672 pixels have no horizontal overflow; the normal 390 × 844 live view shows all objectives and skills above reachable controls. Longer evidence remains scrollable.
- Workshop interactions make no microphone/provider requests. Reduced motion stays supported.
- Run the existing full check gate and record its exact result. This request changes code locally; deployment is a separate step.

## Progress

- Baseline: clean `simulator-mvp` at `0d2a1f3`. Existing live screen has a large portrait, transcript excerpt and an in-flow hint. Selection currently exposes behavior stats, including in the public catalog.
- Privacy implementation delegated in parallel; conversation/layout implementation owned by the lead.
- Checkpoint 1: catalog and browser `Client` no longer expose stats; the private actor retains all six values. API/domain tests passed 14/14 and typecheck passed after selection removal. Opus found no privacy blocker. Its focus-return, permanent announcement region, narrow-screen concern sizing, and short mobile viewport recommendations are included in the UI pass. Dialogs use the existing Radix-backed component; no new state store or timer is needed.
