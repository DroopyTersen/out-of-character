// Adapted from Vercel AI Elements (Apache-2.0); see THIRD_PARTY_NOTICES.md.
// Capture is controlled by the game's one streaming controller instead of this button.
import { Button } from "~/shadcn/components/ui/button";
import { Spinner } from "~/shadcn/components/ui/spinner";
import { MicIcon, SquareIcon } from "lucide-react";
import type { ComponentProps } from "react";

export function SpeechInput({ listening, connecting = false, children, ...props }: ComponentProps<typeof Button> & { listening: boolean; connecting?: boolean }) {
  return <Button type="button" variant="outline" aria-pressed={listening} {...props}>
    {connecting ? <Spinner /> : listening ? <SquareIcon size={16} /> : <MicIcon size={16} />}
    {children ?? (connecting ? "Connecting…" : listening ? "Stop test" : "Test audio")}
  </Button>;
}
