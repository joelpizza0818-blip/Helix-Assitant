import { useState, useEffect } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export function getAuthErrorMessage(error: unknown, fallback: string): string {
  const detail = error instanceof Error ? error.message.toLowerCase() : '';
  const code = error && typeof error === 'object' && 'code' in error
    && typeof error.code === 'string'
    ? error.code.toLowerCase()
    : '';

  if (code === 'invalid_credentials' || detail.includes('invalid login credentials')) {
    return 'El correo o la contraseña no son correctos.';
  }
  if (code === 'email_not_confirmed' || detail.includes('email not confirmed')) {
    return 'Confirma tu correo electrónico antes de iniciar sesión.';
  }
  if (code.includes('rate_limit') || detail.includes('too many requests')) {
    return 'Se alcanzó el límite de intentos. Espera un momento antes de volver a intentarlo.';
  }
  if (/network|fetch failed|econn|enotfound|socket/.test(detail)) {
    return 'No se pudo conectar con el servicio de acceso. Comprueba tu conexión e inténtalo de nuevo.';
  }

  return fallback;
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (!active) return;
      if (error) setError(getAuthErrorMessage(error, 'No se pudo restaurar la sesión. Inténtalo de nuevo.'));
      setSession(session);
      setUser(session?.user ?? null);
      setIsLoading(false);
    }).catch((sessionError: unknown) => {
      if (!active) return;
      setError(getAuthErrorMessage(sessionError, 'No se pudo restaurar la sesión. Inténtalo de nuevo.'));
      setIsLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setSession(session);
      setUser(session?.user ?? null);
      setIsLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        const message = getAuthErrorMessage(error, 'No se pudo iniciar sesión. Revisa tus datos e inténtalo de nuevo.');
        setError(message);
        return { error: new Error(message) };
      }
      return { error: null };
    } catch (authError: unknown) {
      const message = getAuthErrorMessage(authError, 'No se pudo iniciar sesión. Revisa tus datos e inténtalo de nuevo.');
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  };

  const signUp = async (email: string, password: string, redirectTo: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/login?redirectTo=${encodeURIComponent(redirectTo)}`,
        },
      });
      if (result.error) {
        const message = getAuthErrorMessage(result.error, 'No se pudo crear la cuenta. Revisa tus datos e inténtalo de nuevo.');
        setError(message);
        return { ...result, error: new Error(message) };
      }
      return result;
    } catch (authError: unknown) {
      const message = getAuthErrorMessage(authError, 'No se pudo crear la cuenta. Revisa tus datos e inténtalo de nuevo.');
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  };

  const signOut = async () => {
    setError(null);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        const message = getAuthErrorMessage(error, 'No se pudo cerrar la sesión. Inténtalo de nuevo.');
        setError(message);
        return { error: new Error(message) };
      }
      setSession(null);
      setUser(null);
      return { error: null };
    } catch (authError: unknown) {
      const message = getAuthErrorMessage(authError, 'No se pudo cerrar la sesión. Inténtalo de nuevo.');
      setError(message);
      return { error: new Error(message) };
    }
  };

  const signInWithGitHub = async (redirectTo: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'github',
        options: {
          redirectTo: `${window.location.origin}/login?redirectTo=${encodeURIComponent(redirectTo)}`
        }
      });
      if (error) setError(getAuthErrorMessage(error, 'No se pudo iniciar el acceso con GitHub. Inténtalo de nuevo.'));
    } catch (authError: unknown) {
      const message = getAuthErrorMessage(authError, 'No se pudo iniciar el acceso con GitHub. Inténtalo de nuevo.');
      setError(message);
      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  };

  return { user, session, isLoading, error, signIn, signUp, signOut, signInWithGitHub };
}
