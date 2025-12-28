import { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './IconButton.module.css';

type IconButtonVariant = 'default' | 'accent' | 'danger';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: IconButtonVariant;
  size?: 'sm' | 'md';
}

const variantClasses: Record<IconButtonVariant, string> = {
  default: styles.variantDefault,
  accent: styles.variantAccent,
  danger: styles.variantDanger,
};

const sizeClasses: Record<'sm' | 'md', string> = {
  sm: styles.sizeSm,
  md: styles.sizeMd,
};

export default function IconButton({
  children,
  variant = 'default',
  size = 'md',
  className,
  ...props
}: IconButtonProps) {
  const classes = [
    styles.iconButton,
    variantClasses[variant],
    sizeClasses[size],
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button {...props} className={classes}>
      {children}
    </button>
  );
}
