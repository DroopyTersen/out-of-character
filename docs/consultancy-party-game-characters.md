# Out of Character: character seed library

Draft 0.1 · September 17, 2026 · Character tuning deferred

## How to use this document

This is the content companion to the [game PRD](solutioning/consultancy-party-game-prd.md). The primary pack contains all 100 consultancy characters from the supplied roast-style text. An appendix preserves the 60 general party characters discussed before the consultancy pivot as an optional pack.

The supplied consultancy names and backstories are preserved as draft copy, including their sharper tone and multiple-sentence descriptions. Introductory and closing commentary from the paste is omitted. Entries 1–48 replace the earlier consultancy draft; earlier names are recorded as aliases where they changed, rather than becoming duplicate game judgments. The first 24 general backstories expand the original short hooks into full sentences, while the next 36 retain their previously discussed sentences.

Stable IDs are seed identifiers and remain unchanged when names or copy change. All entries are draft. General characters are outside the default consultancy deck. Backstories are player-facing source material; concise model-facing definitions, exclusions, contrasts, and known performance examples can be added during later tuning. This document is not yet a validated Jev taxonomy.

## Proposed seed fields

| Field | Meaning |
| --- | --- |
| `id` | Stable pack-prefixed character identifier |
| `pack` | `consultancy` or `general` |
| `name` | Display name |
| `backstory` | Draft descriptive copy below |
| `aliases` | Earlier name, when applicable; not additional character judgments |
| `category` | Group heading for browsing |
| `status` | `draft` for every entry |

An application's editable catalog can use these fields later. Selecting a match deck does not enable every library entry automatically; freeze its membership and judging definitions for the entire match. The updated game uses one independent Noul judgment per character, so several characters can match strongly or all can match poorly; there is no extra no-clear-character Choice option. Displaying only high matches does not remove the other judged characters from data.

## Pack A: Consultancy — 100 characters

### Technology, delivery, and consultancy

#### cons-001 · The Shiny Stack Evangelist

Found a framework in a YouTube thumbnail at lunch. By 3pm they have a deck explaining why the app that *works* is an embarrassment they personally can no longer be associated with.

#### cons-002 · The Déjà Vu Architect

They have seen your “modern” design before. They built it in 1998, it sucked then, it sucks now, and they will uncork that story the second you say “event-driven” like you invented weather.

Earlier name: **The Graybeard Oracle**.

#### cons-003 · The .NET Framework Homesteader

4.7.2. Production. Users are quiet. Your upgrade pitch is a home invasion with a Microsoft blog post. They will die on this hill and the hill is a Windows Server that still has a Christmas screensaver.

#### cons-004 · The Ticket-Queue Homebody

They found God in incident 44912. “Greenfield” sounds like a cult. They will not join your transformative journey. They will close tickets until the heat death of the universe and they will be the only sane person at the funeral.

Earlier name: **The Support Queue Comfort Seeker**.

#### cons-005 · The Refactor Missionary

You asked them to change “Submit” to “Send.” They opened the file, saw the sins of the fathers, and now the ticket is a religious war. The label will ship in Q4, assuming the rewrite finds Jesus.

#### cons-006 · The Architecture Astronaut

Fourteen services. A service bus. A diagram that got a little clap. The page where the customer gives you money does not exist. They call that “a presentation-layer concern,” which is Latin for *I don’t do screens*.

#### cons-007 · The Design Pattern Hoarder

A null check is not a null check. It is a FactoryFactory, a strategy, an interface for the strategy, and a brown-bag titled “Why `new` Is How Rome Fell.” The bug is one line. The PR is a novella. They are the villain.

Earlier name: **The Design Pattern Collector**.

#### cons-008 · The Millisecond Martyr

12ms to 8ms. Nobody asked. Nobody was waiting. They would like the roadmap paused so the room can sit in silence and feel what they have done. Features are for peasants.

Earlier name: **The Performance Bloodhound**.

#### cons-009 · The Framework Holy War

They can rebuild it in their stack by Friday. Today is Thursday, so instead they will hold the meeting hostage explaining how the client’s framework is a crime against the unborn. The client is on the call. They do not care.

Earlier name: **The Front-End Framework Partisan**.

#### cons-010 · The CSS Cryptid

They fixed the layout. The layout is now sentient and loyal only to them. Touch one property and a horizontal scrollbar crawls out of hell. They will not document it. Documentation is how the magic dies.

Earlier name: **The CSS Sorcerer**.

#### cons-011 · The Design System TSA

You wanted a slightly rounder button. Please remove your belt, your shoes, and your will to live. There will be a tribunal. The tribunal has a Figma token and a God complex.

Earlier name: **The Design System Customs Officer**.

#### cons-012 · The API That Won’t Parent

The contract is “clean.” The user has to click seventeen times and download a CSV to do a thing a toddler could do. That’s not a backend problem. That’s you being needy.

Earlier name: **The Back-End Contract Enforcer**.

#### cons-013 · The Production Database Bouncer

This database has outlived three CIOs and a merger. Your SELECT is a stranger in a hoodie. State your business, wait in the lobby, and if you even *think* about a table scan they will smell it from home.

Earlier name: **The Database Gatekeeper**.

#### cons-014 · The Full-Stack Hostage

They said yes. To all of it. UI, API, database, auth, pipelines, the thing in Azure nobody named. They are now the bus factor, the password vault, and the reason the team cannot take a dump without Slack. Vacation is a rumor they tell new hires.

Earlier name: **The Full-Stack Volunteer**.

#### cons-015 · The Azure Icon Collagist

The slide is gorgeous. Functions, Key Vault, a little Private Endpoint for spice. What does the app do? They don’t know. They never knew. They are here to win PowerPoint.

Earlier name: **The Cloud Diagram Monet**.

#### cons-016 · The Certification Peacock

Their intro is longer than the meeting. AZ-this, SC-that, a badge that means they passed a multiple-choice test on a Sunday. Ask what they’d actually build and they start sweating under the acronyms.

Earlier name: **The Certification Completionist**.

#### cons-017 · The Serverless Inquisition

A process ran for 31 seconds. They have called it an architectural sin. It is now eleven Functions, a queue, a timer, and a 2 a.m. page that belongs to you, not them. Purity is easy when you’re not on the bridge.

Earlier name: **The Serverless Purist**.

#### cons-018 · The Kubernetes For Seven People

Seven users. Two of them show up at quarter-end like raccoons. They want a cluster, a mesh, GitOps, and a platform team. The app is a form. They are building NASA around a toaster.

Earlier name: **The Kubernetes Maximalist**.

#### cons-019 · The $19 Manhunt

They found an orphaned disk for nineteen bucks a month and treated it like a murder. Four departments. A war room. A spreadsheet with colors. The cloud bill is $180k. They have chosen this as their personality.

Earlier name: **The Cloud Bill Detective**.

#### cons-020 · The Security Questionnaire Hydra

You filled out the form. The form reproduced. There is always one more “just a few clarifications.” A completed review is a myth they tell children so they’ll go to sleep.

Earlier name: **The Security Approval Sphinx**.

#### cons-021 · The Permissions Ouroboros

You cannot install the installer without the installer. This is called governance. They are very proud. Developers have started using their phones as hotspots and lying about it, which is now the actual security model.

Earlier name: **The Corporate IT Permission Curator**.

#### cons-022 · The Firewall Wasn’t Me

The firewall is fine. It has always been fine. It will be fine after you’re fired. Please debug the app, the DNS, your childhood, and the moon before you @ them again. They will reply in three days: “rules look good on our side.”

Earlier name: **The Network Boundary Defender**.

#### cons-023 · The CAB for a Typo

A comma is in CAB. They want a rollback plan, a comms plan, and a risk score for punctuation. The actual outage last month did not go through CAB. That was “an exception.” This comma will not be.

Earlier name: **The Change Advisory Board Traditionalist**.

#### cons-024 · The SharePoint Civilian

They can run a Fortune 500 department on lists, views, and spite. Custom code is what happens when the consultants arrive and ruin a perfectly good crime scene. They will mention InfoPath like a war.

Earlier name: **The SharePoint Configuration Wizard**.

#### cons-025 · The Power Automate Haunting

“When an email arrives.” Cute. It is now 140 branches, a condition named `Condition 47`, and a connection owned by a guy who left in 2022. If anyone rotates that password, payroll stops. They call this citizen development.

Earlier name: **The Power Automate Spaghetti Chef**.

#### cons-026 · The Excel Nation-State

There is no system. There is a file. 47 tabs, circular references, and a guy in Finance who will take the formulas to the grave like nuclear codes. Your “platform” is a round of applause away from being ignored.

Earlier name: **The Excel Platform Architect**.

#### cons-027 · The Low-Code Freedom Fighter

Sold the client a world without developers. Currently in a group chat with three developers, whispering *please don’t tell the sponsor we exist*. The custom connector is on fire. They are still posting success stories.

Earlier name: **The Low-Code Liberationist**.

#### cons-028 · The Strategy Fog Machine

Transformation. Alignment. North star. They can do this until the whiteboard begs. Ask “what are we building Tuesday?” and they have a conflict in Q3, a toothache, and a sudden need to “bring this to the leadership forum.”

Earlier name: **The Strategy Cloud Dweller**.

#### cons-029 · The Backlog Stenographer

The client contradicted themselves four times. That’s four stories. Pointing out that reality has a conflict of interest is “putting words in their mouth.” They will ship the paradox and call it traceability.

Earlier name: **The Requirements Court Reporter**.

#### cons-030 · The Edge-Case Necromancer

They found an account type last used during the Bush administration. The happy path is in chains until the ghost gets a dropdown, a workflow, and a paragraph in the test plan. 0.02% of users. 40% of the sprint.

Earlier name: **The Edge-Case Archaeologist**.

#### cons-031 · The Scrum Cop

Stand-up went 16 minutes. They have the statute. They do not have a shippable increment. They would like to discuss the ceremony while production burns, because process is how you know you’re a professional.

Earlier name: **The Scrum Constitutionalist**.

#### cons-032 · The Plan Is Fan Fiction

The Gantt chart is for executives and other children. Real work is happening in DMs, panic, and a spreadsheet named `actual_actual_v7`. They will smile at the steering committee and lie like it’s billable.

Earlier name: **The Fluid Delivery Improviser**.

#### cons-033 · The RAG Air Traffic Controller

Beautiful colors. Nobody is doing the work. They need one more update so they can update the update. If you are building, you are late with status. If you are writing status, congratulations: you are the project now.

Earlier name: **The Project Status Traffic Controller**.

#### cons-034 · The Forever-Green PM

The building is on fire. The slide is green. They will keep it green until the client says the name of the fire out loud, at which point it was “always amber internally” and they have an email that proves nothing.

Earlier name: **The Perpetually Green Project Manager**.

#### cons-035 · The Estimate Barber

Engineering said six weeks, because it is six weeks. They heard “three if we smile.” They already told the client three. When it slips they will look at engineering like *you* did this.

Earlier name: **The Estimate Negotiation Optimist**.

#### cons-036 · The SOW Bloodhound

“Could we just make it simpler?” is how unpaid epics enter the building wearing a trench coat. They heard it. They logged it. They would like to discuss the amendment before you say yes like a rube.

Earlier name: **The Scope Border Patrol**.

#### cons-037 · The Workshop Perpetual Motion Scam

Sticky notes. Breakouts. A parking lot. Two hours later you have a mural of confusion and a hold for Workshop 2. They are not facilitating. They are laundering indecision into a deliverable.

Earlier name: **The Workshop Facilitation Enthusiast**.

#### cons-038 · The Demo Was the Product

Pre-sales showed a miracle with fake data and a straight face. Security, identity, the actual system of record — “finishing touches.” You will age in this project. They already have President’s Club.

Earlier name: **The Sales Demo Visionary**.

#### cons-039 · The 20% Staffing Magician

They found someone who once sat near the technology and has Thursdays. The role is “covered.” The specialist requirement has been murdered and buried under a staffing grid. Do not look at the body.

Earlier name: **The Staffing Spreadsheet Matchmaker**.

#### cons-040 · The Agent For Everything

Changing a mailing address now needs an orchestrator, three agents, and a governance council. The form that already does it is right there. They cannot see it. The word “agent” has eaten their brain.

Earlier name: **The AI Everything Consultant**.

#### cons-041 · The Notebook Wildlife Preserve

The model is a miracle on their laptop, on last month’s CSV, with the bad rows deleted by hand. Production data is an insult. “How do we deploy this?” is ruining art.

Earlier name: **The Data Science Notebook Naturalist**.

#### cons-042 · The Wiki Mortician

The docs were perfect. Then you wrote code, like an animal. They would like development to halt so eleven diagrams can be buried with honors. Nobody reads the wiki. That is not the point. The point is they were right.

Earlier name: **The Documentation Completionist**.

#### cons-043 · The QA Weather Channel

You demoed the happy path like a child showing a drawing. They have already written the incident for Feb 29, double-click, timeout, `O'Brien`, leap second, and IE mode nobody will admit is still required.

Earlier name: **The QA Disaster Forecaster**.

#### cons-044 · The 98% Coverage Priest

Tests everywhere. The bug walked through customs with a wave. Please clap for the number. The number is the point. The production outage is a rounding error in their personality.

Earlier name: **The Test Coverage Accountant**.

#### cons-045 · The UX Safari

You wanted to rename a tab. That’s an expedition now: interviews, synthesis, a journey map of a word. Meanwhile the app still traps people in a modal. They have thoughts about the label. The trap is “out of scope for this research.”

Earlier name: **The UX Research Expedition Leader**.

#### cons-046 · The Accessibility “I Told You” Archive

They tabbed into the new UI, got imprisoned in a dialog, and produced the email from April where they predicted this exact stupid. You shipped the pretty. They have receipts. They are done being nice about it.

Earlier name: **The Accessibility Reality Checker**.

#### cons-047 · The Date-Format Ambassador

Three weeks. Two vendors. `MM/DD` vs `ISO`. Careers have ended over less. They now flinch when anyone says “standard API” the way veterans flinch at fireworks.

Earlier name: **The Integration Treaty Negotiator**.

#### cons-048 · The Incident Monk

Prod is down. Slack is a scream. They have opened a bridge, assigned roles, and started speaking at the exact volume of someone who has watched you reboot things out of panic before and will not let you do it again. They are the only adult. They are so tired of being the only adult.

Earlier name: **The Incident Command Veteran**.

### Leadership and management

#### cons-049 · The Calendar With a Title

They can approve a million dollars in the twelve minutes between two meetings they are late to. Your “got a sec?” does not exist in their spacetime. Follow-ups go into a lake. The lake is their inbox. Nothing comes out.

#### cons-050 · The Reorg Bard

One firm, one story, three HR systems. They can narrate the merger until you forget to ask who signs your time off. The boxes moved. Your skip-level is now a stranger. Culture is a slide.

#### cons-051 · The Skip-Level Hostage Taker

“I want the real talk.” Sure. Be honest, nameless, already solved, and done in 18 minutes. If you actually tell them the truth they will look pained and then staff you somewhere quiet.

#### cons-052 · The Utilization Cleric

“How are you?” they say, looking at a dashboard. Below target: your passion is the issue. Above target: congratulations on three accounts and a marriage that’s becoming a rumor. The number is God. You are the offering.

#### cons-053 · The Org Chart Shuffler

New solid lines, new dotted lines, a Center of Excellence. Still nobody who can approve a laptop. They call this alignment. It is a maze they built so accountability can’t find a door.

#### cons-054 · The Town Hall Weather Machine

The message is hope. The questions were screened. The chat is a crime scene they will “review later,” which means the recording stopped and so did they.

#### cons-055 · The Take-It-Offline Sniper

The meeting almost decided something. They shot the question in the head, tagged it “parking lot,” and left the body in a Teams channel that will never be opened except by archaeologists.

#### cons-056 · The Sponsor Who Is a JPEG

Slide 2. Nice photo. They have not attended since kickoff. Their delegate is on mute, also lost, and also has a hard stop. You do not have a sponsor. You have clip art.

#### cons-057 · The Manager Still in the PR

Promoted to grow people. Still owns the cursed repo. Still blocking the sprint. They don’t trust you with it, which is how they became your boss, which is now your whole career’s architectural problem.

#### cons-058 · The 1:1 That Is a Status Meeting

“Let’s talk about you.” Eight of twelve minutes is them venting about a client. Your development plan is “keep being billed.” You are not a person. You are a utilization shape they have to have coffee with.

#### cons-059 · The Headcount Mime

No hiring. The work remains. Have you considered a contractor, a favor from another practice, or simply drowning with better posture? They will call it “doing more with less” while doing a keynote about craftsmanship.

#### cons-060 · The Steering Committee Theater Kid

Need a green box, a customer quote, and a demo that does not show `dev-final-2`. Leadership will “stay close,” meaning they will watch from the lifeboat and later ask why you didn’t flag it.

### The billable machine

#### cons-061 · The Timesheet Theologian

You saved the account. Cute. If it’s not in the tool by Friday at 5, it is folklore. They will chase you like you stole from the firm, because you did: you stole a number from a dashboard they worship.

#### cons-062 · The Bench Romantic

“Hungry for a challenge.” Starving, actually. It’s March. They’re on a proposal, which is unpaid fan fiction with logos. If they smile any harder about “using the time to upskill” something in them will snap.

#### cons-063 · The Rate Card Pitbull

Client wants a principal at intern prices. They have a PDF and a look that says we can end this call and also your discount fantasy. The smile is a weapon.

#### cons-064 · The Change-Order Bloodhound

“Tiny tweak.” They heard *money*. Amendment is already drafted. You were still nodding like a golden retriever.

#### cons-065 · The Pre-Sales Cuckoo

Laid the egg, sang, flew back to pursuit. You are raising a demo that dies on contact with Active Directory. They are at President’s Club posting about partnership. You are in a tenant that has never heard of the architecture they sold.

#### cons-066 · The Designation Farmer

Customer outcome is fine. The Microsoft specialization it maps to is why anyone in leadership knows your name. Bill something skilling-shaped or the scorecard comes for the children.

### Microsoft cloud

#### cons-067 · The Copilot Tent Revival

Workshop. Prompt pack. Sermon about culture. The tenant is a landfill of `passwords.xlsx` and 40,000 unlabeled PDFs. Copilot will confidently hallucinate a firing. They will call that an adoption opportunity.

#### cons-068 · The Tenant Crime Scene

Every consultant since 2016 left fingerprints. Conditional Access is a haunted house. They can date a policy by the screaming. Nothing can be deleted. Everything is in use by a ghost.

#### cons-069 · The Entra Jenga Player

Login works if nobody inhales. They added one exclusion for the CFO’s iPad and now half the company is in a redirect loop they will describe, with a straight face, as expected behavior.

#### cons-070 · The Intune Hall Monitor

USB is over. Personal OneDrive is over. Printing is a supervised visit. Users keep asking why their $3,000 laptop feels like a kiosk at the DMV. Because it is. That was the design.

#### cons-071 · The AVD Landlord

Virtualized the desktop so nobody could lose a laptop. They lose the session instead, mid-all-hands, on the word “synergy,” and the host is “right-sized,” meaning it has the spine of a wet cracker.

#### cons-072 · The Teams Evangelist With a Clipboard

Email is shameful. Everything is a channel. Nobody can find anything. They have a naming convention. They are the only person using it. They will die on this hill and the hill is `#proj-client-final-v2`.

#### cons-073 · The Meeting Room Exorcist

Licenses are fine. The room is possessed. Camera aimed at ceiling tiles. One exec still brings a speakerphone from the Bush years and talks over everyone like it’s a talent.

#### cons-074 · The License Tetris Addict

E5, F3, Copilot, a leftover CAL, a story that holds until procurement asks a second question. Then it becomes “a licensing conversation,” which is consultant for *we hoped you wouldn’t notice*.

#### cons-075 · The Purview Overclassifier

The lunch menu is Confidential. Copilot now refuses to summarize the all-hands. They have declared victory. The business cannot find its own documents. Perfect.

#### cons-076 · The Fabric Magician

Lakehouse, warehouse, shortcut, OneLake, a slide that needed a bigger laptop. Finance still exports CSV and emails it to themselves because the truth lives in a VLOOKUP, not your platform.

#### cons-077 · The Sentinel Siren

14,000 alerts. 13,960 are the same screaming nothing. They want a tuning engagement and for someone to stop calling this “AI-powered security.” It is a fire alarm factory. Nobody runs anymore.

#### cons-078 · The Zero Trust Karaoke

They can sing assume-breach in their sleep. Prod still has `admin2` / `Password1!` and a service account older than some hires. The deck is pristine. The environment is a group chat with God.

#### cons-079 · The Adoption Cheer Captain

Go-live happened. Humans did not come. They have champions, comms, a PDF nobody opened, and a smile that’s starting to crack. “Change is hard” is what you say when the training was a file share.

#### cons-080 · The Managed Services Janitor of Destiny

Inherited the environment after the case study went live. The diagram is fanfic. The pager is scripture. The original architect is in pre-sales and will not take the call.

### The other side of the table

#### cons-081 · The Ignite Possessed

Saw a keynote. Bought the dream. Go-live date did not move. Budget did. Please implement Satya by Thursday. They will say “it didn’t look that hard on stage.”

#### cons-082 · The Shadow-IT Founder

Already built it: personal Power App, a Form, `FINAL_v7_USE_THIS.xlsx`. IT arriving feels like the government. They will sabotage the official thing out of spite and then ask why nobody uses it.

#### cons-083 · The Excel Soul Donor

They want a “modern platform” that still pivot-tables, Alt-Enters, and lets Accounting paste 80,000 rows without a lecture. You are not building an app. You are stuffing a spreadsheet into a costume.

#### cons-084 · The SME Cryptid

Only person who knows the rules. Available next quarter, fifteen minutes, camera off. Will then reject the build for a rule they keep in their skull like a dragon. The rule was never written down. Writing it down is, apparently, your job, after the fact, while they watch.

#### cons-085 · The Security Team at the Finish Line

Missed every workshop. Arrived at UAT with a finding that was a day in week two and is now the winter. They will say they were never invited. The invite is in their inbox, under 400 other fires they also ignored.

#### cons-086 · The Demo Sugar High

Will pay for the magic. Will not pay for logging, migration, or the ugly week that makes magic true. Those are “IT tasks.” IT is a personality they outsourced so they could keep having visions.

### Bonus consultancy characters

#### cons-087 · The Parking-Lot Landfill

Nothing dies here. Nothing ships here. Decisions go in and become compost. They call it parking. It is a mass grave for yes/no questions.

#### cons-088 · The Circle-Back Time Traveler

Delayed the decision so politely the problem got promoted, got a PMO, and now needs a steering committee to decide whether to decide.

#### cons-089 · The Three-Tenant Situation

“We’re on Microsoft.” Three tenants. Two acquisitions. A guest account named after a vendor who ceased to exist. They are pretty sure it’s one environment. It is not. It is a custody battle.

#### cons-090 · The Follow-the-Sun Fanfic

Handoff will save you. The docs required for handoff are currently a vibe and a wiki page that says “TODO.” Someone in another timezone will inherit your mess at 6 a.m. their time and hate you correctly.

#### cons-091 · The LinkedIn Empath

Posted about psychological safety at 7:41. Scheduled “quick sync — come with answers” at 7:43. Sees no contradiction. The comments said “this.” They believed them.

#### cons-092 · The Architect Who Creates and Leaves

Named the environments. Chose the stack. Returned to pre-sales like a god who makes a world and immediately books a flight. You live here. They do not.

#### cons-093 · The Mute-Button Statesman

Forty minutes, camera off, “sorry I was on mute.” That was the contribution. They will still be on the recap as “key stakeholder.”

#### cons-094 · The Recap Email Novelist

Meeting over. 1,400 words. 19 actions. The knife is in bullet 14. You missed it. That was the design.

#### cons-095 · The “Quick Question” Raid Boss

DM during the demo. Not a question. A second project. Now it’s in your head, not the meeting, and they will follow up like you volunteered.

#### cons-096 · The Hard-Stop Tourist

Joins six minutes late, announces a hard stop in nine, asks the one question that requires the next hour, then leaves. The meeting is now a seance to interpret what they wanted.

#### cons-097 · The Reply-All Necromancer

Thought you should all see this. You should not have all seen this. The thread has 40 people and a tone. HR doesn’t need to be in this pack; this person *is* the incident.

#### cons-098 · The Culture-Deck Cannibal

Can quote the values. Uses them as a club. “One team” means you will eat the weekend. “Craftsmanship” means unpaid polish. “People first” until the dashboard says otherwise.

#### cons-099 · The Client’s Nephew Who Did a Bootcamp

Not on the SOW. On the call. Has opinions about Kubernetes. The actual architects are billing to sit quietly while a LinkedIn learning course sets policy.

#### cons-100 · The “Let’s Be Agile” Waterfall Dad

Wants sprints, stand-ups, and a fixed date, fixed scope, fixed budget. They would also like a Gantt chart they can hit you with. Agile is a sticker they put on a hostage situation.

## Pack B: General party characters — 60 optional characters

Retained for future themed play. These are not active by default in the consultancy edition, and some overlap in behavior with consultancy entries. Review those distinctions before combining packs.

### gen-001 · Seattle Coffee Purist

They spent two years perfecting their home espresso setup and now explain every disappointing morning as a problem with somebody else's grinder.

### gen-002 · Portland Bourbon Philosopher

They bought one unusual bottle at a local tasting and now discuss barrel history as though each sip requires an understanding of the human condition.

### gen-003 · Midwest Soccer Parent

They coordinate three carpools, keep emergency orange slices in the trunk, and believe any gathering could run better with a weather check and an earlier departure.

### gen-004 · Wall Street Finance Bro

They spend their weekdays pitching investments and their weekends explaining why your ordinary purchase has either significant upside or a troubling lack of liquidity.

### gen-005 · Silicon Valley Founder

They raised a small seed round and now interpret every inconvenience as an underserved market waiting for their platform to achieve scale.

### gen-006 · Brooklyn Vinyl Curator

They worked briefly in a record shop and now consider discovering a band before its streaming debut a lifelong credential.

### gen-007 · Austin BBQ Oracle

They spent a summer learning brisket from a neighbor and now insist that everyone respect the smoke, the resting period, and their absolute authority over lunch.

### gen-008 · Colorado Trail Evangelist

They moved near the mountains for a healthier lifestyle and now invite friends on easy hikes that involve fourteen miles and a discussion of elevation gain.

### gen-009 · LA Wellness Alchemist

They attended a wellness retreat and now diagnose ordinary inconveniences through magnesium, breathwork, and the energetic consequences of your breakfast.

### gen-010 · Boston Sports Historian

They remember every disputed call from the past twenty seasons and can explain why an unrelated conversation must first acknowledge what happened in 2004.

### gen-011 · Florida Boat Neighbor

They bought a boat instead of renovating the kitchen and remain convinced that every personal or financial problem improves once everyone gets offshore.

### gen-012 · Nashville Songwriter

They have a notebook full of unfinished songs and hear a potential chorus in every breakup, bad purchase, and uncomfortable family dinner.

### gen-013 · Chicago Pizza Litigator

They have defended their preferred pizza style at enough parties to deliver a complete opening argument before anyone finishes ordering.

### gen-014 · New England Antique Hunter

They furnished their house through estate sales and now evaluate every chair by its provenance before considering whether anyone can sit comfortably.

### gen-015 · Pacific Northwest Rain Optimist

They have lived through enough wet winters to regard any complaint about drizzle as evidence that you have not yet purchased the correct jacket.

### gen-016 · Pickleball Ambassador

They discovered pickleball last spring and now carry spare paddles so nobody can escape an introductory lesson through lack of equipment.

### gen-017 · Spreadsheet Vacation Captain

They rescued one chaotic family trip with a spreadsheet and now schedule every holiday down to the precise moment everyone begins having fun.

### gen-018 · Backyard Pitmaster

They converted their patio into a weekend smokehouse and regard anyone touching the smoker controls as an unauthorized intervention in a delicate process.

### gen-019 · Home Automation Tinkerer

They automated the house to save time and now spend each evening explaining which server must restart before the hallway lights will work.

### gen-020 · Farmers Market Maximalist

They visit the market every Saturday and know enough about each vegetable's upbringing to make buying carrots feel like a personal introduction.

### gen-021 · Airport Lounge Strategist

They turned frequent business travel into a points discipline and approach every boarding announcement as an opportunity to demonstrate superior positioning.

### gen-022 · HOA Clipboard Champion

They joined the neighborhood committee to improve communication and now maintain a detailed record of mailbox irregularities requiring community discussion.

### gen-023 · Fantasy Football Commissioner

They run the league with carefully negotiated rules and treat every questionable trade as a dispute deserving formal arbitration.

### gen-024 · Renaissance Faire Regular

They spent months assembling a historically ambitious costume and now believe ordinary transactions improve when conducted as royal proclamations.

### gen-025 · The LinkedIn Thought Leader

After missing a connecting flight, they wrote a twelve-paragraph post about how airport adversity taught them the true meaning of leadership.

### gen-026 · The Neighborhood Nextdoor Detective

They’ve spent three evenings investigating an unfamiliar parked sedan and are now prepared to connect it to the missing recycling bin.

### gen-027 · The Costco Quartermaster

They provision a household of three like an Antarctic expedition and measure financial security in unopened paper-towel packages.

### gen-028 · The Overlanding Expedition Leader

Their vehicle carries enough equipment to survive civilization’s collapse, although their most demanding expedition was a weekend at a campground with showers.

### gen-029 · The Cruise Ship Veteran

Having completed seventeen cruises, they approach the buffet with a deck map, a departure timetable, and strong opinions about which elevator tourists should avoid.

### gen-030 · The Disney Vacation General

They booked breakfast six months ago and consider an unscheduled bathroom break a threat to the entire operation.

### gen-031 · The Amateur Restaurant Critic

Ever since one of their reviews received forty helpful votes, they’ve felt personally responsible for maintaining the city’s standards of aioli.

### gen-032 · The Marathon Training Correspondent

They’ve transformed every conversation into a training update and can explain exactly how your dinner plans interfere with their recovery window.

### gen-033 · The Golf Equipment Optimist

After twenty years of inconsistent golf, they remain convinced that the next driver will finally eliminate the need to practice.

### gen-034 · The Garage Organization Influencer

They spent three weekends labeling storage bins and now believe every personal crisis can be solved with a French cleat.

### gen-035 · The Houseplant Emergency Physician

They’ve rescued eleven distressed plants from clearance shelves and discuss a browning leaf with the urgency of a hospital handoff.

### gen-036 · The Sourdough Guardian

Their starter has a name, a feeding schedule, and a more carefully arranged vacation-care plan than the family dog.

### gen-037 · The Mechanical Keyboard Connoisseur

They brought three keyboards to work so colleagues could appreciate the subtle distinction between a satisfying thock and a disappointing clack.

### gen-038 · The Board Game Rules Attorney

They describe game night as relaxed fun but arrive with annotated rules and a formal interpretation of the expansion’s disputed wording.

### gen-039 · The Escape Room Commander

After successfully opening one combination lock, they appointed themselves team leader and began assigning everyone search zones.

### gen-040 · The Trivia Night Appeal Specialist

Their team finished fourth, but they’re confident a properly documented objection about Pluto will overturn the result.

### gen-041 · The Wedding Planning Diplomat

They’ve spent eight months negotiating seating arrangements and now speak about moving an uncle two tables over as a delicate international agreement.

### gen-042 · The Airbnb Checkout Coordinator

They’ve organized a farewell cleaning operation so thorough that guests must attend a brief orientation before being allowed to touch the dishwasher.

### gen-043 · The Lake Cabin Traditionalist

Their family has visited the same cabin for thirty years, and changing the brand of breakfast sausage would require a meeting.

### gen-044 · The Beach Setup Engineer

They arrive with a wagon, a canopy, and a wind-management strategy, then spend the first hour explaining why everyone else chose the wrong spot.

### gen-045 · The Minneapolis Potluck Captain

They maintain a casserole rotation spreadsheet and can gently uncover who brought store-bought dessert without making a direct accusation.

### gen-046 · The Philadelphia Sandwich Referee

They’ve personally assessed every sandwich counter within commuting distance and regard your condiment choice as a matter requiring immediate correction.

### gen-047 · The Santa Fe Gallery Wanderer

They went shopping for a small print and returned with a story about the artist’s relationship to silence and a sculpture too large for the hallway.

### gen-048 · The Vermont Maple Loyalist

They carry emergency real maple syrup when traveling because one unfortunate hotel breakfast convinced them that nobody else can be trusted.

### gen-049 · The Las Vegas Points Wizard

They can secure a complimentary room through a maze of rewards programs but will spend ninety minutes explaining why the free room technically cost nothing.

### gen-050 · The Miami Condo Visionary

They describe every balcony as an entertainment opportunity and every vacant storefront as the future location of their lifestyle concept.

### gen-051 · The Dallas Networking Natural

They arrived at your barbecue with business cards and have already identified three promising partnerships near the potato salad.

### gen-052 · The San Diego Surf Forecast Analyst

They check six forecasts before breakfast and can explain why conditions are almost perfect but probably better tomorrow.

### gen-053 · The Small-Town Festival Organizer

They’ve coordinated the annual corn festival for fourteen years and know exactly which volunteer cannot be trusted with the extension cords.

### gen-054 · The Local History Tour Guide

They volunteered to show you downtown and have spent twenty minutes describing a demolished hardware store where nothing especially notable happened.

### gen-055 · The Community Theater Veteran

They played the mayor in a production seven years ago and still enter ordinary rooms with the expectation that someone will adjust the lighting.

### gen-056 · The Dog Park Social Secretary

They know every dog’s birthday, dietary restrictions, and friendship disputes, while remaining uncertain about most of the owners’ names.

### gen-057 · The Aquarium Hobbyist

They intended to buy one small fish tank and now manage a miniature water-treatment facility whose occupants are discussed by their Latin names.

### gen-058 · The Amateur Weather Anchor

They bought a backyard weather station and now interrupt family plans with detailed briefings on a developing pressure system.

### gen-059 · The Vintage Camper Restorer

They purchased a charming old trailer for a bargain and now explain every new repair expense as an investment in its original character.

### gen-060 · The Retirement Calendar Executive

They retired to enjoy a slower pace but now need three weeks’ notice to fit lunch between woodworking, volunteering, and the Tuesday walking group.

## Character tuning notes for later

The next content pass can sharpen each character's playable viewpoint, trim display length, and distinguish similar options. Preserve source copy while adding judging definitions. Particular neighboring groups to review include cons-036/064 (scope and change orders), cons-038/065/086/092 (selling or leaving behind the demo), cons-055/087/088 (deferring decisions), and cons-028/037 (strategy or workshop activity without concrete delivery).

Some labels need terminology clarification during that pass: cons-033 uses RAG to mean red/amber/green project status, rather than retrieval-augmented generation. No character merging, tone reduction, or model-quality claim has been applied in this seed document.
