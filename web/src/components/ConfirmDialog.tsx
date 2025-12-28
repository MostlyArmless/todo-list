'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import styles from './ConfirmDialog.module.css';

interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'primary';
}

interface AlertOptions {
  title?: string;
  message: string;
  buttonText?: string;
}

interface ConfirmDialogContextType {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  alert: (options: AlertOptions) => Promise<void>;
}

const ConfirmDialogContext = createContext<ConfirmDialogContextType | null>(null);

export function useConfirmDialog() {
  const context = useContext(ConfirmDialogContext);
  if (!context) {
    throw new Error('useConfirmDialog must be used within a ConfirmDialogProvider');
  }
  return context;
}

interface DialogState {
  type: 'confirm' | 'alert';
  options: ConfirmOptions | AlertOptions;
  resolve: (value: boolean) => void;
}

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<DialogState | null>(null);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setDialog({ type: 'confirm', options, resolve });
    });
  }, []);

  const alert = useCallback((options: AlertOptions): Promise<void> => {
    return new Promise((resolve) => {
      setDialog({
        type: 'alert',
        options,
        resolve: () => resolve(),
      });
    });
  }, []);

  const handleConfirm = () => {
    dialog?.resolve(true);
    setDialog(null);
  };

  const handleCancel = () => {
    dialog?.resolve(false);
    setDialog(null);
  };

  const isConfirm = dialog?.type === 'confirm';
  const options = dialog?.options;

  return (
    <ConfirmDialogContext.Provider value={{ confirm, alert }}>
      {children}
      {dialog && (
        <div className={styles.overlay} onClick={handleCancel}>
          <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
            <div className={styles.header}>
              <h2 className={styles.title}>
                {isConfirm
                  ? (options as ConfirmOptions).title
                  : (options as AlertOptions).title || 'Notice'}
              </h2>
            </div>

            <p className={styles.message}>{options?.message}</p>

            <div className={styles.actions}>
              {isConfirm && (
                <button onClick={handleCancel} className={`${styles.btn} ${styles.btnSecondary}`}>
                  {(options as ConfirmOptions).cancelText || 'Cancel'}
                </button>
              )}
              <button
                onClick={handleConfirm}
                className={`${styles.btn} ${
                  isConfirm && (options as ConfirmOptions).variant === 'danger'
                    ? styles.btnDanger
                    : styles.btnPrimary
                }`}
              >
                {isConfirm
                  ? (options as ConfirmOptions).confirmText || 'Confirm'
                  : (options as AlertOptions).buttonText || 'OK'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmDialogContext.Provider>
  );
}
