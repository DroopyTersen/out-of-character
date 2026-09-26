# Compact simulator implementation

September 26, 2026. Implement the [mobile v3 concept](../mockups/simulator-mobile-compact-v3.png). Andrew clarified: compact changes apply only to mobile; keep the original desktop layout. Client behavioral stats are hidden in the simulator and available only as workshop diagnostics. The older generated brief's stats are superseded by this decision.

## Scope

- Remove behavior stats from trainee selection, simulator catalog payloads, and the public Client type. Preserve the server-side actor stats and judging behavior. The workshop loads a separate diagnostic projection and shows it outside production components.
- On mobile, use a small client strip with the existing two-channel audio animation. Open a session brief containing only public client information, scenario, role, lead, objectives, and service capabilities.
- Remove the mobile last-transcript-line preview. Keep the full transcript available on demand; desktop retains its excerpt and inline transcript.
- Present actual coaching as a single dismissible overlay toast over the client area, spanning the full mobile screen width with inset text and close control. It reserves no layout space, does not cover objectives or call controls, does not expire automatically, and can be reopened from the lightbulb. A new hint can appear after dismissal; routine score updates cannot bring the dismissed hint back.
- Keep all five sales objectives and seven trainee skills compact on phones. Retain readable type and accessible touch targets. Preserve the existing desktop three-column layout, large portrait, transcript excerpt, inline hint and header End control.
- Reuse existing dialog and animation primitives. Keep the DIY workshop on production components and provide isolated feedback/brief states.

## Checkpoints

1. Plan and privacy boundary. Review the plan with Opus; remove stats from public payloads and selection.
2. Implement the compact conversation, brief and transcript dialogs, overlay toast and responsive styles. Review code and first screenshots with Opus; fix material feedback.
3. A second screenshot critique/refinement, keyboard and dismissal tests, existing workshop/audio checks, full repository gate, and final review. Commit explicit paths after each coherent checkpoint.

## Acceptance

- The catalog excludes stats while the actor still receives the authored values.
- The mobile brief never displays stats or hidden objectives. It scrolls internally, supports Escape and restores focus. Workshop diagnostics can show stats without changing the production components or simulator catalog.
- Showing/dismissing a toast causes no objective/skill movement. Reopening works; the same hint remains dismissed across evaluation revisions. No automatic toast during connecting, ending, or unavailable feedback.
- Transcript opens with focus inside and returns focus to its trigger. Opening either dialog leaves the live session running.
- Phone and desktop screenshots at 320, 390, 1024 and 1672 pixels have no horizontal overflow; the normal 390 × 844 live view shows all objectives and skills above reachable controls. Longer evidence remains scrollable.
- Workshop interactions make no microphone/provider requests. Reduced motion stays supported.
- Run the existing full check gate and record its exact result. This request changes code locally; deployment is a separate step.

## Progress

- Baseline: clean `simulator-mvp` at `0d2a1f3`. Existing live screen has a large portrait, transcript excerpt and an in-flow hint. Selection currently exposes behavior stats, including in the public catalog.
- Privacy implementation delegated in parallel; conversation/layout implementation owned by the lead.
- Checkpoint 1: catalog and browser `Client` no longer expose stats; the private actor retains all six values. API/domain tests passed 14/14 and typecheck passed after selection removal. Opus found no privacy blocker. Its focus-return, permanent announcement region, narrow-screen concern sizing, and short mobile viewport recommendations are included in the UI pass. Dialogs use the existing Radix-backed component; no new state store or timer is needed.
- Scope clarification: restored the original desktop composition after Andrew rejected the compact desktop variant. Mobile-only overrides now carry the compact layout; workshop stats use their own loader projection. Earlier compact-desktop screenshots are superseded and are not final acceptance evidence.

## Visual iteration 1 — Mobile density

Before: [390px live screen](../../output/simulator-compact-before/live-390-viewport.png). After: [mobile composition](../../output/simulator-compact-mobile-only/live-390-viewport.png).

1. The stacked header and session metadata consumed much of the first screen. Reduced the mobile header and session bar to one row each.
2. The portrait and client details dominated the screen. Replaced them on mobile with a compact animated strip and a full-area brief trigger.
3. The transcript excerpt repeated audio while pushing the practice objectives down. Moved mobile transcript reading into an on-demand dialog.
4. The in-flow hint added another tall section before objectives. Changed mobile coaching to an overlay with dismissal and a lightbulb toggle.
5. The seven skills were far below the fold. Used a two-column mobile grid and fixed call controls, with scroll clearance for shorter screens and expanded evidence.

Changes are in `conversation.tsx`, `feedback.tsx`, `voice-display.tsx`, `session-brief.tsx`, and the mobile section of `simulator.css`. Desktop was compared with the original capture and restored, including its inline transcript. The 1672px full-page image matched the baseline; viewport differences were limited to a single pixel at 1672px and small rendering differences at 1024px, with identical layout bounds.

## Visual iteration 2 — Overlay and sheet refinement

Before: the first mobile composition above and `output/simulator-compact-review-final/` sheet captures. After: [full-width hint](../../output/simulator-compact-review-accepted/390-844-concern.png), [320px hint](../../output/simulator-compact-review-accepted/320-800-concern.png), [brief](../../output/simulator-compact-review-accepted/390-844-brief.png), and [short-phone transcript](../../output/simulator-compact-review-accepted/390-664-transcript.png).

1. The inset toast left unused width and wrapped earlier than needed. Following Andrew's correction, it now spans the mobile viewport, with inset text and a 44px dismiss control.
2. The small client portrait was hard to recognize. Cropped and enlarged its artwork inside the existing mobile portrait bounds.
3. The full-strip hover fill washed out client text. Replaced the fill with a subtle inset outline.
4. The mobile transcript heading and text close control competed for width. Shortened the visible heading to “Transcript” and used a labeled 44px close icon.
5. The brief buried useful service information beneath objectives already visible on the live screen. Moved capabilities above the repeated objectives.

The long concern ends before objectives at 320px and 390px. Dismissal changes no objective or skill geometry. At 390 × 664, all skills can scroll above the fixed dock with 13px clearance. The larger mobile screen shows all five objectives and seven skills; smaller screens retain scrolling instead of reducing text further.

## Review disposition and final verification

Opus reviewed the plan and implementation through the desktop Code UI. Fixed its material findings: a cleared concern can reappear later; the stats-key bundle guard remains enabled; the lightbulb toggles with the correct accessible name; call controls have a group role; and the mobile transcript opens at the latest turn. Ordinary hint dismissals survive score revisions. The separate workshop stats view is explicitly authorized; no new access-control system was added.

Final review found no material issues and accepted the MVP. The full-width hint covers the brief affordance until dismissed, consistent with the requested overlay. One optional follow-up remains for desktop browsers narrowed to phone width with classic, always-visible scrollbars: viewport-width sizing can include their scrollbar. The tested phone layouts use overlay scrollbars and have no horizontal overflow.

- `bun run check`: passed typecheck, 112 tests / 3,765 assertions, production builds, privacy scan of 15 client assets, and Wrangler dry run. Log: `output/simulator-compact-reviewed-check.log`.
- Compact acceptance: 5/5 in `output/simulator-compact-reviewed/report.json`, including exact 0–390px and 0–320px toast bounds, dismissal/recurrence, both dialogs, focus restoration, latest transcript, desktop preservation, and workshop-only stats.
- Existing workshop acceptance: 8/8; feedback acceptance: 3/3. Reports: `output/simulator-compact-workshop-final/` and `output/simulator-compact-feedback-final/`.
- Responsive screen matrix: 16/16 at 320, 390, 1024, and 1672px in `output/simulator-compact-final-design-retry/report.json`. The newer accepted mobile captures above supersede that matrix's inset hint screenshots.
- Audio verification: all four viewport/motion combinations and the real analyser probe pass in `output/simulator-compact-voice-diagnostic/report.json`. The first run had one oscillator assertion failure; that report is retained in `output/simulator-compact-final-voice/`. Failure reporting now preserves analyser measurements; no production audio code changed to obtain the passing retry.
- Browser runs recorded no provider requests, microphone calls, JavaScript errors, or horizontal overflow. These are browser viewport checks, not a physical-phone voice trial. No deployment was performed.
