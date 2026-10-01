import { Streamdown } from 'streamdown';
import { mermaid } from '@streamdown/mermaid';

export default function SummaryMarkdown({ text, writing }: { text: string; writing: boolean }) {
  return <Streamdown className="interview-summary-text" plugins={{ mermaid }} mermaid={{ config: { theme: 'dark', securityLevel: 'strict' } }} isAnimating={writing} skipHtml disallowedElements={['img']}>{text}</Streamdown>;
}
