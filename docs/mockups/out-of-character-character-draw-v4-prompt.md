# Out of Character: vertical character draw concept, version 4

September 18, 2026

Rejected composition. Superseded by the [version 5 restart](out-of-character-character-draw-v5-prompt.md); retained only as design history.

[Gameplay mockup](out-of-character-gameplay-v3.png) · [Game PRD](../solutioning/consultancy-party-game-prd.md) · [Previous draw concept](out-of-character-character-draw-v3-prompt.md)

![Out of Character vertical character draw concept](out-of-character-character-draw-v4.png)

A desktop exploration of a vertical reel inside one arcade cabinet. The selected sprite, name, and backstory share one continuous mint reveal frame, visually connecting the chosen character to its description. The scene and start action follow beneath them inside the same cabinet. The amber lever sits on the outer right edge.

The supplied sketch was loose inspiration for the vertical reel, rather than a layout to reproduce. The gameplay screen remained the visual style reference. Created with the built-in image generation tool; this is a static concept, not an implemented or verified animation.

## Layout and motion

- Only the sprite strip moves vertically inside the left reel viewport. Every sprite tile uses identical dimensions. Dim, cropped previews above and below the landing window communicate the reel direction.
- The mint reveal outline and landing markers are stationary overlays. The outline spans the landing window and fixed character-details area; it is not attached to an individual moving tile.
- Name and backstory sit beside the selected sprite in the same highlighted region. They appear only after landing and never cycle through passing characters.
- Reserve the reel, character-detail, scene, and action footprints before drawing. Loading, reveal, refresh, and error states replace content inside them without expanding the cabinet or moving the start action.
- During spinning, show **Choosing your character…** in the details area and **Setting the scene…** in the scene area. Fade in the chosen character's details after landing.
- Longer text wraps or scrolls inside its reserved area. Do not truncate the playable scene.
- Keep the action footprint fixed: **Spin for a character** initially, disabled **Spinning…** during the reel motion, then **Start your turn**, disabled until the generated scene is ready.
- The lever is a side-mounted control on the whole cabinet, separate from the reading sequence. The reading sequence is character reveal, scene, start.

## Runtime behavior retained

On spin, choose the random character immediately from the fixed match deck and start scene generation while the reel animates toward that predetermined result. Send the chosen character's stable ID, name, and backstory with the last 20 played scenes and their character IDs.

Generate 2–3 short sentences, roughly 25–50 words, establishing a concrete situation, a task, and a constraint or funny complication. Vary settings, audiences, objectives, stakes, and conflicts relative to played history. Use typical and funny situations for the chosen character without supplying dialogue or a script.

Hold an early scene result until landing. If generation takes longer, finish the reel normally and retain **Setting the scene…**. Enable starting only after landing and a valid scene are ready.

**New scene** keeps the selected character and requests another situation using played history plus the current scene as something to avoid. Disable repeated requests and starting while pending. On failure, keep the character selected and show **Couldn't create a scene. Try again.** with **Retry scene** in the reserved scene area. Only the current turn's current request may update it.

Starting freezes the scene, removes refresh controls, records that scene once in the browser's rolling history of the newest 20 played scenes, and starts microphone capture and the elapsed clock together. Retain that history across matches on the shared browser. Unshown results, failed requests, and replaced scenes do not count as played history. Scene text remains player guidance and is excluded from character-judging evidence.

For reduced motion, reveal the chosen sprite without translating the reel and retain the same generation and readiness flow.

## Mobile direction, deferred

This is a desktop candidate. A later mobile mockup should preserve the same visual connection between the landing sprite and its character details, followed by scene and start in a top-to-bottom reading sequence. Keep the right-side lever compact and provide a normal tap button as an equivalent draw action. Portrait spacing, readable text, touch targets, and overflow still need a dedicated mockup; desktop proportions are not verified for mobile.

## Exact generation prompt

```text
Use case: ui-mockup.
Create a NEW version 4 desktop character-draw screen for Out of Character.
Input image 1 (gameplay-v3): authoritative STYLE REFERENCE for the dark navy crisp pixel-art UI, original astronaut consultant identity, mint highlights, blue frames, typography and header.
Input image 2 (hand-drawn sketch): LOOSE COMPOSITION INSPIRATION ONLY for a vertical character reel. Do not copy its detached information box or left-mounted lever. It is not a finished design.
Primary goal: make the selected astronaut feel physically connected to his name and backstory while keeping those details stationary during spinning. A single unified arcade machine contains a vertical reel and character details side by side, with the scene below. Show a finished draw, ready to start. Landscape 16:9, straight-on flat game screenshot, no device or desk mockup, no annotations.

Exact style: same dark navy background and blue glow as gameplay reference, finely beveled cyan-blue frames, crisp pixel display titles, readable mixed-case text, charming detailed 8-bit sprites, restrained mint and amber. Preserve header small multicolor pixel logo + "OUT OF CHARACTER", divider + "CONSULTANCY EDITION". Right header small chip "CHARACTER DRAW".
Below header centered heading "CHOOSE YOUR CHARACTER", understated subtitle "The reel has spoken. Time to commit to the bit.".
Main content is ONE coherent spacious arcade cabinet UI occupying the centered majority of the screen. One outer blue beveled border wraps upper character reveal stage, lower scene area and bottom start action. No disconnected floating cards, no dashboard tile grid, no separate standalone description box.

UPPER STAGE / VERTICAL REEL:
Upper stage has a narrow VERTICAL sprite-only reel on its LEFT, roughly one quarter of width, and a calm stationary character-detail surface to its RIGHT, roughly three quarters. The reel visibly scrolls top to bottom: dim partially cropped previous character sprite ABOVE the selected sprite, and dim partially cropped next character sprite BELOW it, with navy fades at reel top and bottom. Do not arrange three characters horizontally. Above preview gray-haired glasses consultant with rolled chart. Below preview young glasses consultant with laptop. Ghost previews are just glimpses, NOT three fully visible stacked enormous cards.
The selected full astronaut sprite is centered in the vertical landing window: same office shirt red tie, trousers and boots, round space helmet and rolled diagram as gameplay reference. Sprite about 220 pixels tall in the final landscape mockup.
KEY VISUAL CONNECTION: A SINGLE continuous mint highlighted horizontal reveal frame spans from AROUND THE SELECTED SPRITE across to ENCLOSE its name and backstory on the right. The selected landing window and textual description are one connected wide mint region. NO GAP, NO SECOND DETACHED MINT BOX, NO duplicate astronaut name elsewhere, NO bright vertical divider isolating sprite from text. The vertical reel continues above and below this selected band on the left. The mint outline and text area are stationary; only the sprite strip inside its left clipped opening moves.
Within the right side of that unified highlighted reveal region: small mint "YOUR CHARACTER" label, large mint title "ARCHITECTURE ASTRONAUT" with tidy line break if necessary, then smaller readable blue-white backstory on two or three lines, EXACT:
"Fourteen services. One glorious diagram.
The checkout page is a presentation-layer concern."
Good breathing room around title, sprite and prose. Description should clearly belong to the chosen sprite beside it.
The amber lever is mounted to the FAR RIGHT EXTERIOR EDGE of the overall cabinet, lined up with the chosen character band, not sitting between sprite and character text and not on left. Steel-blue base and stem, round amber knob. Caption "SPIN COMPLETE" small and subdued. This is a physical control on the side of the cabinet rather than a step in a left-to-right flow. No directional flow arrows pointing to lever.

LOWER SCENE AREA:
Below upper reveal stage inside SAME blue cabinet, separate with a restrained horizontal blue rule and a slightly brighter navy fill. Broad prominent scene area with a pixel speech-bubble icon and white heading "YOUR SCENE", small blue outline circular refresh control "NEW SCENE" at upper right. Large readable mixed-case scene copy, bigger than character backstory, across about three lines:
"The office coffee machine is broken.
Pitch a fourteen-service platform to fix it.
Your manager wants coffee in five minutes."
Do not place character text beside scene inside competing detached panels. Scene follows unified character reveal from top to bottom.
Bottom of same cabinet, wide centered mint arcade button "START YOUR TURN" with dark text and small right arrow, with small muted hint "Take a breath. Your turn starts when you're ready."
Make the main cabinet fit below heading and above bottom screen margin, with right lever visible and no cropped labels. The visual read is vertical reel + connected character description, then scene, then start. This should feel like one complete arcade object, compact enough to plausibly adapt later to mobile; do NOT show a phone layout or montage today.
No timers, scores, meter, rankings, AI/LLM labels, coins, fruit, gambling metrics, excessive ornament, watermark or photoreal objects. Important: vertical sprite-only reel, static unified mint selection-and-description region, lever on outer right, scene prominent below.
```
