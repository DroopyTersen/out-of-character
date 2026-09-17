# Out of Character: gameplay concept, version 3

September 17, 2026

[Game PRD](../solutioning/consultancy-party-game-prd.md) · [Character seeds](../consultancy-party-game-characters.md)

This static concept simplifies the character stage and caption footer. The target dial and its racing bar both show the same independent Noul reading, 82/100. The highlighted win zone is 80–100, and the hold indicator shows 6 of the required 10 continuous seconds. A turn ends with an automatic win after holding the zone, or the red Give up action. The clock shows elapsed time. Earlier concepts remain available for comparison.

![Out of Character gameplay concept](out-of-character-gameplay-v3.png)

## Exact edit prompt

Version 2 was the visual reference for this revision.

```text
Use case: ui-mockup image edit.
Edit target: referenced version 2 Out of Character gameplay image.
Create a refined version 3 of the same screen. Preserve the wide 16:9 flat straight-on arcade UI, dark navy background, mint target accents, amber rival, original crisp 8-bit character sprites, two main columns, semicircular dial, and successful racing bar design. Improve spacing and remove clutter. This is a gameplay screenshot, not a landing page or photo.

HEADER:
Keep exact game title "OUT OF CHARACTER" with small "CONSULTANCY EDITION".
COMPLETELY REMOVE "ALEX'S TURN".
Only show a small elapsed clock "ELAPSED 00:28" toward the right, then a red button labeled exactly "GIVE UP" at the far top right. Button red/coral with readable light text, not mint. Remove "LOCK IT IN" everywhere. No countdown.

LEFT COLUMN REDESIGN — clean vertically aligned character stage:
The previous left side was cluttered because name, prose, giant sprite, and boxed scene were squeezed side by side. Replace that with one calm centered vertical stack inside the same left column. No interlocking text boxes, no text wrapping around the sprite, no separate little headings littering the stage.
At top, centered readable target name "ARCHITECTURE ASTRONAUT" in approximately two balanced lines if necessary, prominent but less oversized than previous.
Below, a brief centered backstory in smaller subdued readable text, exactly:
"Fourteen services. One glorious diagram.
The checkout page is a presentation-layer concern."
Keep it to two compact lines; do not use the previous long paragraph.
Then a generous large centered original pixel astronaut consultant sprite, roughly the same charming identity with space helmet, office shirt and red tie, rolled diagram, without invading any text. Plenty of breathing room.
Below the sprite, a single clean understated scene prompt, readable medium typography, exactly:
"Pitch a solution for booking a meeting room."
Use a tiny muted "SCENE" prefix if needed. No big bordered scene card, no icon box, no huge competing heading. Allow two tidy centered lines.
The lower half remains the large semicircular speedometer.

DIAL — NEW WIN MECHANIC:
A genuine semicircular meter from 0 to100 with ticks at 0,25,50,75,80,100. Make80 boundary clear without overlapping75.
The arc below80 is muted steel blue. The high-end arc from80 to100 is distinctly bright mint/green: this continuous colored band is the WIN ZONE. Label the colored band "WIN ZONE", positioned cleanly near its high-end outside edge. There is NO single90 threshold marker and NO90-to-win text or checkered flag. Do not show75 as the start; exact winning boundary is80.
Current needle points correctly to82, just inside the green band. Large central readout "82 / 100". Do NOT include "CHANCE OF A YES", "TARGET MATCH", "NO", "YES", or "UNCERTAIN". No probability teaching labels.
Immediately beneath the dial, a beautiful compact 10-segment hold-progress strip with exactly the first6 segments filled in mint and last4 dim. Label "HOLD THE ZONE" and numeric "6 / 10s".
Small single-line instruction below the hold-progress strip: "Stay at 80+ for 10 seconds to win."
This shows a player6 continuous seconds into the required10-second hold; no victory celebration yet. If score falls below80 the hold resets in the game, but no extra prose explaining that on the screen.
No drift banner.

RIGHT COLUMN — KEEP THE RACE, REMOVE EXTRA LABELS:
Only main heading "WHO DO YOU SOUND LIKE?".
DELETE "LIVE CHARACTER MATCHES" and "Matches can overlap." entirely. A tiny unobtrusive green live dot can remain without extra subtitle rows.
Use the freed vertical space for generous row spacing.
Keep the same12 racing rows, pixel avatars, smoothly changing rank indicators, values and shared0–100 bar-length scale:
Deja Vu Architect88%, orange leading bar.
Architecture Astronaut82%, mint second bar, "TARGET" badge and pinned visibility.
Azure Icon Collagist66%.
Strategy Fog Machine54%.
Design Pattern Hoarder43%.
Shiny Stack Evangelist32%.
Certification Peacock24%.
Kubernetes For Seven People19%.
Agent For Everything15%.
Refactor Missionary12%.
Serverless Inquisition9%.
Demo Was the Product6%.
Other bars muted blue.
Every row must use the correct matching original tiny pixel avatar; clear readable names and percentages.
Bar lengths faithfully reflect each independent per-character Noul percentage; values intentionally do NOT sum to100. The target dial and its row both equal82. Do not introduce a normalized Choice distribution.
Keep collapsed footer "ALSO-RANS (8)" with a chevron and understated "Below 5%"; no zero rows visible.

BOTTOM TRANSCRIPT — SIGNIFICANTLY SMALLER:
Replace the giant two-line pixel caption block with a slim full-width footer, approximately8–9% of total canvas height, not16%.
Small microphone glyph and label "CAPTIONS", followed by modest readable clean mixed-case white text, roughly the visual size of bar-chart character names, not oversized display lettering:
"We tried this in 1998. Of course, today we'd use fourteen services and an event bus..."
One line if it fits naturally, or two compact normal-size lines with good padding. All words unstyled white, no colored keywords, no highlighting, no attributed phrases. Subtle scroll indicator allowed.

Constraints: very clean orderly typography and hierarchy, consistent margins, centered left-stage composition, no text colliding with sprites or tick labels. Preserve delightful pixel-art personality but reduce visual noise. Exact labels and numerical semantics essential. A turn now ends automatically after continuously staying80–100 for10seconds OR when the redGiveUp button is pressed, not cash-out/lock-in. Capture the ongoing hold at6seconds in a static illustration. No stock photographs, no monitor/device frame, no extra tagline or mascots, no watermarks.
```
