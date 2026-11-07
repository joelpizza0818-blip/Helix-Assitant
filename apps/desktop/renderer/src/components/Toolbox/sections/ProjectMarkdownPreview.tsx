import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'

interface Props {
  content: string
}

export default function ProjectMarkdownPreview({ content }: Props) {
  return (
    <article className="project-file-editor__preview">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {content}
      </ReactMarkdown>
    </article>
  )
}
