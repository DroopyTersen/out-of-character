# Sam portraits

Sam has two distinct, approachable journalist portraits. Both retain the existing clients’ chunky pixel art, exaggerated head-to-body proportions and waist-up framing. They have quieter expressions, notebooks and different clothes, hair and poses. They do not need to look like gender-swapped twins.

- Male asset: `public/interview/sam-male.png`
- Female asset: `public/interview/sam-female.png`
- Method: built-in image generation with existing client sprites as style references.
- Male references: Morgan and Casey. Female references: Avery and Morgan.
- Both PNGs have transparent backgrounds.

Verified valid PNG alpha and all nine setup/live/summary previews at 1440, 390 and 320 px. Captures: `output/interview-ui/journalist-portraits/`. The preview used temporary in-memory local state; stored sessions were untouched.

## Male prompt

Use case: stylized-concept. Create a new MALE Sam interviewer sprite for this pixel-art game. Image 1 (Morgan) and image 2 (Casey) are STYLE REFERENCES ONLY. Keep their exact 8-bit game-character aesthetic: oversized expressive adult head, compact torso, waist-up crop, chunky pixel clusters, dark stepped outlines, limited color shading. Do not switch to realistic human proportions or smooth illustration.

Character: an approachable, seasoned journalist in his mid-40s. Short slightly untidy dark hair with a little gray at the temples, subtle stubble, modest round dark glasses, thoughtful kind eyes and a small relaxed closed-mouth smile. An ordinary interesting person who is listening carefully, with a hint of dry wit. Keep the face recognizably adult and grounded within the exaggerated game proportions. Casual olive jacket over a faded navy shirt, holding a small plain reporter's notebook and a pen loosely near his waist. Relaxed shoulders, understated listening pose. No hand on hip, sales-pitch gesture, giant grin, raised cartoon eyebrow, coiffed swoop of hair or cute mascot mannerisms.

Single centered character, same waist-up scale and crisp pixel treatment as the supplied client sprites, transparent background with real alpha, comfortable padding so hands and hair are fully visible. No lettering, logos, scenery, microphone, watermark or drop shadow. This is a fresh design; do not resemble the prior teal-shirt Sam or attempt to match a female counterpart.

## Female prompt

Use case: stylized-concept. Create a new FEMALE Sam interviewer sprite for this pixel-art game. Images 1 (Avery) and 2 (Morgan) are STYLE REFERENCES ONLY. Keep their exact 8-bit game-character aesthetic: oversized expressive adult head, compact torso, waist-up crop, chunky pixel clusters, dark stepped outlines, limited color shading. Do not switch to realistic human proportions or smooth illustration.

Character: an approachable, perceptive journalist in her early-40s. Warm medium-brown skin, shoulder-length dark curly hair tucked back on one side, small simple earrings, alert kind eyes and a subtle friendly closed-mouth smile. The expression says she is interested in your story and has a smart follow-up, without being stern or overly eager. Adult facial character within the game's exaggerated proportions. Soft plum cardigan over a cream top, a small plain notebook resting against her forearm with a pen held casually. Comfortable unposed posture and slight listening head tilt. No hand on hip, sales-pitch gesture, giant grin, eyebrow theatrics or cute mascot mannerisms.

Single centered character, same waist-up scale and crisp pixel treatment as the supplied client sprites, transparent background with real alpha, comfortable padding so hands and hair are fully visible. No lettering, logos, scenery, microphone, watermark or drop shadow. Design her independently; she should not be a gender-swapped twin or wear the same clothes as male Sam.
