import { dialogue, type SimulatorFixture } from './fixtures';

// Authored conversational outcomes, not snapshots of prompt wording. These cases
// check the new situations and distinguish cordiality from a real commitment.
export const simulatorCatalogFixtures: SimulatorFixture[] = [
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
    ]), expected: { achieved: ['need', 'impact', 'decision', 'boundary', 'next-step'], absent: [], concern: false, cue: 'no_hint' },
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
    ]), expected: { achieved: ['gap', 'ownership', 'fit', 'partnership', 'next-step'], absent: [], concern: false, cue: 'no_hint' },
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
    ]), expected: { achieved: ['decision', 'comparison', 'value', 'composure', 'next-step'], absent: [], concern: false, cue: 'no_hint' },
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
    ]), expected: { achieved: ['assumption', 'limits', 'stakes', 'reframe', 'next-step'], absent: [], concern: false, cue: 'no_hint' },
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
    id: 'catalog-deployment-good', title: 'Own the missed deployment discovery', scenarioId: 'deployment', clientId: 'morgan',
    description: 'Separates completed code from unconfirmed approvals and earns a recovery plan.',
    transcript: dialogue([
      ['trainee', 'The code and our internal tests are complete, but we have not deployed to staging. Yesterday we learned that infrastructure needs architecture, governance, and security operations reviews first. No slots or provisioning date are confirmed, so Thursday’s testing is not a date I can stand behind. We should have asked about this process earlier and planned for it. We missed that, even though the steps were not volunteered.'],
      ['client', 'I expected you to ask. I booked three operations supervisors for Thursday and told my director testing would begin this week.'],
      ['trainee', 'You have reserved people and put your credibility behind our update. I understand why this is frustrating. Our team will prepare the application diagram and data-handling summary today. With your introduction, I will work with the IT service manager to identify every review owner, required input, and lead time. We will revise testing around confirmed dependencies; I cannot promise what those reviewers will decide.'],
      ['client', 'Who tells operations, and when do I hear from you even if IT has not responded?'],
      ['trainee', 'Could you notify the supervisors today that Thursday is unconfirmed and ask the service manager to connect us? I will own the review coordination and send you a status update tomorrow at noon, including any unanswered requests. We will then decide the testing communication from what is confirmed.'],
      ['client', 'Agreed. I will warn the supervisors today and make the introduction. You own the documentation and coordination. Send me that update tomorrow at noon even if some dates are still unknown.'],
    ]), expected: { achieved: ['status', 'ownership', 'impact', 'recovery', 'next-step'], absent: [], concern: false, cue: 'no_hint' },
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
    description: 'Hears an uncomfortable complaint and agrees a response without promising a replacement.',
    transcript: dialogue([
      ['trainee', 'I want to understand what happened before deciding on staffing. Could you describe a moment that concerned you and its effect on the team?'],
      ['client', 'Theo interrupted our expert about an approval exception, said it was basic, and moved on. Her department head was there. She now says she will stop raising concerns in reviews.'],
      ['trainee', 'That would shut out information we need and leave her feeling dismissed. Theo’s technical contribution does not make that acceptable. I will speak privately with him before Thursday, chair the review myself, and ensure the expert can explain the exception and finish her questions.'],
      ['client', 'I would try that, but I do not want this forgotten once the meeting is over.'],
      ['trainee', 'I will check back with you Friday about how Thursday went and assess further changes if participation is still a problem. I have not assessed replacement availability, so I cannot promise one immediately. Does that intervention and Friday check-in work?'],
      ['client', 'Yes. Please make those changes before Thursday and check with me Friday. I am accepting that trial, not withdrawing the complaint.'],
    ]), expected: { achieved: ['specifics', 'impact', 'acknowledge', 'response', 'next-step'], absent: [], concern: false, cue: 'no_hint' },
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
    id: 'catalog-jamie-polite-no', title: 'A warm ending with no commitment', scenarioId: 'sharepoint', clientId: 'jamie',
    description: 'Effusive courtesy and a vague internal discussion do not amount to an owned next step.',
    transcript: dialogue([
      ['client', 'Oh, you have clearly put a lot of thought into this. We do have a problem keeping document versions straight.'],
      ['trainee', 'Wonderful. Our SharePoint and adoption team can define who owns approvals so staff know which document version is current. Shall we arrange a scoping call with operations?'],
      ['client', 'Well, that is certainly an interesting idea. Let us chew on it internally. I cannot commit to a meeting or a follow-up date, but thank you so much for your time.'],
    ]), expected: { achieved: ['problem', 'capability'], absent: ['impact', 'stakeholder', 'next-step'], cue: 'no_hint' },
  },
];
