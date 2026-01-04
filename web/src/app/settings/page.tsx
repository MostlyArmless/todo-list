'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  useGetNotificationSettingsApiV1NotificationsSettingsGet,
  useUpdateNotificationSettingsApiV1NotificationsSettingsPut,
  type NotificationSettingsUpdate,
} from '@/generated/api';
import { getCurrentUser } from '@/lib/auth';
import { subscribeToPush, unsubscribeFromPush, isPushSupported, isPushSubscribed } from '@/lib/pushNotifications';
import styles from './page.module.css';

export default function SettingsPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Form state
  const [phoneNumber, setPhoneNumber] = useState('');
  const [partnerPhone, setPartnerPhone] = useState('');
  const [safeWord, setSafeWord] = useState('');
  const [quietStart, setQuietStart] = useState('');
  const [quietEnd, setQuietEnd] = useState('');
  const [timezone, setTimezone] = useState('America/Toronto');
  const [pushToSms, setPushToSms] = useState(5);
  const [smsToCall, setSmsToCall] = useState(15);
  const [callRepeat, setCallRepeat] = useState(30);
  const [formInitialized, setFormInitialized] = useState(false);

  // Push notification state
  const [pushSupported, setPushSupported] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);

  // Query for settings
  const { data: settings, isLoading } = useGetNotificationSettingsApiV1NotificationsSettingsGet();

  // Mutation for updating
  const updateMutation = useUpdateNotificationSettingsApiV1NotificationsSettingsPut();

  useEffect(() => {
    const user = getCurrentUser();
    if (!user) {
      router.push('/login');
      return;
    }
    checkPushStatus();
  }, [router]);

  // Initialize form state from loaded settings
  useEffect(() => {
    if (settings && !formInitialized) {
      setPhoneNumber(settings.phone_number || '');
      setPartnerPhone(settings.accountability_partner_phone || '');
      setSafeWord(settings.escape_safe_word || 'abort');
      setQuietStart(settings.quiet_hours_start || '');
      setQuietEnd(settings.quiet_hours_end || '');
      setTimezone(settings.quiet_hours_timezone || 'America/Toronto');
      const timing = settings.escalation_timing as { push_to_sms?: number; sms_to_call?: number; call_repeat?: number } | null;
      setPushToSms(timing?.push_to_sms || 5);
      setSmsToCall(timing?.sms_to_call || 15);
      setCallRepeat(timing?.call_repeat || 30);
      setFormInitialized(true);
    }
  }, [settings, formInitialized]);

  const checkPushStatus = async () => {
    setPushSupported(isPushSupported());
    if (isPushSupported()) {
      const subscribed = await isPushSubscribed();
      setPushEnabled(subscribed);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSaving(true);

    try {
      const update: NotificationSettingsUpdate = {
        phone_number: phoneNumber || null,
        accountability_partner_phone: partnerPhone || null,
        escape_safe_word: safeWord || 'abort',
        quiet_hours_start: quietStart || null,
        quiet_hours_end: quietEnd || null,
        quiet_hours_timezone: timezone,
        escalation_timing: {
          push_to_sms: pushToSms,
          sms_to_call: smsToCall,
          call_repeat: callRepeat,
        },
      };

      await updateMutation.mutateAsync({ data: update });
      setSuccess('Settings saved successfully');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save settings';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const handlePushToggle = async () => {
    setPushLoading(true);
    setError('');

    try {
      if (pushEnabled) {
        await unsubscribeFromPush();
        setPushEnabled(false);
      } else {
        await subscribeToPush();
        setPushEnabled(true);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to toggle push notifications';
      setError(message);
    } finally {
      setPushLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <h1 className={styles.title}>Settings</h1>
          <p className={styles.subtitle}>Loading...</p>
        </div>
        <div className={styles.section}>
          <div className={`${styles.skeleton} ${styles.skeletonInput}`} />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Notification Settings</h1>
        <p className={styles.subtitle}>Configure task reminders and accountability</p>
      </div>

      {success && (
        <div className={styles.success}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20 6L9 17l-5-5" />
          </svg>
          {success}
        </div>
      )}

      {error && (
        <div className={styles.error}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {error}
        </div>
      )}

      <form onSubmit={handleSave}>
        {/* Push Notifications */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            Push Notifications
          </h2>
          <div className={styles.pushRow}>
            <div className={styles.pushInfo}>
              <div className={styles.pushLabel}>Browser notifications</div>
              <div className={styles.pushStatus}>
                {!pushSupported
                  ? 'Not supported in this browser'
                  : pushEnabled
                  ? 'Enabled'
                  : 'Disabled'}
              </div>
            </div>
            {pushSupported && (
              <button
                type="button"
                onClick={handlePushToggle}
                disabled={pushLoading}
                className={`${styles.pushBtn} ${pushEnabled ? styles.pushBtnEnabled : ''}`}
              >
                {pushLoading ? 'Loading...' : pushEnabled ? 'Disable' : 'Enable'}
              </button>
            )}
          </div>
        </div>

        {/* Phone Numbers */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
            Phone Numbers
          </h2>
          <p className={styles.sectionDescription}>
            Used for SMS and voice call reminders when you don&apos;t respond to push notifications.
          </p>

          <div className={styles.field}>
            <label className={styles.label}>Your phone number</label>
            <input
              type="tel"
              className={styles.input}
              placeholder="+1 (555) 123-4567"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
            />
            <p className={styles.hint}>Include country code (e.g., +1 for US/Canada)</p>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Accountability partner phone</label>
            <input
              type="tel"
              className={styles.input}
              placeholder="+1 (555) 987-6543"
              value={partnerPhone}
              onChange={(e) => setPartnerPhone(e.target.value)}
            />
            <p className={styles.hint}>Gets notified if you use the safe word to abandon a task</p>
          </div>
        </div>

        {/* Escalation Timing */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            Escalation Timing
          </h2>
          <p className={styles.sectionDescription}>
            How long to wait between notification escalations (in minutes).
          </p>

          <div className={styles.escalationRow}>
            <div className={styles.escalationField}>
              <label className={styles.label}>Push to SMS</label>
              <input
                type="number"
                className={styles.input}
                min="1"
                max="60"
                value={pushToSms}
                onChange={(e) => setPushToSms(parseInt(e.target.value) || 5)}
              />
            </div>
            <div className={styles.escalationField}>
              <label className={styles.label}>SMS to Call</label>
              <input
                type="number"
                className={styles.input}
                min="1"
                max="120"
                value={smsToCall}
                onChange={(e) => setSmsToCall(parseInt(e.target.value) || 15)}
              />
            </div>
            <div className={styles.escalationField}>
              <label className={styles.label}>Call Repeat</label>
              <input
                type="number"
                className={styles.input}
                min="5"
                max="120"
                value={callRepeat}
                onChange={(e) => setCallRepeat(parseInt(e.target.value) || 30)}
              />
            </div>
          </div>
        </div>

        {/* Quiet Hours */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
            Quiet Hours
          </h2>
          <p className={styles.sectionDescription}>
            No notifications during these hours. Leave empty to disable.
          </p>

          <div className={styles.timeRow}>
            <div className={styles.timeField}>
              <label className={styles.label}>Start time</label>
              <input
                type="time"
                className={styles.input}
                value={quietStart}
                onChange={(e) => setQuietStart(e.target.value)}
              />
            </div>
            <div className={styles.timeField}>
              <label className={styles.label}>End time</label>
              <input
                type="time"
                className={styles.input}
                value={quietEnd}
                onChange={(e) => setQuietEnd(e.target.value)}
              />
            </div>
          </div>

          <div className={styles.field} style={{ marginTop: 'var(--space-3)' }}>
            <label className={styles.label}>Timezone</label>
            <input
              type="text"
              className={styles.input}
              placeholder="America/Toronto"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            />
          </div>
        </div>

        {/* Safe Word */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            Escape Safe Word
          </h2>
          <p className={styles.sectionDescription}>
            Say or type this word to abandon a task. Your accountability partner will be notified.
          </p>

          <div className={styles.field}>
            <label className={styles.label}>Safe word</label>
            <input
              type="text"
              className={styles.input}
              placeholder="abort"
              value={safeWord}
              onChange={(e) => setSafeWord(e.target.value)}
            />
          </div>
        </div>

        {/* Save Button */}
        <button type="submit" className={styles.saveBtn} disabled={saving}>
          {saving ? (
            <span className={styles.loading}>
              <span className={styles.spinner} />
              Saving...
            </span>
          ) : (
            'Save Settings'
          )}
        </button>
      </form>

      <div className={styles.version}>
        Build: {process.env.NEXT_PUBLIC_GIT_SHA || 'dev'}
      </div>
    </div>
  );
}
