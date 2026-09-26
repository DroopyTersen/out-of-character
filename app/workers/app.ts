import { createRequestHandler } from "react-router";
import { handleApi } from "../server/api";

declare module "react-router" {
  export interface AppLoadContext { cloudflare: { env: Env; ctx: ExecutionContext } }
}
const handler = createRequestHandler(() => import("virtual:react-router/server-build"), import.meta.env.MODE);
export default {
  async fetch(request, env, ctx) {
    const response = await handleApi(request, env);
    return response ?? handler(request, { cloudflare: { env, ctx } });
  },
} satisfies ExportedHandler<Env>;
