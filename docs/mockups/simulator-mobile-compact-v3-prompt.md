# Compact mobile simulator concept v3

Generated September 26, 2026 using the built-in image generation tool.

Output: [simulator-mobile-compact-v3.png](simulator-mobile-compact-v3.png)

Edit target: [compact mobile concept v2](simulator-mobile-compact-v2.png).

This design mockup refines the hint treatment. It does not change the running application.

## Design decisions

- Live hints appear as floating overlay notifications and reserve no space in the page layout.
- This concept places the toast over the client strip, leaving objectives, skills, and call controls visible.
- Showing or dismissing a hint must not move the content underneath.
- The close control dismisses the toast; the dock lightbulb reopens the current hint.
- Keep one hint visible at a time. It stays until dismissed; only a meaningfully new hint resurfaces afterward.
- Preserve the compact client strip, public session brief modal, and absence of a transcript preview from v2.
- The brief continues to hide all private actor information.

## Final prompt

```text
Edit this UI mockup with one focused change: the LIVE HINT must be an overlay notification, using ZERO layout space.

The supplied image is the edit target. Preserve its original nearly square landscape canvas, two equally sized mobile screens side by side, dark navy / mint pixel-art visual style, typography, all text, all client and scenario details, all objective and skill labels, all call controls and the right-hand Session Brief modal.

ONLY edit the LEFT live-session screen:
1. DELETE the in-flow LIVE HINT card currently between the skills and bottom controls. Delete that reserved row entirely.
2. Keep the compact client strip, 5 objectives, 7 skills and bottom dock. Use the freed height to tighten the entire screen to a normal phone viewport, rather than leaving a large unused region.
3. Add ONE compact floating toast OVER THE MIDDLE OF THE CLIENT STRIP, partly obscuring Morgan's audio waveforms and role. The portrait and both audio waveforms MUST visibly extend behind the toast and remain visible around its edges. The client strip must retain its original height and position. This intentional overlap is the crucial requirement. It is OK for the toast to temporarily cover client information.
4. The toast is only about 310 logical pixels wide and 70 logical pixels high, horizontally centered, with about 40 logical pixels exposed at each side. It has rounded corners, a raised dark blue surface, thin amber border, strong soft shadow, lightbulb icon, small LIVE HINT title, close ×, and exactly this message: “Ask how the document problems affect Priya’s team.”
5. No dimmed backdrop. No layout movement, no empty slot, no permanent Live Hint section. The toast is drawn ON TOP of the underlying client strip, like a native floating app notification. All five objectives and seven skills below remain visible and are not covered. The call dock lightbulb reopens the dismissed hint.
6. Keep the slim header above the toast unobstructed. No transcript preview.

RIGHT screen: preserve the entire original Session Brief modal with its accurate public client, scenario, lead and capability information.

Keep the original image's two-up composition and compact phone proportions. No giant margins around the screens. Flat crisp high-fidelity app screenshots. No phone hardware. Show the toast literally OCCLUDING parts of the existing client strip, not pushing anything down.
```
