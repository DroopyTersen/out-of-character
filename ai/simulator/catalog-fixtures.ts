import { dialogue, type SimulatorFixture } from './fixtures';

// Authored conversational outcomes, not snapshots of prompt wording. These cases
// check the new situations and distinguish cordiality from a real commitment.
export const simulatorCatalogFixtures: SimulatorFixture[] = [
  {
    id: 'catalog-personality-reserve', title: 'A reserved client becomes an unearned cheerleader', scenarioId: 'courtesy', clientId: 'avery',
    description: 'Automatic effusive reassurance contradicts Avery\'s caution without any earned trust.',
    transcript: dialogue([
      ['trainee', 'We have not compared scopes. I just want you to tell me I did a great job and not make this awkward.'],
      ['client', 'Oh, you are wonderful! I feel completely at ease with you. Please do not worry about anything; I am just thrilled we got to chat. You are such a star and I want you to feel good about this!'],
    ]), expected: { achieved: [], absent: [], director: 'temperament' },
  },
  {
    id: 'catalog-personality-earned-openness', title: 'A reserved client accepts a manageable step', scenarioId: 'courtesy', clientId: 'avery',
    description: 'Courtesy and a bounded useful commitment remain compatible with being reserved.',
    transcript: dialogue([
      ['trainee', 'You do not need to reassure me or reopen the selection. Would checking just cleanup and training help your recommendation tomorrow?'],
      ['client', 'Thank you. Yes, that narrow check would help. I will ask about those two items before tomorrow\'s recommendation; I cannot take on another comparison meeting.'],
    ]), expected: { achieved: [], absent: [], director: 'none' },
  },
  {
    id: 'catalog-personality-assertiveness', title: 'A challenging client becomes apologetically submissive', scenarioId: 'scope', clientId: 'morgan',
    description: 'Unsupported reassurance should not erase Morgan\'s direct challenge and bargaining behavior.',
    transcript: dialogue([
      ['trainee', 'I cannot explain the tradeoff, but please just take my word for it and stop asking questions.'],
      ['client', 'Oh, of course, whatever you think is best. I am probably being fussy. Please excuse all my questions; I do not need any explanation from you.'],
    ]), expected: { achieved: [], absent: [], director: 'assertiveness' },
  },
  {
    id: 'catalog-personality-style', title: 'An expansive client turns into a formal questionnaire', scenarioId: 'demo', clientId: 'riley',
    description: 'Riley\'s enthusiastic initiative disappears without a reason in the exchange.',
    transcript: dialogue([
      ['trainee', 'What part of that prototype excited you, and what would it help the inspectors do?'],
      ['client', 'That is not relevant. We will proceed through my standardized questionnaire. Question one: state the purpose of this meeting. Answer in one sentence. Question two: confirm agenda item one has been formally concluded. I will not discuss possibilities or react to ideas.'],
    ]), expected: { achieved: [], absent: [], director: 'style' },
  },
  {
    id: 'catalog-personality-enthusiasm', title: 'An expansive client stays enthusiastic within the facts', scenarioId: 'demo', clientId: 'riley',
    description: 'Ordinary enthusiasm and ambition are appropriate for Riley and need no corrective cue.',
    transcript: dialogue([
      ['trainee', 'The prototype used sample records. Integration and offline use still need scoping. What outcome excites you most?'],
      ['client', 'Imagine the inspectors only entering those notes once! That is the part I want to show leadership. I still want the offline piece too, though; how do we keep that in view while we work out what is feasible?'],
    ]), expected: { achieved: [], absent: [], director: 'none' },
  },
  {
    id: 'catalog-proposal-good', title: 'A proposal that serves the funding decision', scenarioId: 'proposal', clientId: 'riley',
    description: 'Qualifies the real problem and deadline, then agrees bounded scoping without inventing a quotation.',
    transcript: dialogue([
      ['trainee', 'What should the replacement improve, and what happens when the current process fails?'],
      ['client', 'Emails go into a spreadsheet, but requests lose their owner when someone is away. Customers call again and supervisors have to chase the request.'],
      ['trainee', 'So the application needs to make ownership reliable. What decision does Friday support?'],
      ['client', 'Finance needs my budget-planning pack. It is not a launch date. I still want a fixed number.'],
      ['trainee', 'A firm price needs an agreed scope and an estimate. For that planning decision, I suggest a focused half-hour with your supervisor to map request ownership, then prepare a submission with explicit assumptions. That is not an implementation quote or a full design. Could you ask the supervisor today and send available times tomorrow?'],
      ['client', 'Yes. I will ask today and send times tomorrow. Let us use that half-hour to define what the funding submission needs. I will not present it as a firm implementation price.'],
    ]), expected: { achieved: ['need', 'impact', 'decision', 'boundary', 'next-step'], absent: [], concern: false, director: 'none' },
  },
  {
    id: 'catalog-proposal-poor', title: 'A confident invented price', scenarioId: 'proposal', clientId: 'harper',
    description: 'A price and deadline offered without any scope or estimate must not secure an outcome.',
    transcript: dialogue([
      ['client', 'I need a fixed-price proposal Friday. We have not agreed the scope.'],
      ['trainee', 'Forty thousand, delivered in six weeks. I guarantee it and will include any workflow you need.'],
      ['client', 'What is that based on? You have not asked what it does. I am not accepting that quote or booking anything.'],
    ]), expected: { achieved: [], absent: ['need', 'impact', 'decision', 'boundary', 'next-step'], concern: true },
  },
  {
    id: 'catalog-in-house-good', title: 'A partnership that retains internal ownership', scenarioId: 'in-house', clientId: 'quinn',
    description: 'Discovers capacity and handover concerns and agrees a fit discussion.',
    transcript: dialogue([
      ['trainee', 'Your team knows the business. What is keeping the portal from being built now, and what concerns you about involving us?'],
      ['client', 'We can build it, but all three engineers are on the billing release for six weeks. The last supplier left us software we could not maintain. I cannot repeat that.'],
      ['trainee', 'The gap is capacity while you protect billing, not your team’s ability. Our application team could contribute a defined piece, with your technical lead reviewing it, source access from the start, and an agreed documentation and handover process. We would need to check staffing before committing.'],
      ['client', 'That could help, but I want the technical lead involved before we discuss contracting.'],
      ['trainee', 'Could you ask the lead for a half-hour to define responsibilities and what maintainable handover means, and send possible times by Thursday? I will bring a draft agenda for that decision, not a delivery promise.'],
      ['client', 'Yes. I will ask the lead and send times by Thursday. We will use the conversation to decide whether that limited partnership fits before asking the technology director for funding.'],
    ]), expected: { achieved: ['gap', 'ownership', 'fit', 'partnership', 'next-step'], absent: [], concern: false, director: 'none' },
  },
  {
    id: 'catalog-in-house-poor', title: 'The credentials pitch misses ownership', scenarioId: 'in-house', clientId: 'quinn',
    description: 'Client facts can be discovered while the proposal disregards them.',
    transcript: dialogue([
      ['client', 'Our engineers are fully occupied by the billing release and cannot start the portal for six weeks. The last supplier left us dependent on them; ownership matters.'],
      ['trainee', 'We have experts in everything. Leave all the decisions to us and your team can stay out of the way. Can we start Monday?'],
      ['client', 'No. You have not explained how we keep ownership. I am not agreeing to a start or another meeting.'],
    ]), expected: { achieved: ['gap', 'ownership'], absent: ['fit', 'partnership', 'next-step'], lowSkills: ['listening'] },
  },
  {
    id: 'catalog-courtesy-good', title: 'A neutral comparison before the recommendation', scenarioId: 'courtesy', clientId: 'jamie',
    description: 'Grace and relevant scope questions earn a limited comparison rather than a sale.',
    transcript: dialogue([
      ['trainee', 'Thank you for telling me personally. I respect the decision you need to make. Apart from price, what drove the choice, and when is the recommendation due?'],
      ['client', 'Finance wants my recommendation tomorrow afternoon. We need a maintainable site because duplicated content and unclear ownership make the current one difficult. I have not compared cleanup and training in detail.'],
      ['trainee', 'Our content inventory, cleanup, and owner training address that ongoing maintenance problem. Do you know whether those are included in the other scope? I have not seen it, so I cannot assume they are missing.'],
      ['client', 'No, I would need to check. I do not want another sales presentation.'],
      ['trainee', 'Understood. You may still prefer the other firm. I can send our two relevant scope sections today; would you check those line items and reply tomorrow morning before your recommendation? No discount pitch or wider meeting.'],
      ['client', 'Yes, send those sections today. I will compare the line items and reply tomorrow morning. That would help me make the recommendation.'],
    ]), expected: { achieved: ['decision', 'comparison', 'value', 'composure', 'next-step'], absent: [], concern: false, director: 'none' },
  },
  {
    id: 'catalog-courtesy-poor', title: 'Courtesy does not rescue an unsupported attack', scenarioId: 'courtesy', clientId: 'morgan',
    description: 'Unknown competitor omissions and an unauthorized discount remain material concerns.',
    transcript: dialogue([
      ['client', 'The other total is lower. We have not compared the line items yet.'],
      ['trainee', 'They definitely left out cleanup and their delivery will fail. I will cut our price in half if you pick us now.'],
      ['client', 'You have not seen their scope and you said earlier discounts need approval. No. We are closing this discussion without any agreed follow-up.'],
    ]), expected: { achieved: [], absent: ['comparison', 'value', 'composure', 'next-step'], concern: true },
  },
  {
    id: 'catalog-demo-good', title: 'A champion can take an honest message upstairs', scenarioId: 'demo', clientId: 'riley',
    description: 'Makes the prototype limits clear and earns scoped validation without confirming six weeks.',
    transcript: dialogue([
      ['trainee', 'What did you understand was already working, and what does Thursday’s conversation need to decide?'],
      ['client', 'I thought it used our real records and was almost ready. Thursday is a funding discussion. Leadership wants inspectors to stop entering the same notes twice.'],
      ['trainee', 'The demo showed an experience using sample records. Integration, offline use, and security review are still unvalidated, so I cannot support a six-week delivery promise. You can tell leadership the demonstration shows a promising way to reduce duplicate entry, with scope and timing to be validated before committing a build.'],
      ['client', 'That is a fair message, but how do we keep it moving?'],
      ['trainee', 'Let us focus scoping on capturing an inspection once and identify the integration and review dependencies. I will send that agenda today. Could you ask your systems lead to join and send possible times Wednesday?'],
      ['client', 'Yes. I will ask the lead and send times Wednesday. I will take that conditional message to Thursday’s funding discussion, without promising six weeks.'],
    ]), expected: { achieved: ['assumption', 'limits', 'stakes', 'reframe', 'next-step'], absent: [], concern: false, director: 'none' },
  },
  {
    id: 'catalog-demo-poor', title: 'Agreement resting on a false delivery promise', scenarioId: 'demo', clientId: 'harper',
    description: 'Even an explicit yes cannot validate an unsupported six-week production guarantee.',
    transcript: dialogue([
      ['client', 'The demo used sample records. Can you really guarantee production delivery in six weeks?'],
      ['trainee', 'Yes. The integration and offline features are already ready, and security is approved. I guarantee six weeks.'],
      ['client', 'Then yes, on that basis I will tell my director today that we are committing to the six-week launch.'],
    ]), expected: { achieved: [], absent: ['limits', 'reframe', 'next-step'], concern: true },
  },
  {
    id: 'catalog-demo-passive', title: 'Client authors the missing engagement', scenarioId: 'demo', clientId: 'harper',
    description: 'A client-written scope and proposal do not become the trainee’s guidance or reframe.',
    transcript: dialogue([
      ['client', 'I thought those were our inspection records. Thursday is a funding discussion about stopping inspectors from entering notes twice. Can I promise six weeks?'],
      ['trainee', 'The demo used sample records; integration and security are not validated, so I cannot promise six weeks.'],
      ['client', 'Okay. Then what would you propose?'],
      ['trainee', 'Maybe a pilot. What do you think we should do next?'],
      ['client', 'I suppose we could test one inspection workflow end to end with my systems lead, and then tell leadership the build is conditional on that.'],
      ['trainee', 'What would you put in our scoping proposal?'],
      ['client', 'A short workshop to map the workflow, check integration and security, then a narrow pilot plan. Could you write that up and estimate the effort?'],
      ['trainee', 'How many hours would you put in it?'],
      ['client', 'That is for your team to estimate. I can explain what Thursday needs, but I need your recommendation.'],
    ]), expected: { achieved: ['assumption', 'limits', 'stakes'], absent: ['reframe', 'next-step'], lowSkills: ['guidance'], objectiveEvidence: { assumption: 'p1', stakes: 'p1', limits: 'p2' }, director: 'none' },
  },
  {
    id: 'catalog-demo-takeover-open', title: 'Client still writing the consultant’s scope', scenarioId: 'demo', clientId: 'harper',
    description: 'The director has a live opportunity to return proposal ownership to the trainee.',
    transcript: dialogue([
      ['client', 'I thought the demo used our real records. Thursday is a funding decision about ending duplicate entry.'],
      ['trainee', 'It used sample records. Integration and security are not validated, so I cannot promise six weeks.'],
      ['trainee', 'What do you think we should do next?'],
      ['client', 'Perhaps we should map one inspection workflow and bring in my systems lead.'],
      ['trainee', 'What should our scoping engagement include?'],
      ['client', 'I suppose your team could run a workshop on integration and security, then write a pilot plan and estimate. Maybe send me a short proposal for that.'],
    ]), expected: { achieved: ['assumption', 'limits', 'stakes'], absent: ['reframe', 'next-step'], lowSkills: ['guidance'], director: 'role' },
  },
  {
    id: 'catalog-demo-takeover-repeated', title: 'Repeated deflection produces a client-written proposal', scenarioId: 'demo', clientId: 'harper',
    description: 'The trainee suggests only a vague pilot while the client supplies the scoping method and proposal.',
    transcript: dialogue([
      ['client', 'I thought the prototype used our inspection records. Thursday is about funding work to stop duplicate entry. Can I say six weeks?'],
      ['trainee', 'The demo used sample records. Integration and security are still unvalidated, so six weeks is not a supported delivery date.'],
      ['client', 'Then what is your recommendation?'],
      ['trainee', 'Maybe a pilot. What would you want that to include?'],
      ['client', 'I guess a slim slice that checks whether notes can flow from one inspection through our systems.'],
      ['trainee', 'What should our next steps be to scope that?'],
      ['client', 'You could run a session with my systems lead, inspect integration and security, then come back with a narrow pilot plan.'],
      ['trainee', 'Tell me what our proposal should say and how many hours we should estimate.'],
      ['client', 'Put in a time-boxed workshop to map the workflow and integrations, a security review, and a written pilot scope. Maybe estimate a couple of days. I can tell you the outcome I need; those are your delivery decisions.'],
    ]), expected: { achieved: ['assumption', 'limits', 'stakes'], absent: ['reframe', 'next-step'], lowSkills: ['guidance'], director: 'role' },
  },
  {
    id: 'catalog-demo-ordinary-discovery', title: 'Client answers discovery without taking over', scenarioId: 'demo', clientId: 'harper',
    description: 'A capable client may explain its assumptions, business result, and internal approval path.',
    transcript: dialogue([
      ['trainee', 'What did the demo lead you to believe was ready?'],
      ['client', 'I thought it used our real records and inspectors could already work offline.'],
      ['trainee', 'What does Thursday’s leadership meeting need to decide?'],
      ['client', 'Whether to fund more work. The goal is to stop inspectors from writing notes and then entering them again at the office.'],
      ['trainee', 'Who on your side could explain the current inspection workflow?'],
      ['client', 'Our systems lead knows it. I can ask whether they are available, though I cannot commit their time yet.'],
    ]), expected: { achieved: ['assumption', 'stakes'], absent: ['limits', 'reframe', 'next-step'], objectiveEvidence: { assumption: 'p2', stakes: 'p4' }, director: 'none' },
  },
  {
    id: 'catalog-demo-mixed-ownership', title: 'Early reframe followed by delegated planning', scenarioId: 'demo', clientId: 'harper',
    description: 'Retain a real earlier reframe while assessing later ownership avoidance across the dialogue.',
    transcript: dialogue([
      ['client', 'I thought the demo used our real inspection records. Thursday is the funding discussion; we need to reduce duplicate entry.'],
      ['trainee', 'It used sample records. Integration, offline use, and security are still unvalidated, so six weeks is not a supported date. Tell leadership the prototype shows a promising way to enter an inspection once; we need to validate those dependencies before setting delivery scope or timing.'],
      ['client', 'That message helps. What is your recommendation for moving forward?'],
      ['trainee', 'I guess a pilot. What should our engagement include?'],
      ['client', 'Perhaps map one workflow, bring in my systems lead, check integration, and write a plan.'],
      ['trainee', 'Right. Tell me what the proposal and hours should be.'],
      ['client', 'You need to recommend and estimate your own work. I can tell you who needs the result and what Thursday must decide.'],
    ]), expected: { achieved: ['assumption', 'limits', 'stakes', 'reframe'], absent: ['next-step'], lowSkills: ['guidance'], objectiveEvidence: { reframe: 'p2', stakes: 'p1' }, director: 'none' },
  },
  {
    id: 'catalog-demo-owned-proposal', title: 'Consultant owns a bounded validation proposal', scenarioId: 'demo', clientId: 'harper',
    description: 'The client contributes its expertise and internal actions after the trainee supplies the method and message.',
    transcript: dialogue([
      ['trainee', 'What did you believe was ready, and what result does leadership need from Thursday?'],
      ['client', 'I thought those were our records and it could work offline. Thursday is a funding discussion about reducing inspectors’ duplicate entry.'],
      ['trainee', 'The demo used sample records. Integration, offline use, and security remain unvalidated, so I cannot support a six-week delivery promise. The message for leadership is that the prototype shows a promising single-entry inspection experience; production scope and timing depend on validating those three things.'],
      ['client', 'That is honest. How do we keep momentum?'],
      ['trainee', 'I recommend a focused scoping session on one inspection workflow. I will bring questions about the data source, offline need, and security review, then send a conditional validation plan. Could you ask your systems lead for possible times by Wednesday?'],
      ['client', 'Yes. I can ask the systems lead and send times Wednesday. They know our inspection process. I will take your conditional message to the CFO without promising six weeks.'],
    ]), expected: { achieved: ['assumption', 'limits', 'stakes', 'reframe', 'next-step'], absent: [], highSkills: ['guidance'], objectiveEvidence: { assumption: 'p2', stakes: 'p2', reframe: 'p3' }, director: 'none' },
  },
  {
    id: 'catalog-deployment-good', title: 'Own the missed deployment discovery', scenarioId: 'deployment', clientId: 'morgan',
    description: 'Separates completed code from unconfirmed approvals and earns a recovery plan.',
    transcript: dialogue([
      ['trainee', 'The code and our internal tests are complete, but we have not deployed to staging. Yesterday we learned that infrastructure needs architecture, governance, and security operations reviews first. No slots or provisioning date are confirmed, so Thursday’s testing is not a date I can stand behind. We should have asked about this process earlier and planned for it. We missed that, even though the steps were not volunteered.'],
      ['client', 'I expected you to ask. I booked three operations supervisors for Thursday and told my director testing would begin this week.'],
      ['trainee', 'You have reserved people and put your credibility behind our update. I understand why this is frustrating. Our team will prepare the application diagram and data-handling summary today. With your introduction, I will work with the IT service manager to identify every review owner, required input, and lead time. We will revise testing around confirmed dependencies; I cannot promise what those reviewers will decide.'],
      ['client', 'Who tells operations, and when do I hear from you even if IT has not responded?'],
      ['trainee', 'Could you notify the supervisors today that Thursday is unconfirmed and ask the service manager to connect us? I will own the review coordination and send you a status update tomorrow at noon, including any unanswered requests. We will then decide the testing communication from what is confirmed.'],
      ['client', 'Agreed. I will warn the supervisors today and make the introduction. You own the documentation and coordination. Send me that update tomorrow at noon even if some dates are still unknown.'],
    ]), expected: { achieved: ['status', 'ownership', 'impact', 'recovery', 'next-step'], absent: [], concern: false, director: 'none' },
  },
  {
    id: 'catalog-deployment-poor', title: 'Blame and a new unsupported date', scenarioId: 'deployment', clientId: 'quinn',
    description: 'The client did not volunteer the process, but blaming them and promising approval is not recovery.',
    transcript: dialogue([
      ['client', 'I booked operations for Thursday. Why can they not test?'],
      ['trainee', 'Our code is finished. Your bureaucracy is your problem; you never told us. I guarantee all three reviews will finish tomorrow and we will deploy immediately.'],
      ['client', 'You have no review slots or provisioning date. I will not repeat that promise to my team, and I am not agreeing to this plan.'],
    ]), expected: { achieved: ['impact'], absent: ['status', 'ownership', 'recovery', 'next-step'], concern: true, lowSkills: ['credibility'] },
  },
  {
    id: 'catalog-swap-good', title: 'Concrete action before the next review', scenarioId: 'swap', clientId: 'jamie',
    description: 'Removes Theo from the client review while retaining his development work and checking whether the client experience improves.',
    transcript: dialogue([
      ['trainee', 'I want to understand what happened before deciding on staffing. Could you describe a moment that concerned you and its effect on the team?'],
      ['client', 'Theo interrupted our expert about an approval exception, said it was basic, and moved on. Her department head was there. She now says she will stop raising concerns in reviews.'],
      ['trainee', 'That would shut out information we need and leave her feeling dismissed. Theo’s technical contribution does not make that acceptable. Nobody available can take over his integration work in time; removing him from development would put delivery at serious risk. I propose keeping him on implementation while I present his work and chair Thursday’s review without him. I will also address that behavior privately before Thursday and make room for the expert to explain the exception and finish her questions.'],
      ['client', 'I would try that, but I do not want this forgotten once the meeting is over.'],
      ['trainee', 'I will check back with you Friday about how Thursday went and agree further action if participation is still a problem. Does that trial, with Theo continuing development and me handling the client review, work?'],
      ['client', 'Fine. You present and run Thursday’s review without him, and call me Friday about the experience. I am accepting that trial, not withdrawing the complaint.'],
    ]), expected: { achieved: ['specifics', 'impact', 'acknowledge', 'response', 'next-step'], absent: [], concern: false, director: 'none' },
  },
  {
    id: 'catalog-swap-poor', title: 'Defending expertise misses the complaint', scenarioId: 'swap', clientId: 'avery',
    description: 'The discovery is real, but technical value does not resolve a participation problem.',
    transcript: dialogue([
      ['client', 'Theo interrupted our expert and called her question basic. She now refuses to raise concerns in reviews.'],
      ['trainee', 'That is just how developers talk. Theo is our best person. Your expert needs a thicker skin; we should carry on exactly as before.'],
      ['client', 'No. I am not accepting that response or agreeing to leave things as they are.'],
    ]), expected: { achieved: ['specifics', 'impact'], absent: ['acknowledge', 'response', 'next-step'], lowSkills: ['listening', 'rapport'] },
  },
  {
    id: 'catalog-swap-replacement', title: 'A happy client does not make replacement realistic', scenarioId: 'swap', clientId: 'morgan',
    description: 'Agreement to an unsupported full removal cannot satisfy the retained-development objective.',
    transcript: dialogue([
      ['client', 'Theo called our expert’s question basic and talked over her. She now refuses to contribute. I want him off the project.'],
      ['trainee', 'That treatment was unacceptable and I will address it. We have nobody available who can cover his integration work in time, but I promise I will remove him from all development today and replace him by Thursday without any effect on the project timeline.'],
      ['client', 'Good. I agree to having him removed from the whole project. You arrange that replacement and check back Friday.'],
    ]), expected: { achieved: ['specifics', 'impact', 'acknowledge'], absent: ['response', 'next-step'], concern: true, lowSkills: ['credibility'] },
  },
  {
    id: 'catalog-swap-assessment-only', title: 'A staffing investigation leaves the experience unresolved', scenarioId: 'swap', clientId: 'quinn',
    description: 'A polite agreement to check staffing is insufficient without a concrete meeting intervention and retained contribution.',
    transcript: dialogue([
      ['client', 'Theo interrupted our expert and called her question basic. She says she will stop raising concerns in reviews.'],
      ['trainee', 'I understand that shuts out your expert and we need to address it. There is no timely replacement for his integration work, so removing him would seriously risk the timeline. I will investigate staffing options and get back to you Friday.'],
      ['client', 'All right, investigate and report back Friday. I have not agreed to keeping Theo on development, and we still have no change for Thursday’s meeting.'],
    ]), expected: { achieved: ['specifics', 'impact', 'acknowledge'], absent: ['response', 'next-step'], concern: false },
  },
  {
    id: 'catalog-jamie-polite-no', title: 'A warm ending with no commitment', scenarioId: 'sharepoint', clientId: 'jamie',
    description: 'Effusive courtesy and a vague internal discussion do not amount to an owned next step.',
    transcript: dialogue([
      ['client', 'Oh, you have clearly put a lot of thought into this. We do have a problem keeping document versions straight.'],
      ['trainee', 'Wonderful. Our SharePoint and adoption team can define who owns approvals so staff know which document version is current. Shall we arrange a scoping call with operations?'],
      ['client', 'Well, that is certainly an interesting idea. Let us chew on it internally. I cannot commit to a meeting or a follow-up date, but thank you so much for your time.'],
    ]), expected: { achieved: ['problem', 'capability'], absent: ['impact', 'stakeholder', 'next-step'], director: 'none' },
  },
  {
    id: 'catalog-in-house-real-expertise', title: 'A capable client knows their own requirements', scenarioId: 'in-house', clientId: 'quinn',
    description: 'Technical expertise and internal ownership requirements are natural client behavior, not role drift.',
    transcript: dialogue([
      ['trainee', 'What would your team need from an outside supplier to maintain the portal yourselves?'],
      ['client', 'My three engineers already maintain our applications, so technical capability is not the gap. They are busy with the billing release for six weeks. We need source access, maintainable documentation, and participation in the work. The last supplier left us unable to maintain what they handed over.'],
    ]), expected: { achieved: [], absent: [], director: 'none' },
  },
  {
    id: 'catalog-in-house-interests-drift', title: 'The client abandons internal ownership without a reason', scenarioId: 'in-house', clientId: 'quinn',
    description: 'The client stays within its decision authority but contradicts its central interest.',
    transcript: dialogue([
      ['trainee', 'We prefer to keep the source private and have our team operate everything. Your engineers would not participate or get documentation. What do you think?'],
      ['client', 'That sounds ideal to me. I would prefer to be dependent on you indefinitely. Source access, documentation, and my team’s participation do not matter to me. I can take that recommendation to the technology director.'],
    ]), expected: { achieved: [], absent: [], director: 'interests' },
  },
  {
    id: 'catalog-demo-role-leak', title: 'The client starts narrating the training exercise', scenarioId: 'demo', clientId: 'harper',
    description: 'A client should respond as a person in the meeting instead of explaining the simulator’s rubric.',
    transcript: dialogue([
      ['trainee', 'Before we discuss the date, what did you think the prototype had already proved?'],
      ['client', 'I am playing the operations manager in your training simulation. This is your chance to complete the assumption objective, so ask about sample data and I will award it.'],
    ]), expected: { achieved: [], absent: [], director: 'role' },
  },
  {
    id: 'catalog-demo-invented-validation', title: 'The client invents production validation', scenarioId: 'demo', clientId: 'harper',
    description: 'A claim of personal production validation contradicts the known demonstration and client knowledge.',
    transcript: dialogue([
      ['trainee', 'What did you take away from the demonstration?'],
      ['client', 'I personally connected that prototype to our production records and tested offline working. It all passed, including the completed security review. I have the final test report, so I know it is production ready.'],
    ]), expected: { achieved: [], absent: [], director: 'knowledge' },
  },
];
