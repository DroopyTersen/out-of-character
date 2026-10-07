import { createRequestHandler } from "react-router";
import { handleApi } from "../server/api";
import { handleInterview } from '../server/interview/routes';
import { handleSimulator } from '../server/simulator/api';
import { serveBriefingAudio } from '../server/briefing-audio';
export { SimulatorSession } from '../server/simulator/session';
export { InterviewObject } from '../server/interview/durableObject';

declare module "react-router" {
  export interface AppLoadContext { cloudflare: { env: Env; ctx: ExecutionContext } }
}
const handler = createRequestHandler(() => import("virtual:react-router/server-build"), import.meta.env.MODE);
export default {
  async fetch(request, env, ctx) {
    if (/^\/simulator\/briefings\/[^/]+\.mp3$/.test(new URL(request.url).pathname)) return serveBriefingAudio(request, env.ASSETS);
    const response = await handleInterview(request, env) ?? await handleSimulator(request, env) ?? await handleApi(request, env);
    return response ?? handler(request, { cloudflare: { env, ctx } });
  },
} satisfies ExportedHandler<Env>;
