'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import styles from './page.module.css';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (mode === 'login') {
        await api.login(email, password);
      } else {
        await api.register(email, password, name);
      }
      router.push('/lists');
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>Family Todo List</h1>

        <div className={styles.modeToggle}>
          <button
            onClick={() => setMode('login')}
            className={`${styles.modeBtn} ${mode === 'login' ? styles.modeBtnActive : ''}`}
          >
            Login
          </button>
          <button
            onClick={() => setMode('register')}
            className={`${styles.modeBtn} ${mode === 'register' ? styles.modeBtnActive : ''}`}
          >
            Register
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          {mode === 'register' && (
            <input
              type="text"
              placeholder="Name"
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          )}

          <input
            type="email"
            placeholder="Email"
            className={styles.input}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <input
            type="password"
            placeholder="Password"
            className={styles.input}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />

          {error && <div className={styles.error}>{error}</div>}

          <button type="submit" className={styles.submitBtn} disabled={loading}>
            {loading ? 'Please wait...' : mode === 'login' ? 'Login' : 'Create Account'}
          </button>
        </form>
      </div>
    </div>
  );
}
