'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

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
        <div
          className="modal-overlay"
          onClick={handleCancel}
          style={{ animation: 'fadeIn 0.15s ease' }}
        >
          <div
            className="card"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: '400px',
              animation: 'slideUp 0.15s ease',
            }}
          >
            {/* Header */}
            <div style={{ marginBottom: '0.75rem' }}>
              <h2 style={{ fontSize: '1.125rem', fontWeight: 600 }}>
                {isConfirm
                  ? (options as ConfirmOptions).title
                  : (options as AlertOptions).title || 'Notice'}
              </h2>
            </div>

            {/* Message */}
            <p
              style={{
                color: 'var(--text-secondary)',
                fontSize: '0.9375rem',
                lineHeight: 1.5,
                marginBottom: '1.5rem',
              }}
            >
              {options?.message}
            </p>

            {/* Actions */}
            <div
              style={{
                display: 'flex',
                gap: '0.5rem',
                justifyContent: 'flex-end',
              }}
            >
              {isConfirm && (
                <button
                  onClick={handleCancel}
                  className="btn btn-secondary"
                  style={{ minWidth: '80px' }}
                >
                  {(options as ConfirmOptions).cancelText || 'Cancel'}
                </button>
              )}
              <button
                onClick={handleConfirm}
                className={`btn ${
                  isConfirm && (options as ConfirmOptions).variant === 'danger'
                    ? 'btn-danger'
                    : 'btn-primary'
                }`}
                style={{ minWidth: '80px' }}
              >
                {isConfirm
                  ? (options as ConfirmOptions).confirmText || 'Confirm'
                  : (options as AlertOptions).buttonText || 'OK'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(10px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>
    </ConfirmDialogContext.Provider>
  );
}
