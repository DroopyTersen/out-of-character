# Compact mobile simulator concept v2

Generated September 26, 2026 using the built-in image generation tool.

Output: [simulator-mobile-compact-v2.png](simulator-mobile-compact-v2.png)

Reference: [compact mobile concept v1](simulator-mobile-compact-v1.png).

This concept shows two states of the same mobile interface: the live session and its open session brief. It is a design mockup, not an implemented UI change.

## Design decisions

- A compact, tappable client strip opens a modal containing public client information, scenario, lead, and service capabilities.
- Private actor facts, motives, budgets, and directions remain hidden.
- The main view has no transcript preview. The transcript remains accessible from the call controls.
- All five objectives and seven skills remain visible in the compact live view.
- A single dismissible hint toast sits above the call controls without covering scores or objectives.
- Hints stay until dismissed. The lightbulb reopens the current hint; only a meaningfully new hint resurfaces after dismissal.
- The brief scrolls internally when needed. The live session continues while the brief is open.

## Final prompt

```text
Use case: ui-mockup. Revise the attached compact mobile Simulator concept with the user's new layout decisions.

Create ONE high-fidelity comparison image containing TWO phone-sized app screens side by side, each with a realistic 390 × 844 logical-pixel portrait proportion, rendered sharply at high resolution. Small understated labels outside the screens: “Live session” above the left and “Session brief” above the right. A narrow neutral navy gutter. Flat UI screenshots, no phone hardware, perspective, hands, decorative arrows, or presentation copy. The two screens are states of the SAME interface, not alternative designs.

Reference image 1 is the previous compact concept and defines the established visual language: dark navy background, mint audio and scores, amber coaching, pale blue secondary text, coral End control, crisp restrained pixel headings, normal readable body type, and Morgan's pixel-art identity. Preserve these. Keep all important text readable at normal mobile sizes; main controls have 44 px touch areas.

LEFT SCREEN — UPDATED LIVE SESSION:
- Slim header with the small theatrical-mask mark, “THE SIMULATOR”, and timer “03:42”.
- One compact scenario line: small “SALES” tag and “The adjacent opportunity”.
- RADICALLY SMALLER CLIENT AREA. Replace the large Morgan section with a single tappable client strip only about 70–80 logical pixels high. Tiny 40–48 px Morgan portrait at left, “Morgan” and “IT Director” in small readable type, a tiny mint speaking dot and compact mint/blue dual-channel audio spectrum. At the right show “Brief” and a chevron / expand icon so it clearly opens the brief modal. Keep the entire strip one compact unit. No giant MORGAN heading, no large character portrait, no descriptive paragraph.
- REMOVE the transcript preview entirely. No last spoken line, quotation or live caption anywhere on the main screen. Transcript remains accessible through its bottom control.
- REMOVE the permanent Live Hint section between client and objectives.
- Immediately show “OBJECTIVES” with “2/5 · Any order”. Five concise rows, all visible:
  open circle — “Understand the problem”
  open circle — “Find the business impact”
  mint checked — “Find the right stakeholder”
  mint checked — “Connect a relevant capability”
  open circle — “Earn a next step”
  Use subtle evidence chevrons and restrained thin separators.
- “YOUR SKILLS”, mint dot “Jev · live”, scale “0–4”.
  Preserve the two-column skill grid, seven readings, and slim horizontal bars:
  Credibility 3.2 | Confidence 2.8
  Listening 3.5 | Rapport 2.6
  Clarity 3.3 | Guidance 2.4
  Adaptability — | quiet text “Tap a skill for evidence”.
  The dash has an empty track. Do not invent an overall score.
- One DISMISSIBLE COACHING TOAST FLOATS JUST ABOVE THE BOTTOM CALL DOCK. It is a small dark raised card with a subtle amber edge, lightbulb icon, small “LIVE HINT” label, and a clear × close control at upper right. Text: “Ask how the document problems affect Priya’s team.”
  This must visibly read as a floating transient toast, not a permanent section. It stays above the dock and does not cover skill values or objective rows. Only one toast, no stack, no timeout progress bar.
- Pinned bottom dock with microphone “Mic on”, “Transcript”, speaker icon, an amber lightbulb icon for reopening the hint, and coral/red “End”. Compact visual footprint, generous touch targets, home-indicator safe space.
- All five objectives and all seven skills are visible with the toast and controls within one phone viewport. Use the space freed by the client shrinkage and caption removal to keep readable typography and a little breathing room, not to make the portrait larger.

RIGHT SCREEN — TAPPING THE CLIENT STRIP OPENS THE BRIEF:
Show exactly the same main screen dimmed behind a nearly full-height mobile modal / bottom sheet. Small drag handle, header “SESSION BRIEF”, clear close ×. Strong readable dark navy modal surface with a fine teal edge. The brief can scroll inside its own body if necessary. The live session continues behind it; do not label it paused.
The modal shows ONLY the trainee-facing public information below, in an orderly easy-to-scan hierarchy:
1. CLIENT
   Small Morgan portrait; “Morgan”; “IT Director · Direct & challenging”.
   “Gets to the point. Respects a clear recommendation and a well-defended boundary.”
   A compact two-column trait summary using four tiny pips or numbers:
   Assertiveness 4/4 | Skepticism 3/4
   Guardedness 3/4 | Bargaining 4/4
   Risk aversion 3/4 | Relationship 1/4
2. SCENARIO
   “The adjacent opportunity”
   “An existing software client mentions SharePoint trouble. Find the real opportunity.”
   “Your role: Account consultant” and “10 minutes”.
3. YOUR LEAD
   “We’re already delivering a custom software project for this client. We think there may be a SharePoint opportunity too. Use this check-in to understand whether there’s a problem we can help with, and earn an appropriate next step.”
4. OUR CAPABILITIES
   “Custom software and modern applications on Azure”
   “SharePoint and workplace collaboration”
   “Adoption support and change management”
Use comfortable body text and section spacing inside the modal; a subtle internal scroll affordance is acceptable for the detailed brief. Keep CLIENT, SCENARIO and YOUR LEAD clearly visible. Do not show private client motives, secret budget, actor instructions, director cues or rubric answers. No identifying company names.

Prioritize a believable, polished, implementable mobile interface. The left screen must be significantly more compact above the objectives than the reference. Preserve the excellent contrasting colors, skill grid, all five objectives and seven scores. No inline transcript excerpt, no fixed hint section, no extra navigation, no oversized avatar, no arbitrary new features.
```
