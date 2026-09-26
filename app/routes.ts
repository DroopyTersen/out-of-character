import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [index("routes/game.tsx"), route("simulator", "routes/simulator.tsx"), route("storybook/*", "routes/storybook.tsx")] satisfies RouteConfig;
