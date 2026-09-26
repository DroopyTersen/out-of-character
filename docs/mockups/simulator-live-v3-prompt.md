# The Simulator — calmer live screen v3

This revision follows the agreed shared skills in [the simulator proposal](../solutioning/simulator-proposal.md#agreed-default-consulting-and-sales-skills): Credibility, Confidence, Listening, Rapport, Clarity, Guidance, and Adaptability. Scores reflect effectiveness with the selected client, including how the interaction is landing. A difficult client can therefore mean lower relevant scores.

## Visual changes

- Three quiet columns for the client, live skills, and coaching/objectives.
- Smaller headings, slim continuous score bars, and much less framing.
- One current caption below the client; the full transcript is available through a quiet control.
- Hint remains above the objectives. All five objectives stay visible in their original order.
- THE SIMULATOR remains top right; no Private Practice badge.
- Scores and dialogue are illustrative. This is a design mockup, not an implemented screen.

## Output

`simulator-live-v3.png`

Visually reviewed after generation: all seven skill names and values are readable; all five objectives are present with the third and fourth checked; the hint remains above the objectives; the title is at top right; the current caption and controls remain visible. The output is 1672 by 941 pixels.

## Exact prompt

Built-in imagegen edit. Input: `simulator-live-v2.png`.

Use case: precise-object-edit.
Asset type: polished desktop UI mockup for The Simulator.
Input image 1 is the edit target: the existing live simulator screen. Redesign this screen to feel noticeably calmer and less busy, while showing seven agreed consulting and sales skills. Preserve its Out of Character identity, navy/mint palette, pixel-art style, exact Morgan character identity, selected SharePoint sales scenario, objective states, and top-right THE SIMULATOR title.

Return one flat, straight-on, complete widescreen 16:9 app screenshot at high resolution, approximately 1672 by 941 pixels. No device frame, perspective, annotations, collage, or presentation background.

VISUAL DIRECTION:
Deep matte navy canvas, cool white primary text, desaturated blue secondary text, mint highlights, and a small amount of quiet amber reserved for coaching. Preserve the crisp office pixel-art character and pixel-font branding. Use smaller pixel headings and readable technical sans-serif body text. This should feel like a focused conversation workspace. Create breathing room through alignment and whitespace, not by shrinking the text to an unreadable size.
Remove the busy network of bright cyan boxes, every-row dividers, heavy segmented meters, oversized MORGAN title, decorative floating plus signs, large waveform, and full-width transcript footer. Do not put every element into its own card. Use at most a couple of very subtle hairline dividers. No gradients, glass effects, glows, ornate corner cuts, radar charts, or seven separate metric cards.

HEADER:
Keep the mint/blue theater-mask emblem and white OUT OF CHARACTER wordmark at top left, and mint THE SIMULATOR at top right. No Private Practice label, privacy footer, lock icon, or duplicate simulator subtitle.
Below the header, a simple unboxed session row: a small muted "SALES" label and "The SharePoint opportunity" as the main scenario title. On the right, muted time "03:42" and a modest coral-outline "End session" button. Omit the ELAPSED label and the oversized briefcase icon.

MAIN LAYOUT:
Three quiet columns with generous gutters: about 29% for the client, 29% for the skills, and 36% for coaching and objectives, with the remaining width in gutters. All essential content fits on the one screen. Align the column content naturally; no large outer panel frames. Allow the navy canvas to breathe.

LEFT — CLIENT AND CONVERSATION:
Modest pixel heading "MORGAN", and smaller muted line "IT Director · Direct & challenging".
Retain the same Morgan sprite: medium-brown skin, salt-and-pepper hair, rectangular dark glasses, short beard, navy blazer over pale open-collar shirt, folded arms. Make the character around 280–310 pixels tall, comfortably centered, with the same attentive challenging expression.
Below, a small mint dot and "Morgan is speaking", with a SHORT, quiet mint waveform. This status should take far less space than in the input image.
Below it, show the current client caption in readable muted white text with comfortable line breaks:
"Priya owns that area. She'd need to be involved."
No bordered transcript box, no duplicate trainee caption, no CONVERSATION heading. Beneath the caption, two understated text controls with tiny icons: "Mic on" and "Transcript". The transcript control represents access to the full transcript; only the current caption is shown in this calm default view.

MIDDLE — SEVEN LIVE SKILLS:
Pixel heading "YOUR SKILLS" in a moderate size. A tiny mint dot and "Jev · live" may sit alongside; a discreet "Out of 5" scale label is shown once.
A single tidy vertical list of SEVEN rows, all visible. Each row has the skill name on the left, a clean tabular numeric value on the right, and a slim continuous mint bar on a dark blue track beneath. The bars are only about 4–6 pixels tall, with no segments, tick marks, or borders. Generous vertical spacing between rows. Use exactly these names, this order, and these example values:
Credibility — 3.9
Confidence — 3.6
Listening — 3.2
Rapport — 2.8
Clarity — 4.2
Guidance — 3.4
Adaptability — 3.1
Bar lengths should match each value divided by five. Show the scale once in the header, not a repeated "/ 5" on every row. All seven bars share one restrained mint color; no rainbow of statuses, trends, arrows, badge labels, descriptions, or overall score. The old Assertiveness, Flexibility, Discovery, and Relevance rows must be fully replaced.

RIGHT — QUIET COACHING ABOVE OBJECTIVES:
At the top, an understated amber "LIVE HINT" label and the hint in readable body text:
"Ask what the SharePoint friction is costing the team."
A tiny amber left rule or faint warm tint is enough; remove the bright amber rectangular border and large sparkle icon. This hint stays ABOVE the objectives.
After a generous gap or one quiet hairline, show a modest pixel heading "OBJECTIVES", with a small "2 / 5" at the right and a tiny muted "Any order" helper.
Show exactly these five rows, all visible in this fixed order:
Empty circle — "Understand the SharePoint problem"
Empty circle — "Find the business impact"
Mint check — "Find the right stakeholder"
Mint check — "Discuss relevant capabilities"
Empty circle — "Earn a next step"
Use small status icons, readable white labels, and spacing instead of boxed rows or heavy separators. Only rows three and four are complete. Omit the extra evidence labels such as Priya and SharePoint & collaboration from this default view to reduce clutter; details would be available by selecting an objective. Do not hide, collapse, reorder, or lock objectives. There is no stepper or required sequence.

FINAL CHECK:
This is the same simulator, simplified rather than rebranded. THE SIMULATOR remains top right. Morgan remains recognizable. All seven exact skill names and all five objective labels are visible and readable. The hint is above the objectives. The current voice caption and essential controls remain easy to find. Use calm spacing, restrained contrast, and a clear hierarchy so a person can follow the conversation while glancing at feedback.
