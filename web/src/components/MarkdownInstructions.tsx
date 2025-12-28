'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Components } from 'react-markdown';
import styles from './MarkdownInstructions.module.css';

interface Props {
  markdown: string;
  completedSteps: number[];
  onToggleStep: (stepIndex: number) => void;
}

// Custom li component that receives itemNumber prop from ol parent
function CheckboxListItem({
  children,
  itemNumber,
  isCompleted,
  handleToggle,
}: {
  children: React.ReactNode;
  itemNumber?: number;
  isCompleted: boolean;
  handleToggle: () => void;
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
    <li className={styles.listItem}>
      {itemNumber !== undefined && (
        <span className={styles.itemNumber}>
          {itemNumber}.
        </span>
      )}
      <input
        type="checkbox"
        checked={isCompleted}
        onChange={handleToggle}
        className={styles.checkbox}
      />
      <span className={styles.itemContent}>{filteredChildren}</span>
    </li>
  );
}

export default function MarkdownInstructions({ markdown, completedSteps, onToggleStep }: Props) {
  // Track step index as we render list items (all list items get checkboxes)
  let stepIndex = -1;

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
          isCompleted={isCompleted}
          handleToggle={() => onToggleStep(currentIndex)}
          {...props}
        >
          {children}
        </CheckboxListItem>
      );
    },
    // Style lists for checkbox items - ul doesn't show numbers
    ul: ({ children, ...props }) => {
      return (
        <ul className={styles.list} {...props}>
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
        <ol className={styles.list} {...props}>
          {numberedChildren}
        </ol>
      );
    },
  };

  return (
    <div className={styles.container}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
