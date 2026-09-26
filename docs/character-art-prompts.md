# Character artwork generation prompts

All 42 PNG assets are independently generated with the built-in `image_gen.imagegen` tool, one call per distinct character. No CLI fallback, spritesheet cuts or code-rendered placeholders. Approved style references: character-draw-v6-revealed and gameplay-v3. Files are copied unchanged from the tool's generated_images output, preserving requested alpha transparency.

## Shared prompt

```
Use case: stylized-concept
Asset type: single independent PNG character sprite for the Out of Character consultancy party game.
Style: authentic chunky crisp 8-bit/16-bit arcade pixel art, blocky edges, dark navy outlines, restrained two-tone shading, expressive oversized head and small body like a classic character-select sprite. Square 1024x1024 canvas, one fullbody figure centered, boots baseline at 86%, character occupies 72% of height. Palette predominantly navy, mint cyan, steel blue, offwhite, amber with natural skin tones. One distinctive role-related prop. Actual transparent alpha background, no colored backdrop, no floor, no floating decorations. No text, labels, logos, letters, UI, frame, photorealism, blur or gradients. Satirical office-role depiction, warm mischievous expression, not mockery of identity.
Subject: <character-specific subject below>
```

## Exact subject prompts

### architecture-astronaut

Output: `public/characters/architecture-astronaut.png`

A consultancy Architecture Astronaut: white astronaut helmet with dark blue glass visor, office white shirt with orange necktie, dark navy trousers and amber shoes, compact suit tank visible behind shoulder, holding one rolled white blueprint. Threequarter front view, boldly readable silhouette.

### shiny-stack-evangelist

Output: `public/characters/shiny-stack-evangelist.png`

A consultancy Shiny Stack Evangelist: young adult brown-skinned man with dark curly hair and large square glasses, mint hoodie over white office shirt and dark trousers, amber sneakers, excited persuasive grin, holding one open silver laptop on arm, other arm sweeping upward as if pitching a shiny framework. Threequarter front view.

### graybeard

Output: `public/characters/graybeard.png`

An older light-skinned engineer with gray beard, square glasses, rumpled navy cardigan and white shirt, amber necktie, holding one dusty beige desktop keyboard under an arm. Wry raised eyebrow and authoritative free-hand gesture.

### brownfield-lifer

Output: `public/characters/brownfield-lifer.png`

Replace the woman with an older middle-aged white man, about 58, receding gray hair, tired creased face, clean-shaven, stubborn unimpressed expression. Keep the mint utility jacket, navy work trousers, amber boots and battered beige terminal monitor with tiny green screen. Same role pose and prop.

### refactor-missionary

Output: `public/characters/refactor-missionary.png`

A light-skinned man with auburn hair and beard, white shirt, mint vest and navy trousers, holding one oversized closed navy code manual like a sacred text. Passionate raised finger and resolute grin.

### millisecond-martyr

Output: `public/characters/millisecond-martyr.png`

An East Asian woman with a black ponytail, navy track jacket with mint stripe, dark trousers, amber shoes, proudly holding one oversized silver stopwatch beside her face. Dramatic triumphant stance.

### css-stunt-pilot

Output: `public/characters/css-stunt-pilot.png`

A Black woman with curly hair under a navy aviator cap and goggles, mint pilot jacket, navy trousers and amber boots, balancing one crooked miniature browser-window panel on a hand. Fearless playful grin.

### platform-hall-monitor

Output: `public/characters/platform-hall-monitor.png`

Image 1 supplies the person's identity: reuse that brown-skinned middle-aged woman with short swept dark hair and small gold earrings. Image 2 supplies only clipboard and stop-hand pose. Dress her as a nerdy school hall monitor granted petty authority: oversized square glasses, navy knitted sweater vest over mint collared blouse, high-waisted navy slacks, amber loafers, small blank hall-pass lanyard. Hold clipboard with simple colored checkboxes and raise a finger to demand compliance. Smug superior chin-raised expression. Absolutely no police/security uniform, epaulettes, badge, radio, tactical belt or cop styling. No terminal monitor.

### azure-icon-collagist

Output: `public/characters/azure-icon-collagist.png`

A white woman with short blue-black bob, mint blazer over white top, navy skirt and amber shoes, holding one large blue presentation board covered only in abstract cloud/cube symbols and connecting lines. Proud artistic flourish.

### certification-peacock

Output: `public/characters/certification-peacock.png`

A Latino man with dark pompadour, navy suit, amber tie and shoes, holding one comically wide fan of colorful plain badge-shaped medallions behind him like peacock plumage. Self-satisfied smile; badges have no letters.

### sharepoint-civilian

Output: `public/characters/sharepoint-civilian.png`

A middle-aged Black woman with round glasses and mint cardigan, navy trousers, amber flats, hugging one tall clipboard with a plain grid of colored list boxes. Calm practical expression.

### low-code-freedom-fighter

Output: `public/characters/low-code-freedom-fighter.png`

A tan-skinned woman with dark braided hair, mint headband and navy jacket, dark trousers and amber boots, holding one tangled flowchart board with many abstract colored boxes and arrows. Defiant smile tinged with panic.

### 30000-footer

Output: `public/characters/30000-footer.png`

A light-skinned woman with blonde bun, navy business suit, mint scarf and amber shoes, holding one telescope tilted high upward. Lofty chin-raised visionary pose.

### backlog-stenographer

Output: `public/characters/backlog-stenographer.png`

A brown-skinned man with short hair and round glasses, mint shirt with rolled sleeves, navy trousers and amber shoes, holding one very long curled scroll covered in blank colored square tickets. Busy diligent expression.

### rabbit-hole-qa

Output: `public/characters/rabbit-hole-qa.png`

An East Asian woman with short tousled hair, navy detective coat and mint shirt, amber boots, peering through one oversized magnifying glass with a surprised discovery expression. No rabbit animal, only role metaphor.

### scrum-cop

Output: `public/characters/scrum-cop.png`

Image 1 supplies the woman's face, shoulder-length hair silhouette and small gold hoop earrings. Make her a middle-aged blonde woman, about 48, light skin, shoulder-length blonde bob. Image 2 supplies the ceremony-enforcing pose and whistle prop. Wear navy officer-like office shirt, mint lanyard, navy trousers and amber shoes. Hold a silver whistle on mint cord, free hand raised in firm stop gesture. Stern officious expression. No tablet, no green status circle, no mustache.

### checked-out-pm

Output: `public/characters/checked-out-pm.png`

Image 1 supplies the man's identity: middle-aged white man with swept brown hair and large dark brown mustache. Image 2 supplies the outfit, slouch and tablet prop: rumpled mint blazer over offwhite unbuttoned collar shirt, navy trousers, amber loafers. Half-lidded disengaged eyes and vacant reassuring half-smile. Hold one small tablet showing a single bright green status circle without letters, other hand casually in pocket. No uniform, no epaulettes, no whistle or stop-hand.

### estimate-barber

Output: `public/characters/estimate-barber.png`

A Black man with close-cropped hair, mint barber apron over navy office clothes and amber shoes, wielding one comically large pair of gold scissors poised to trim a blank timeline ribbon attached to the scissors. Persuasive grin.

### pre-sales-illusionist

Output: `public/characters/pre-sales-illusionist.png`

A brown-skinned woman with wavy hair, navy magician tailcoat and mint waistcoat, amber shoes, holding one top hat from which an abstract mint cloud emerges. Smooth theatrical sales smile.

### staffing-magician

Output: `public/characters/staffing-magician.png`

A light-skinned man with red hair, navy blazer and mint shirt, amber shoes, presenting one empty gold picture frame with a confident magician flourish. Charming exaggerated smile.

### code-coverage-tsa

Output: `public/characters/code-coverage-tsa.png`

A Black woman with neat short hair, navy checkpoint-officer-style uniform and mint trim, amber shoes, holding one handheld security scanner. Proud official stance, narrow skeptical eyes.

### ux-safari-guide

Output: `public/characters/ux-safari-guide.png`

A South Asian woman with long dark hair in ponytail, mint safari shirt, navy trousers, amber boots, holding one unfurled journey map with abstract looping dotted paths. Eager expedition-guide expression.

### accessibility-scold

Output: `public/characters/accessibility-scold.png`

A light-skinned woman with short purple-black hair, mint blazer, navy trousers and amber boots, holding one large clipboard with a bold generic eye-and-check symbol. Firm raised finger, determined serious expression.

### reorg-bard

Output: `public/characters/reorg-bard.png`

A brown-skinned older man with gray curly hair, navy blazer and mint scarf, amber shoes, holding one lute shaped subtly like an office organization chart. Nostalgic storytelling smile.

### utilization-hawk

Output: `public/characters/utilization-hawk.png`

An East Asian woman with sleek short hair, sharp navy suit, mint tie and amber shoes, holding one binoculars at chest height. Alert intense gaze and commanding forward stance.

### jpeg-sponsor

Output: `public/characters/jpeg-sponsor.png`

A light-skinned middle-aged man with sandy hair, navy suit and mint tie, amber shoes, standing behind and holding one ornate gold portrait frame around his own face. Stately absent-minded smile.

### manager-still-in-the-pr

Output: `public/characters/manager-still-in-the-pr.png`

A Black man with dark beard and glasses, mint office sweater over white shirt, navy trousers, amber shoes, hugging one open silver laptop possessively. Protective suspicious sideways gaze.

### fake-mentor

Output: `public/characters/fake-mentor.png`

A light-skinned woman with auburn wavy hair, navy blazer over mint blouse, amber shoes, holding one coffee cup while gesturing at herself with free hand. Smug chatty expression.

### desperately-available

Output: `public/characters/desperately-available.png`

A South Asian man with dark hair and glasses, mint shirt, oversized navy tie, dark trousers, amber shoes, holding one blank amber placard above his head. Wide hopeful strained smile.

### rate-card-doormat

Output: `public/characters/rate-card-doormat.png`

A brown-skinned woman with short curly hair, navy business suit, mint scarf and amber shoes, holding one rolled blank price-sheet scroll, eager accommodating bow with nervous smile.

### out-of-scope-pm

Output: `public/characters/out-of-scope-pm.png`

An East Asian man with neat black hair, mint shirt and navy tie, navy trousers, amber shoes, holding one oversized navy contract folder with gold clasp. Firm palm-out refusal gesture.

### hit-and-run-architect

Output: `public/characters/hit-and-run-architect.png`

A light-skinned woman with dark short hair, navy blazer over mint top, amber running shoes, holding one rolled white blueprint while posed mid-step as if already leaving. Casual overconfident grin.

### entra-jenga-player

Output: `public/characters/entra-jenga-player.png`

A tan-skinned man with dark curly hair, mint office shirt and navy trousers, amber shoes, balancing one precarious tall tower of blue and gold rectangular blocks in both hands. Worried focused expression.

### laptop-jailer

Output: `public/characters/laptop-jailer.png`

A Black woman with cropped hair, navy uniform-like blazer with mint accents, amber boots, holding one silver laptop wrapped in a simple gold padlock chain. Strict unimpressed expression.

### teams-evangelist

Output: `public/characters/teams-evangelist.png`

An East Asian man with dark side-part hair, mint hoodie over navy trousers, amber shoes, holding one purple megaphone with a generic white speech-bubble symbol. Exuberant preaching gesture.

### ignite-tourist

Output: `public/characters/ignite-tourist.png`

A brown-skinned man with black hair, mint conference jacket, navy trousers, amber shoes, holding one oversized blank blue conference brochure. Amazed starry-eyed expression and raised free hand.

### shadow-it-founder

Output: `public/characters/shadow-it-founder.png`

A Black woman with braided bun, mint hoodie, navy trousers, amber sneakers, guarding one small silver laptop under her arm with sly mischievous grin. Plain laptop screen has abstract colored form fields only.

### security-no-show

Output: `public/characters/security-no-show.png`

An East Asian woman with short hair and navy sunglasses, navy blazer, mint shirt, amber boots, holding one oversized red stamp with no lettering. Stern late-arrival sweeping pose.

### magic-only-buyer

Output: `public/characters/magic-only-buyer.png`

A light-skinned man with blonde hair, navy business suit and mint tie, amber shoes, holding one sparkling gold magician wand. Delighted demanding expression; sparks are small pixel shapes close to wand.

### mute-button-salesman

Output: `public/characters/mute-button-salesman.png`

A tan-skinned man with dark beard, navy blazer, mint shirt and amber shoes, holding one microphone with a red crossed-out generic symbol. Apologetic half-shrug and winning smile.

### reply-all-disaster-artist

Output: `public/characters/reply-all-disaster-artist.png`

Replace the woman with a slovenly middle-aged white man, messy thinning brown hair, scruffy stubble, rumpled untucked mint office shirt with uneven collar, loosened navy tie, baggy navy trousers, scuffed amber shoes. Slouching paunchy silhouette, sheepish oblivious grin. Keep the giant white email envelope with red-orange pixel flames attached, readable big prop. No ponytail or earrings.

### fake-agile-dad

Output: `public/characters/fake-agile-dad.png`

A light-skinned middle-aged man with gray-streaked moustache, mint polo shirt tucked into navy trousers, amber shoes, holding one rolled navy project timeline chart like a baton, chart has colored bars without letters. Authoritative dad-like grin.

## Built-in output provenance

Generation date: 2026-09-18. Each row maps a separate built-in call output to its unchanged workspace PNG. The tool chose 1254 × 1254 RGBA output despite a requested square 1024 canvas.

The original 44-image set was verified on September 18. Five sprites were subsequently revised with built-in imagegen using the existing sprites as references, and Excel Warlord and Lakehouse Tour Guide were removed. All 42 current PNGs decode as 1254 × 1254 RGBA with alpha extrema 0–255 and distinct SHA-256 hashes. Revised files are copied unchanged from the tool outputs; no post-generation image editing.

| Asset ID | Original tool output |
| --- | --- |
| architecture-astronaut | `~/.codex/generated_images/01a0b5e3-7ab9-7c53-af18-03cc91230f37/exec-6c90942d-433a-4027-b483-c59bc6ac4881.png` |
| shiny-stack-evangelist | `~/.codex/generated_images/01a0b5e3-7ab9-7c53-af18-03cc91230f37/exec-19076a48-da28-46eb-87c5-57c64872c1af.png` |
| graybeard | `~/.codex/generated_images/01a0b5e3-7ab9-7c53-af18-03cc91230f37/exec-bd74ef1e-3fe7-4fd0-ab07-743478e7aeeb.png` |
| brownfield-lifer | `~/.codex/generated_images/01a0b673-81ae-79a0-8f60-a8aa355c8622/exec-008a41a7-e3bf-4e4b-bdf1-a73b98f16cc6.png` |
| refactor-missionary | `~/.codex/generated_images/01a0b5e3-7ab9-7c53-af18-03cc91230f37/exec-085bee57-49b4-479b-9ac3-8459054117e0.png` |
| millisecond-martyr | `~/.codex/generated_images/01a0b5e3-7ab9-7c53-af18-03cc91230f37/exec-eb67b50a-5aea-433d-9acd-2397195b0236.png` |
| css-stunt-pilot | `~/.codex/generated_images/01a0b5e3-7ab9-7c53-af18-03cc91230f37/exec-29b3fb8a-ee09-468c-bafe-2e7ecc6c26b5.png` |
| platform-hall-monitor | `~/.codex/generated_images/01a0b673-81ae-79a0-8f60-a8aa355c8622/exec-0b6da2bc-ca08-481c-bdee-9f8c17dd346a.png` |
| azure-icon-collagist | `~/.codex/generated_images/01a0b5e3-7ab9-7c53-af18-03cc91230f37/exec-2d1e0404-5c20-4d97-8db6-292f2219b1a2.png` |
| certification-peacock | `~/.codex/generated_images/01a0b5e3-7ab9-7c53-af18-03cc91230f37/exec-d67f28a4-84a9-4fb6-9b7e-07e96c40cf66.png` |
| sharepoint-civilian | `~/.codex/generated_images/01a0b5e3-7ab9-7c53-af18-03cc91230f37/exec-3c73347b-7335-4fcf-ac05-0e21a8e6c3da.png` |
| low-code-freedom-fighter | `~/.codex/generated_images/01a0b5e3-7ab9-7c53-af18-03cc91230f37/exec-36adb147-cdf9-4c5a-806a-17261571cc0f.png` |
| 30000-footer | `~/.codex/generated_images/01a0b5e3-7ab9-7c53-af18-03cc91230f37/exec-1c05a826-92e0-4f6d-94fa-c2a39a4d79ad.png` |
| backlog-stenographer | `~/.codex/generated_images/01a0b5e3-7ab9-7c53-af18-03cc91230f37/exec-a45ff47e-a1e9-462f-b063-506e47b857ff.png` |
| rabbit-hole-qa | `~/.codex/generated_images/01a0b5e3-7ab9-7c53-af18-03cc91230f37/exec-e018299c-d2bb-4c9f-a249-55bc16ee3aa8.png` |
| scrum-cop | `~/.codex/generated_images/01a0b673-81ae-79a0-8f60-a8aa355c8622/exec-d6585a47-05e6-41aa-92f6-31331f99c23d.png` |
| checked-out-pm | `~/.codex/generated_images/01a0b673-81ae-79a0-8f60-a8aa355c8622/exec-766f96ae-4c93-4a1f-96e4-1d0867b2c738.png` |
| estimate-barber | `~/.codex/generated_images/01a0b5e3-7ab9-7c53-af18-03cc91230f37/exec-6cdf1847-11d2-40ec-9aa2-238b6cb3d6e6.png` |
| pre-sales-illusionist | `~/.codex/generated_images/01a0b5e3-7ab9-7c53-af18-03cc91230f37/exec-6c268b1c-1637-4438-88a7-679c0fe57f8f.png` |
| staffing-magician | `~/.codex/generated_images/01a0b5e3-7ab9-7c53-af18-03cc91230f37/exec-e80b4a51-f553-4b39-8a4b-bda2c24227e6.png` |
| code-coverage-tsa | `~/.codex/generated_images/01a0b5e3-7ab9-7c53-af18-03cc91230f37/exec-05165666-1921-410d-b6a7-7a8667542a3d.png` |
| ux-safari-guide | `~/.codex/generated_images/01a0b5e3-7ab9-7c53-af18-03cc91230f37/exec-8cc56a37-c83e-4483-a22e-1fc8817dd07a.png` |
| accessibility-scold | `~/.codex/generated_images/01a0b5e3-7ab9-7c53-af18-03cc91230f37/exec-580a3672-7653-4e3e-bbdc-54e8baf952cd.png` |
| reorg-bard | `~/.codex/generated_images/01a0b5e3-7ab9-7c53-af18-03cc91230f37/exec-5ffc59ff-7c7a-4a19-a4e7-05913bc544a3.png` |
| utilization-hawk | `~/.codex/generated_images/01a0b5e3-7ab9-7c53-af18-03cc91230f37/exec-dfe6302c-7fbb-4217-bd11-f92b9428767b.png` |
| jpeg-sponsor | `~/.codex/generated_images/01a0b5e3-7ab9-7c53-af18-03cc91230f37/exec-2877f9b9-ac16-4e73-bf0c-c49fcf8fa18a.png` |
| manager-still-in-the-pr | `~/.codex/generated_images/01a0b5e3-7ab9-7c53-af18-03cc91230f37/exec-49b838fc-c021-4f8d-a652-28d1101a79fa.png` |
| fake-mentor | `~/.codex/generated_images/01a0b5e3-7ab9-7c53-af18-03cc91230f37/exec-256ab936-f0f5-4547-ba39-9740975b8eab.png` |
| desperately-available | `~/.codex/generated_images/01a0b5e3-7ab9-7c53-af18-03cc91230f37/exec-d3206b92-24cf-417a-b5b1-827992ccfbb3.png` |
| rate-card-doormat | `~/.codex/generated_images/01a0b5e3-7ab9-7c53-af18-03cc91230f37/exec-b8c49701-55d4-413e-a3e3-240dbef4c485.png` |
| out-of-scope-pm | `~/.codex/generated_images/01a0b5e3-7ab9-7c53-af18-03cc91230f37/exec-8e787c3c-4fca-43d3-960d-fd8cf1d0e75a.png` |
| hit-and-run-architect | `~/.codex/generated_images/01a0b5e3-7ab9-7c53-af18-03cc91230f37/exec-d4ece97f-c67c-4cb5-86ae-d6d3dd011b4c.png` |
| entra-jenga-player | `~/.codex/generated_images/01a0b5e3-7ab9-7c53-af18-03cc91230f37/exec-5957cbb7-fbc5-47e7-b960-00c5f64e256a.png` |
| laptop-jailer | `~/.codex/generated_images/01a0b5e3-7ab9-7c53-af18-03cc91230f37/exec-6d7a742b-f5a9-4272-9e9f-1871a3afa5d1.png` |
| teams-evangelist | `~/.codex/generated_images/01a0b5e3-7ab9-7c53-af18-03cc91230f37/exec-c6de4af0-c430-4d81-9bb5-6e78fa3fc5de.png` |
| ignite-tourist | `~/.codex/generated_images/01a0b5e3-7ab9-7c53-af18-03cc91230f37/exec-6fb8c0eb-8797-4228-9afe-037d06d669f4.png` |
| shadow-it-founder | `~/.codex/generated_images/01a0b5e3-7ab9-7c53-af18-03cc91230f37/exec-1541ee4b-bfe7-40d1-a23f-73f62a8024e5.png` |
| security-no-show | `~/.codex/generated_images/01a0b5e3-7ab9-7c53-af18-03cc91230f37/exec-da3c2600-f37a-4679-b32b-60790242b0db.png` |
| magic-only-buyer | `~/.codex/generated_images/01a0b5e3-7ab9-7c53-af18-03cc91230f37/exec-b44b6a9e-d3fc-4c96-87bb-c3fde74c0efa.png` |
| mute-button-salesman | `~/.codex/generated_images/01a0b5e3-7ab9-7c53-af18-03cc91230f37/exec-c1a67c65-86c1-4a6b-9d9c-efb44602c59b.png` |
| reply-all-disaster-artist | `~/.codex/generated_images/01a0b673-81ae-79a0-8f60-a8aa355c8622/exec-0bd964fd-ad7c-406c-9f15-b1e9a39c9ec5.png` |
| fake-agile-dad | `~/.codex/generated_images/01a0b5e3-7ab9-7c53-af18-03cc91230f37/exec-841a4831-3c4e-4934-ba0f-cda12e8ec20a.png` |


## September 18 sprite revisions

The five revised subjects above were generated with this edit prompt, using the listed reference PNGs in order:

```
Edit target/reference sprites for the Out of Character consultancy game. Create ONE independent full-body sprite, actual transparent alpha background, square canvas. Preserve the reference's authentic chunky crisp 8-bit/16-bit arcade pixel art, dark navy outlines, restrained block shading, oversized expressive head and small body, navy/mint/amber palette, feet fully visible, comparable margins and visual scale. No text, labels, logos, UI, frame, floor, gradient or photorealism. Subject: <exact revised subject above>
```

- `brownfield-lifer` references: `brownfield-lifer.png`
- `platform-hall-monitor` references: `brownfield-lifer.png`, `platform-hall-monitor.png`
- `scrum-cop` references: `checked-out-pm.png`, `scrum-cop.png`
- `checked-out-pm` references: `scrum-cop.png`, `checked-out-pm.png`
- `reply-all-disaster-artist` references: `reply-all-disaster-artist.png`
