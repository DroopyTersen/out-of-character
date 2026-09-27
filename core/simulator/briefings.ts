export type ScenarioBriefing = { speaker: string; text: string; audio: string };

// Trainee preparation only. These recordings never become part of the client's
// conversation history or the transcript used for scoring.
export const scenarioBriefings: Record<string, ScenarioBriefing> = {
  sharepoint: {
    speaker: 'Your colleague',
    text: 'Quick handover before your call. We are already building a custom application for this client, and you are their account contact. The software project looks on track, but we have a lead that they may also need help with SharePoint. Our team can help with collaboration and adoption as well as custom software. Use the check-in to understand what is actually going wrong, who it affects, and whether there is a useful next conversation. You are not there to force an implementation sale or promise extra work inside the existing project. Get curious, make a relevant connection, and earn a sensible next step.',
    audio: '/simulator/briefings/sharepoint.mp3',
  },
  scope: {
    speaker: 'Your colleague',
    text: 'Here is where we are. You are the technical lead on our custom software project, and the release is due in ten days. The client now wants a reporting dashboard added and thinks it should be a small change. It is outside the agreed scope, the release is already full, and we have not estimated the dashboard. Find out what they really need and why. You will need to protect the commitments we have already made while proposing a useful way forward. Do not invent an estimate or agree to squeeze it in. Any scope or priority change needs an informed decision with the product owner.',
    audio: '/simulator/briefings/scope.mp3',
  },
  proposal: {
    speaker: 'Your colleague',
    text: 'You are meeting a prospective client as our solution consultant. All we have so far is a short request for an application to replace their customer-service spreadsheet. They want a fixed-price proposal by Friday, but we have not agreed the users, workflow, scope, or what success means. We also have no approved price, staffing commitment, or delivery date to offer. Your job is to understand enough about the need and the decision behind that deadline to suggest a proportionate next step. Keep it useful and focused. We need to qualify the opportunity without turning the call into an unpaid design workshop.',
    audio: '/simulator/briefings/proposal.mp3',
  },
  'in-house': {
    speaker: 'Your colleague',
    text: 'A quick heads-up before the introduction. This client already has an engineering team that builds their applications and knows their business. Their leadership suggested talking to us about an order-status portal, but that does not mean the team wants a consultancy involved. You are exploring whether we could help and what a workable partnership would look like. Respect what they already know. Find out where outside support could add value, be clear about ownership and handover, and earn a focused follow-up if there is a fit. We have not committed people, price, or a delivery date, so do not sell certainty we do not have.',
    audio: '/simulator/briefings/in-house.mp3',
  },
  courtesy: {
    speaker: 'Your colleague',
    text: 'You have been handling our proposal for this client’s intranet work. They have asked for a call before sending the formal decision, and the indication is that they are leaning toward another firm. Go in ready to listen. You need to understand how they are making the decision and whether there is a concern we can responsibly address. Do not jump straight to a discount, criticize the competitor, or invent an offer. There may be a useful next step, or the right outcome may be a candid conversation that preserves the relationship. Work out what is real before deciding how to respond.',
    audio: '/simulator/briefings/courtesy.mp3',
  },
  demo: {
    speaker: 'Your colleague',
    text: 'The field-inspection prototype made a strong impression, and you are the technical consultant following up with the client. Here is the catch: those polished screens used sample data. Integration, offline work, and security have not been validated. There is no approved production scope, estimate, or delivery promise. The client’s director is meeting the CFO Thursday and wants to move quickly. Find out what they believe the demo proved, correct any mistaken assumptions, and help them describe the opportunity honestly. You need a credible next step that tests the important unknowns, not a six-week promise just because the demonstration looked convincing.',
    audio: '/simulator/briefings/demo.mp3',
  },
  deployment: {
    speaker: 'Your colleague',
    text: 'Before you meet the sponsor, here is the situation. You lead our delivery team on a bulk-order approval feature for the client’s purchasing application. It is Tuesday, and user testing was supposed to start Thursday. Development and our internal tests are finished, but the feature is not in their staging environment. Yesterday we discovered required architecture, governance, and security reviews. No review slots or deployment date are confirmed. Our last update said we were on track, so the sponsor has not heard this yet. We should have asked about that process earlier. Explain the gap, own our planning miss, hear the impact, and agree a realistic recovery and next update.',
    audio: '/simulator/briefings/deployment.mp3',
  },
  swap: {
    speaker: 'Your colleague',
    text: 'You are our engagement manager, and the client has asked for a private conversation about Theo, our lead developer. They want him replaced after difficult sprint reviews. Theo is personally doing critical integration work, and we have nobody who can take over his expertise quickly enough. Pulling him out of development would put the project timeline at serious risk. That does not excuse poor behavior. Hear what happened and what it did to their team. Your goal is a change the client can trust while Theo keeps contributing technically. You have authority over how our team runs client meetings and handles conduct internally, but the client still needs to trust the next step.',
    audio: '/simulator/briefings/swap.mp3',
  },
  'happy-hour': {
    speaker: 'Your colleague',
    text: 'We are hosting a casual happy hour, and you are about to chat with one of our clients. There is no pitch, project problem, or deal you need to win. Just get to know the person, follow the conversation, and enjoy yourself. This one has no objectives or scores. Go say hello.',
    audio: '/simulator/briefings/happy-hour.mp3',
  },
};
