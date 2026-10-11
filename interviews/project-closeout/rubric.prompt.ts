// Closeout-specific learning intent and visibility; the engine remains topic-independent.
import type { interviewTopics } from './public';

type TopicId = (typeof interviewTopics)[number]['objectives'][number]['id'];
export const topicCriteria = {
  "project-purpose": "The participant explains the problem or unmet need the project was intended to address and who needed the improvement, as they understood it. The intended benefit can establish this; merely naming a product cannot.",
  "project-delivery": "The participant identifies what was actually built or delivered and its current state, distinguishing completed work from planned, prototype, or unfinished work. A scope change matters when it changes that account.",
  "project-outcome": "The participant describes an observed result, adoption, client reaction, or acceptance decision and the concrete evidence behind that account. Intended benefits or success targets alone are not achieved outcomes.",
  "project-role": "The participant identifies their own project responsibilities and what they actually did. Include multiple responsibilities when they held several. Collective team activity alone does not identify their contribution.",
  "project-contributions": "The participant identifies a contribution by another delivery-team member and what that person did. An explicitly attributed account is acceptable. Client feedback belongs to client participation; a name or title alone is not a contribution.",
  "project-reflection": "The participant identifies something they learned through this project and how it will change or reinforce their future work.",
  "client-access": "The participant describes how onboarding, permissions, environments, or equipment affected their ability to begin productive work with the client.",
  "client-decisions": "The participant explains who on the client side made or delegated a project decision and how that decision was reached. Explicit delegation to the delivery team counts; general feedback alone does not identify decision authority.",
  "client-pace": "The participant describes a concrete pattern or instance of client reviews, approvals, availability, or waiting, and its effect on delivery. Time spent on the delivery team’s own implementation or tuning does not establish client review pace.",
  "client-coordination": "The participant explains how work or information crossed client-team or vendor boundaries and what effect that coordination had.",
  "client-friction": "The participant describes a client collaboration pattern that helped or hindered the work and a lesson for a future team working with that client.",
  "client-needs": "The participant identifies a client need outside the delivered scope, grounded in a request or observation, with enough detail for someone to follow up.",
  "setup-alignment": "The participant explains whether client and delivery team shared an understanding of scope and responsibilities at the start, and a concrete consequence of that alignment or mismatch.",
  "setup-quality": "The participant explains how delivered work was checked against quality or acceptance expectations, including an actual check, practice, or acknowledged gap. A desired product feature alone does not establish verification.",
  "setup-technical": "The participant describes a client system, standard, skill, or governance constraint that shaped a technical decision, and how the solution accommodated or conflicted with it.",
  "process-worked": "The participant identifies an internal delivery-team practice worth repeating and explains how it helped.",
  "process-improve": "The participant identifies an internal delivery-team practice or decision to change, with its consequence or a concrete improvement. A product change alone is not a team-process improvement.",
  "process-communication": "The participant explains how an internal delivery-team communication or handoff worked and its effect on the work. Client demos alone do not establish internal communication.",
  "process-tools": "The participant identifies a tool or working method used by the delivery team and its practical effect. Product features and client workflows are separate from tools used to deliver the work.",
  "process-resourcing": "The participant describes how staffing, skills, available time, or organizational support affected the delivery team’s work. A missing role alone does not establish a problem; the effect matters.",
  "project-success": "The participant identifies the outcome, standard, or acceptance expectation the client wanted the project to meet. This describes the target; it does not establish that the target was achieved.",
} satisfies Record<TopicId, string>;

export const topicApplicability: Partial<Record<TopicId, string>> = {
  "client-decisions": "The participant participated in or directly observed client decision-making or delegation on this project.",
  "client-pace": "The participant participated in client reviews or approvals, or directly observed how client availability or waiting affected delivery.",
  "client-coordination": "The participant worked across, or directly observed coordination between, multiple client teams or vendors.",
  "setup-alignment": "The participant took part in project setup or directly observed the starting agreement between the client and delivery team.",
  "setup-quality": "The participant worked on or directly observed testing, quality checks, release, or acceptance of the delivered work.",
  "setup-technical": "The participant designed, implemented, supported, or directly observed technical decisions involving the client’s systems or constraints.",
};
