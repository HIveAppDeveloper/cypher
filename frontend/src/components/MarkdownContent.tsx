import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const plugins = [remarkGfm];
const components = {
  a: ({ children, href }: React.ComponentProps<'a'>) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
  img: ({ alt }: React.ComponentProps<'img'>) => <span>{alt || 'Image'}</span>,
};

export default function MarkdownContent({ children }: { children: string }) {
  return <ReactMarkdown remarkPlugins={plugins} skipHtml components={components}>{children}</ReactMarkdown>;
}
