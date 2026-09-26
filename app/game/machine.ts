import { createMachine } from "xstate";

export const gameMachine = createMachine({
  id: "performance",
  initial: "idle",
  on: { RESET: ".idle" },
  states: {
    idle: { on: { SPIN: "preparing" } },
    preparing: { on: { START: "starting", RESET: "idle" } },
    starting: { on: { READY: "performing", FAIL: "interrupted", CANCEL: "preparing" } },
    performing: { on: { WIN: "result", GIVE_UP: "result", FAIL: "interrupted" } },
    result: { on: { RESET: "idle" } },
    interrupted: { on: { RETRY: "starting", RESET: "idle" } },
  },
});
