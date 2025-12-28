'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Components } from 'react-markdown';

interface Props {
  markdown: string;
  completedSteps: number[];
  onToggleStep: (stepIndex: number) => void;
}

export default function MarkdownInstructions({ markdown, completedSteps, onToggleStep }: Props) {
  // Track checkbox index as we render
  let checkboxIndex = -1;

  const components: Components = {
    input: ({ type, checked, ...props }) => {
      if (type === 'checkbox') {
        checkboxIndex++;
        const currentIndex = checkboxIndex;
        const isCompleted = completedSteps.includes(currentIndex);

        return (
          <input
            type="checkbox"
            checked={isCompleted}
            onChange={() => onToggleStep(currentIndex)}
            style={{
              width: '20px',
              height: '20px',
              marginRight: '8px',
              cursor: 'pointer',
              accentColor: 'var(--accent)',
            }}
            {...props}
          />
        );
      }
      return <input type={type} checked={checked} {...props} />;
    },
    // Style list items with checkboxes for better touch targets
    li: ({ children, ...props }) => {
      const hasCheckbox = Array.isArray(children) &&
        children.some((child: unknown) =>
          child && typeof child === 'object' && 'props' in child &&
          (child as { props?: { type?: string } }).props?.type === 'checkbox'
        );

      return (
        <li
          style={{
            listStyle: hasCheckbox ? 'none' : undefined,
            padding: hasCheckbox ? '0.5rem 0' : undefined,
            minHeight: hasCheckbox ? '44px' : undefined,
            display: hasCheckbox ? 'flex' : undefined,
            alignItems: hasCheckbox ? 'flex-start' : undefined,
          }}
          {...props}
        >
          {children}
        </li>
      );
    },
    // Remove default padding from ul containing checkboxes
    ul: ({ children, ...props }) => {
      return (
        <ul
          style={{
            paddingLeft: '1.5em',
            margin: '0.5em 0',
          }}
          {...props}
        >
          {children}
        </ul>
      );
    },
    ol: ({ children, ...props }) => {
      return (
        <ol
          style={{
            paddingLeft: '1.5em',
            margin: '0.5em 0',
          }}
          {...props}
        >
          {children}
        </ol>
      );
    },
  };

  return (
    <div style={{
      fontSize: '16px',
      lineHeight: '1.6',
      color: 'var(--text-primary)',
    }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
