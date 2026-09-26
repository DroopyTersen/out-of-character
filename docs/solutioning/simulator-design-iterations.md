# Simulator visual iterations

Acceptance target: [selection](../mockups/simulator-selection-scroll-v3.png), [live](../mockups/simulator-live-v4.png), and [debrief composition](../mockups/simulator-debrief-v2.png). Preserve the seven real skills, 0–4 rubric, actual quotations, two scenarios, and three clients. Mockup sample values and extra catalog entries are illustrative.

Iteration-one screenshots use production components inside browser viewports of 1672×941 and 390×844; the component itself is narrower (1381 pixels in the desktop workshop). They establish before/after component changes, not full-screen pixel fidelity. Iteration two uses full viewport Screen only captures for the actual mockup comparison. The same capture script and framing are used before and after: `bun scripts/simulator-design-capture.mjs`, with `ACCEPTANCE_OUTPUT` pointing to each iteration directory. Workshop chrome is outside the component captures. Supplemental full-screen views verify production composition.

## Iteration 1

### Before screenshots

Local evidence: `output/simulator-design-1-before/{selection,live,debrief,judging}-{1672,390}.png`.

### Five critiques, ordered by impact

1. **Observed fidelity gap — client identity.** The reused game sprites do not resemble the approved business clients. Replace them with dedicated transparent portraits matching Morgan, Avery, and Casey; use the larger waist-up treatment in the live screen and selected-client brief.
2. **Observed fidelity gap — type and live hierarchy.** Headings are much lighter, labels and controls smaller, and score bars thinner than the reference. Restore bold pixel headings, legible conversation text, and the mockup's balanced three-column proportions without adding cards around every group.
3. **Observed fidelity gap — selection density.** Summary-heavy rows show only two scenarios where the reference shows three and part of a fourth. Use compact icon-led category/title rows, a visible scroll gutter, and a stable lead below. Bring the selected-client portrait back beside its details.
4. **Observed hierarchy gap — debrief.** A single-line outcome has none of the reference banner's emphasis or character identity. Add a portrait, clear outcome and objective count; keep real evidence and the seven-skill final reading below.
5. **Design judgment — animation and inspection.** The current waveform simply stretches a repeated pattern from one volume number, and the expanded lab JSON becomes a very long page. Give each speaker an actual frequency display and distinct states; bound raw inspection to a scrollable pane. The lab has no approved mockup, so its changes prioritize comparison and readability.

### Changes applied

Implemented: dedicated mockup-derived portraits in `public/simulator/`, compact icon-led scenario rows and selected-client portrait, larger bold pixel headings and feedback, a portrait/outcome/count debrief banner, bounded raw JSON, and actual frequency analysis in `audio-levels.ts`. A dedicated voice workshop exposes client/trainee/overlap/listening/muted/connecting/ending states, intensity, replay/pause/reset, and reduced motion. Production uses separate Web Audio analysers; illustrative workshop samples are labeled. The new Screen only control hides workshop chrome while preserving fixture state. Typecheck passes.

### After screenshots

Local evidence: `output/simulator-design-1-after/{selection,live,debrief,judging}-{1672,390}.png`. These match the before capture framing. Phone element captures can include the sticky workshop header; the second round also captures the new Screen only mode to inspect production composition.

## Iteration 2

### Before screenshots

`output/simulator-design-2-before/` contains all four screens at desktop and phone widths, now also in Screen only mode with the production header. This removes workshop chrome from proportion checks while preserving the same fixture state.

### Fresh critiques

1. **Observed fidelity gap — desktop vertical rhythm.** At the mockup’s 1672×941 viewport, the large top header/selection spacing puts Start simulation below the fold; live controls barely cross it. Tighten the header and surrounding space while retaining readable type and the approved proportions.
2. **Observed affordance gap — catalog rails.** The selection rail and list have no persistent visible scrollbar on the test browser; portrait cards retain excessive transparent margin. Expose scroll tracks, enlarge the portrait within its card, and make arrow bounds/touch targets clear.
3. **Observed repetition — debrief evidence.** Two high-scoring skills quote the exact same passage twice, adding an entire duplicate block on the phone. Group labels for a shared passage and show that quotation once.
4. **Observed preview defect — navigation and layering.** Screen only duplicates The game and Play the game; the fixed workshop return button overlaps content, and sticky chrome can cover the captured scenario row. Keep one game link and put the workshop return in normal flow.
5. **Design judgment — lab scanability.** The lab metadata and check tokens are very small, and the two columns lack a clear transcript/assessment label. Improve metadata rhythm and headings while retaining exact source/model provenance and raw inspection.

### Changes applied

Implemented tighter desktop spacing, persistent scroll tracks and card-size paging with disabled endpoints, larger portrait crops and touch targets, grouped debrief quotes, a shorter mobile-safe debrief title, one navigation link and a non-overlapping workshop return, a stable mobile timer/end row, and clearer lab column headings/provenance. Reduced-motion production and preview use steady activity indicators; state replay remains available. Final checks/captures are running.

### After screenshots

Pending: `output/simulator-design-2-after/`.
