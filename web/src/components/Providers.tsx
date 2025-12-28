'use client';

import { ReactNode } from 'react';
import { ConfirmDialogProvider } from './ConfirmDialog';

export default function Providers({ children }: { children: ReactNode }) {
  return <ConfirmDialogProvider>{children}</ConfirmDialogProvider>;
}
