# The Simulator — scrollable selection concept v3

This image explores larger scenario and client collections. Extra scenario names and the collection counts are illustrative design content, not additions to the agreed MVP scope.

The lead wording and retained artwork use anonymous company wording for the public repository.

## Interaction

- Scenario rows scroll vertically within their own list.
- Client portraits scroll horizontally; previous and next arrows move one card at a time. Trackpad or touch scrolling can use the same rail.
- Partially visible cards and small scrollbars signal more choices.
- Scrolling only browses. Selecting a card changes the selection.
- Section headings, the selected scenario lead, selected client details, and the Start Simulation button remain in place.
- There is no full-page pagination or full-page scroll at the illustrated desktop size.

## Output

`simulator-selection-scroll-v3.png`

## Exact prompt

Built-in imagegen edit. Input image: `simulator-setup-v2.png`.

Use case: precise-object-edit.
Asset type: high fidelity desktop app selection mockup.
Input image 1 is the edit target: the latest setup screen for The Simulator. Revise its two choice areas so the user can browse larger collections of scenarios and clients, while retaining the exact design language and most of the composition. Return one full-size flat 16:9 UI screenshot, not a presentation board, explanatory diagram, collage, or device frame.

Keep the existing navy and mint palette, subtle steel-blue borders, crisp pixel headings and technical sans-serif body text. Preserve the logo and OUT OF CHARACTER wordmark top left, with THE SIMULATOR title in mint at top right. No PRIVATE PRACTICE label, no lock icon, no privacy footer, and no duplicate simulator title beneath the wordmark. Preserve CHOOSE YOUR SIMULATION, its subtitle, the two major panels, and the mint START SIMULATION button beneath them.

LEFT PANEL — scenario collection:
Keep the heading THE SCENARIO pinned at the top, with a small muted "6 scenarios" count.
Replace the two oversized scenario cards with a compact vertically scrollable stack inside a fixed-height viewport in the UPPER part of this panel.
Show three complete compact rows and a clipped portion of a fourth row at the bottom, making overflow visibly intentional. Add a narrow blue vertical scrollbar along the inside right edge of ONLY this list, with its thumb near the top. A subtle bottom fade may reinforce the clipped next row. The entire app page does not scroll.
First row is selected, mint outline and checked selection indicator, small SALES tag, title "The SharePoint opportunity".
Second row unselected, small CONSULTANCY tag, title "The scope conversation".
Third row unselected, small SALES tag, title "The skeptical buyer".
Fourth row only partially visible at the lower boundary, small CONSULTANCY tag, title "The shifting deadline".
Use small pixel icons and readable names. These are distinct rows in a browsing list, not a workflow or ordered steps. Do not show long descriptions in this list.
Below this scrolling list, a fixed divider followed by the unchanged YOUR LEAD section and exact readable text:
"We're already delivering a custom software project for this client. There may be a SharePoint opportunity too. Find out whether there's a problem we can help with."
Preserve the "5 objectives · Live coaching" footer at the bottom of the panel. The lead remains visible and does not scroll with the scenario choices.

RIGHT PANEL — client collection:
Keep YOUR CLIENT pinned at the top. At the top right of this panel show a small "8 clients" count and two compact square previous/next arrow buttons. Previous is subtly disabled at the start; next is active blue outlined. Use real left and right arrow glyphs.
Below, a horizontally scrollable portrait rail with uniform card sizes. Show Morgan, Avery, and Casey as three complete cards, followed by a visible clipped sliver of a FOURTH client card at the right boundary. This peek must make it obvious that more client portraits exist offscreen. Fit three full cards plus that peek by modestly narrowing each tile compared with the source. Preserve the original Morgan, Avery and Casey pixel artwork and identities.
Morgan selected with mint outline and check; caption MORGAN / DIRECT.
Avery unselected; caption AVERY / RESERVED.
Casey unselected; caption CASEY / SKEPTICAL.
The partly visible fourth portrait can be a fictional office professional called Jordan, only a small edge of the next tile is shown.
A discreet thin horizontal scrollbar below the portrait rail makes its scroll direction unambiguous. No pagination dots or page numbers. No scrollbars on the selected client's details.
Below the rail, keep a fixed divider and the selected Morgan detail block: larger Morgan sprite, mint MORGAN heading, IT Director, Direct & challenging, Short on time. Values a clear point of view.
Preserve "Same scenario. Different conversation." along the bottom of the right panel.

Composition and behavior to communicate visually:
The scenario list scrolls vertically within the left panel. The client rail scrolls horizontally within the right panel; its arrow buttons advance one portrait card at a time, not the entire page. Scrolling browses the choices; selection changes only when a choice is clicked, so selected Morgan and the SharePoint lead stay visible in their fixed detail areas. The big start button stays in place. Convey this with natural UI affordances and partial cards, not with explanatory text or added annotations. Fit everything on the desktop screenshot with readable typography, balanced spacing, and no cropped main panel, button, or selected detail.
Only revise the browsing controls and spacing necessary for them; do not redesign the app or add search, filters, settings, extra actions, or tutorial overlays.
