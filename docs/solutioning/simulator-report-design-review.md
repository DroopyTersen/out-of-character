# Post-session report: five UI review iterations

Reviewed in the real Storybook on September 27, 2026. Screenshots are local, ignored artifacts in `output/report-design/`; each pair uses the same story and viewport. Recorded transcripts and illustrative reports avoid paid calls. The final design preserves provisional grades while prose streams and replaces all grades only after validated completion.

## Iteration 1

### Before screenshot
![Compiling at 390 px, before](../../output/report-design/iteration-1-before.png)

### 5 Critiques (most severe first)
1. Skills begin below the entire objective list: a waiting user must scroll too far to see their provisional reading. Put compact skills first on phones.
2. Seven full-width skill rows create unnecessary vertical length. Use two columns, as in the live screen.
3. The compiling card has a large portrait and a wrapping status heading. Reduce the portrait and shorten the status to leave room for results.
4. The green “Provisional reading” status looks conclusive. Use a muted blue label while the report is pending.
5. “Any order” is a live-session instruction with no purpose in a debrief. Give the objective count a review-state label.

### Changes applied
- `app/simulator/debrief.tsx`: compact skills and clearer compiling copy.
- `app/simulator/feedback.tsx`: configurable objective count label.
- `app/simulator/simulator.css`: compact report heading and two-column phone skills.

### After screenshot
![Compiling at 390 px, after](../../output/report-design/iteration-1-after.png)

## Iteration 2

### Before screenshot
![Completed at 390 px, before](../../output/report-design/iteration-2-before.png)

### 5 Critiques (most severe first)
1. The overview is oversized for a concise report and reads as a wall of text. Lower its type size while preserving comfortable line height.
2. Coaching section headings blend into the body. Increase their weight and contrast.
3. The practice takeaway is indented with its arrow, wasting a narrow text column. Align the paragraph with the rest of the report.
4. “See the moment” has a weak link affordance and a short target. Give it an underline and a 44-pixel minimum target.
5. Transcript and replay actions are separated by excessive blank space. Reduce the stacked bottom margins.

### Changes applied
- `app/simulator/simulator.css`: report typography, evidence targets, takeaway alignment, and action spacing.

### After screenshot
![Completed at 390 px, after](../../output/report-design/iteration-2-after.png)

## Iteration 3

### Before screenshot
![Failed report with missing readings at 320 px, before](../../output/report-design/iteration-3-before.png)

### 5 Critiques (most severe first)
1. Skill labels and values overflow the 320-pixel viewport. Reduce narrow-screen type/gaps and constrain grid tracks.
2. Missing readings still say “Provisional reading,” and transitioning bars imply a measured value. Explicitly label missing data and keep empty bars empty.
3. The compiling copy claims scores are ready even when none exist. Make the waiting explanation reflect available data.
4. The small, quiet retry button gets lost in an error card. Give failure a restrained warm accent and make the phone action full-width.
5. The scale and status wrap unpredictably under the skills title. Give the scale and status explicit rows.

### Changes applied
- `app/simulator/debrief.tsx`: honest missing-reading copy and failure state styling.
- `app/simulator/simulator.css`: bounded skill grid, empty bars, status alignment, and retry target.

### After screenshot
![Failed report with missing readings at 320 px, after](../../output/report-design/iteration-3-after.png)

## Iteration 4

### Before screenshot
![Completed at 1440 px, before](../../output/report-design/iteration-4-before.png)

### 5 Critiques (most severe first)
1. The desktop report stretches across a huge card but uses only part of it. Limit the overall width and give coaching a readable column.
2. The assessment sits below the entire report despite available horizontal space. Show both side by side on wide screens.
3. Single-column desktop skills create a tall, unbalanced assessment. Use a compact two-column grid.
4. Oversized pixel section headings compete with the report title. Reduce assessment subheading size.
5. The assessment has no visual container while coaching has a strong card edge. Match border treatment, with a quieter assessment background and subtle coaching gradient.

### Changes applied
- `app/simulator/debrief.tsx`: one shared content wrapper.
- `app/simulator/simulator.css`: two-column desktop layout, consistent cards, shorter skill rows, and bounded reading width.

### After screenshot
![Completed at 1440 px, after](../../output/report-design/iteration-4-after.png)

## Iteration 5

### Before screenshot
![Streaming at 390 px, before](../../output/report-design/iteration-5-before.png)

### 5 Critiques (most severe first)
1. “Preparing your feedback…” remains vague once words appear and crowds the header. Say “Writing your feedback” while streaming.
2. Objective results still say “Confirmed” before final review. Label them provisional until validation completes.
3. Missing-data failure copy claims a provisional assessment exists. Promise only the conversation when readings are absent.
4. Transcript disclosure uses a tiny left triangle while other disclosures use a right chevron. Match the disclosure pattern and retain a generous target.
5. Missing skills invite the user to inspect nonexistent evidence. Offer skill details instead.

### Changes applied
- `app/simulator/debrief.tsx`: accurate state wording and transcript disclosure.
- `app/simulator/feedback.tsx`: provisional count label and context-sensitive skill guidance.
- `app/simulator/simulator.css`: matching transcript disclosure affordance.
- Consolidated iteration styles into one report section and removed obsolete canned-takeaway styling.

### After screenshot
![Streaming at 390 px, after](../../output/report-design/iteration-5-after.png)

## State coverage

Storybook provides compiling, streaming, completed, retry available, retry exhausted, session unavailable, insufficient conversation, and status connection failure. Controls also cover missing Jev readings, interrupted attempts, strong/weak/sparse examples, and ungraded Happy Hour. Replay shows the compiling-to-streaming-to-final transition without paid requests.

Browser acceptance exercises the actual application, React hooks and AI SDK parser with only paid media/network boundaries substituted. It verifies provisional scores stay visible during streamed partial grades, final grades apply together, failed partial prose clears, retries are bounded, leaving aborts local work, late End failure recovers, and ungraded sessions never start paid report generation. Persisted-page lifecycle simulations verify that returning to a running report offers a status check without a second generation, and returning to a failed report preserves a working Retry action. Physical iOS Safari Back/Forward cache behavior was not tested.

Final recaptures after the code-quality cleanup preserved the intended layout: compiling at 390 px, completed at 1440 px, and unavailable with missing readings at 320 px. Each had no horizontal overflow. These are saved as `reviewed-compiling.png`, `reviewed-completed.png`, and `reviewed-unavailable.png` in the same screenshot directory.
