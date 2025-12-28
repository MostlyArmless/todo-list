'use client';

import { ButtonHTMLAttributes, ReactNode } from 'react';

type IconButtonVariant = 'default' | 'accent' | 'danger';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: IconButtonVariant;
  size?: 'sm' | 'md';
}

const variantStyles: Record<IconButtonVariant, { color: string; hoverBg: string }> = {
  default: {
    color: 'var(--text-secondary)',
    hoverBg: 'rgba(255, 255, 255, 0.1)',
  },
  accent: {
    color: 'var(--accent)',
    hoverBg: 'rgba(233, 69, 96, 0.15)',
  },
  danger: {
    color: 'var(--danger)',
    hoverBg: 'rgba(239, 68, 68, 0.15)',
  },
};

const sizeStyles: Record<'sm' | 'md', { padding: string; iconSize: string }> = {
  sm: { padding: '0.25rem', iconSize: '14px' },
  md: { padding: '0.5rem', iconSize: '20px' },
};

export default function IconButton({
  children,
  variant = 'default',
  size = 'md',
  style,
  ...props
}: IconButtonProps) {
  const { color, hoverBg } = variantStyles[variant];
  const { padding } = sizeStyles[size];

  return (
    <button
      {...props}
      style={{
        color,
        padding,
        borderRadius: '0.375rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all 0.15s ease',
        flexShrink: 0,
        ...style,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = hoverBg;
        e.currentTarget.style.transform = 'scale(1.1)';
        props.onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'transparent';
        e.currentTarget.style.transform = 'scale(1)';
        props.onMouseLeave?.(e);
      }}
    >
      {children}
    </button>
  );
}
