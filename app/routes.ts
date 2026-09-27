import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [index("routes/game.tsx"), route("simulator", "routes/simulator.tsx"), route("simulator/voice-lab", "routes/voice-lab.tsx"), route("interview", "routes/interview.tsx"), route("storybook/*", "routes/storybook.tsx")] satisfies RouteConfig;
