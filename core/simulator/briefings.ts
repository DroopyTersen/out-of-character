export type ScenarioBriefing = { speaker: string; text: string; audio: string };

// Give the trainee their role, known situation and constraints, not a strategy
// or objective checklist. These recordings never become part of the client's
// conversation history or the transcript used for scoring.
export const scenarioBriefings: Record<string, ScenarioBriefing> = {
  sharepoint: {
    speaker: 'Your colleague',
    text: 'Quick handover before your call. We are already building a custom application for this client, and you are their account contact. The software project looks on track, but we have a lead that they may also need help with SharePoint. Our team works on collaboration and adoption as well as custom software. We do not have much detail on the SharePoint side yet. You have a check-in with their IT director.',
    audio: '/simulator/briefings/sharepoint.mp3',
  },
  scope: {
    speaker: 'Your colleague',
    text: 'Here is where we are. You are the technical lead on our custom software project, and the release is due in ten days. The client now wants a reporting dashboard added and thinks it should be a small change. It is outside the agreed scope, the release is already full, and we have not estimated the dashboard. The product owner is responsible for release priorities. The client has asked for this call to discuss the request.',
    audio: '/simulator/briefings/scope.mp3',
  },
  proposal: {
    speaker: 'Your colleague',
    text: 'You are meeting a prospective client as our solution consultant. All we have so far is a short request for an application to replace their customer-service spreadsheet. They want a fixed-price proposal by Friday. Beyond that request, we have not done discovery or agreed a scope with them. There is no approved price, staffing commitment, or delivery date. This is your first proper conversation with them about the application.',
    audio: '/simulator/briefings/proposal.mp3',
  },
  'in-house': {
    speaker: 'Your colleague',
    text: 'A quick heads-up before the introduction. This client already has an engineering team that builds their applications and knows their business. Their leadership suggested talking to us about an order-status portal. You are representing our consultancy in the conversation with their IT manager. We have not agreed a role for an outside team, and there is no commitment yet on people, price, or a delivery date.',
    audio: '/simulator/briefings/in-house.mp3',
  },
  courtesy: {
    speaker: 'Your colleague',
    text: 'You have been handling our proposal for this client’s intranet work. They have asked for a call before sending the formal decision and are leaning toward another firm, largely on price. Our proposal includes content inventory and cleanup, implementation, and training for site owners. The other firm’s total is roughly a third lower, but we have not seen their scope. Neither proposal has been signed. Any discount on our price needs internal approval; you do not have that authority on this call.',
    audio: '/simulator/briefings/courtesy.mp3',
  },
  demo: {
    speaker: 'Your colleague',
    text: 'The field-inspection prototype made a strong impression, and you are the technical consultant following up with the client. Those polished screens used sample data. Integration, offline work, and security have not been validated. There is no approved production scope, estimate, or delivery promise. You are meeting the operations manager who championed it. Their director meets the CFO on Thursday, and they want to tell her it can be delivered in six weeks. That timing has not been estimated or agreed with our team.',
    audio: '/simulator/briefings/demo.mp3',
  },
  deployment: {
    speaker: 'Your colleague',
    text: 'Before you meet the sponsor, here is the situation. You lead our delivery team on a bulk-order approval feature for the client’s purchasing application. It is Tuesday, and user testing was supposed to start Thursday. Development and our internal tests are finished, but the feature is not in their staging environment. Yesterday we discovered required architecture, governance, and security reviews. No review slots or deployment date are confirmed. Our delivery plan had not accounted for those reviews. Our last update said we were on track, so the sponsor has not heard about the delay yet.',
    audio: '/simulator/briefings/deployment.mp3',
  },
  swap: {
    speaker: 'Your colleague',
    text: 'You are our engagement manager, and the client has asked for a private conversation about Theo, our lead developer. They want him replaced after difficult sprint reviews. Theo is personally doing critical integration work, and we have nobody who can take over his expertise quickly enough. Pulling him out of development would put the project timeline at serious risk. You manage our team’s work on this engagement, including client meetings and conduct. The client has asked to speak with you directly about what has been happening.',
    audio: '/simulator/briefings/swap.mp3',
  },
  'happy-hour': {
    speaker: 'Your colleague',
    text: 'We are hosting a casual happy hour with some of our clients. You are there as one of the consultants, and you have just met a client guest by the drinks. It is a social get-together away from the usual project meetings.',
    audio: '/simulator/briefings/happy-hour.mp3',
  },
};
