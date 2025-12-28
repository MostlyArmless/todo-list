'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Components } from 'react-markdown';

interface Props {
  markdown: string;
  completedSteps: number[];
  onToggleStep: (stepIndex: number) => void;
}

// Custom li component that receives itemNumber prop from ol parent
function CheckboxListItem({
  children,
  itemNumber,
  stepIndex,
  isCompleted,
  handleToggle,
  checkboxStyle,
}: {
  children: React.ReactNode;
  itemNumber?: number;
  stepIndex: number;
  isCompleted: boolean;
  handleToggle: () => void;
  checkboxStyle: React.CSSProperties;
  [key: string]: unknown;
}) {
  // Filter out any existing checkbox inputs from children
  const filteredChildren = Array.isArray(children)
    ? children.filter((child: unknown) => {
        if (child && typeof child === 'object' && 'props' in child) {
          const typedChild = child as { props?: { type?: string } };
          return typedChild.props?.type !== 'checkbox';
        }
        return true;
      })
    : children;

  return (
    <li
      style={{
        listStyle: 'none',
        padding: '0.5rem 0',
        minHeight: '44px',
        display: 'flex',
        alignItems: 'flex-start',
      }}
    >
      {itemNumber !== undefined && (
        <span style={{
          minWidth: '28px',
          marginRight: '4px',
          fontWeight: 500,
          color: 'var(--text-secondary)',
          flexShrink: 0,
        }}>
          {itemNumber}.
        </span>
      )}
      <input
        type="checkbox"
        checked={isCompleted}
        onChange={handleToggle}
        style={checkboxStyle}
      />
      <span style={{ flex: 1 }}>{filteredChildren}</span>
    </li>
  );
}

export default function MarkdownInstructions({ markdown, completedSteps, onToggleStep }: Props) {
  // Track step index as we render list items (all list items get checkboxes)
  let stepIndex = -1;

  // Checkbox styles shared across all list items
  const checkboxStyle: React.CSSProperties = {
    width: '20px',
    height: '20px',
    marginRight: '8px',
    cursor: 'pointer',
    accentColor: 'var(--accent)',
    flexShrink: 0,
  };

  const components: Components = {
    // Ignore any existing checkbox inputs from markdown task list syntax
    // since we're adding our own checkboxes to ALL list items
    input: ({ type, ...props }) => {
      if (type === 'checkbox') {
        // Skip rendering - the li handler adds checkboxes for all items
        return null;
      }
      return <input type={type} {...props} />;
    },
    // Add checkbox to ALL list items for step tracking
    li: ({ children, ...props }) => {
      stepIndex++;
      const currentIndex = stepIndex;
      const isCompleted = completedSteps.includes(currentIndex);

      return (
        <CheckboxListItem
          stepIndex={currentIndex}
          isCompleted={isCompleted}
          handleToggle={() => onToggleStep(currentIndex)}
          checkboxStyle={checkboxStyle}
          {...props}
        >
          {children}
        </CheckboxListItem>
      );
    },
    // Style lists for checkbox items - ul doesn't show numbers
    ul: ({ children, ...props }) => {
      return (
        <ul
          style={{
            paddingLeft: '0.5em',
            margin: '0.5em 0',
          }}
          {...props}
        >
          {children}
        </ul>
      );
    },
    // For ordered lists, add item numbers to each li
    ol: ({ children, ...props }) => {
      let counter = 0;
      // Add itemNumber to each li child
      const numberedChildren = React.Children.map(children, (child) => {
        if (React.isValidElement(child)) {
          counter++;
          return React.cloneElement(child as React.ReactElement<{ itemNumber?: number }>, {
            itemNumber: counter,
          });
        }
        return child;
      });

      return (
        <ol
          style={{
            paddingLeft: '0.5em',
            margin: '0.5em 0',
          }}
          {...props}
        >
          {numberedChildren}
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
