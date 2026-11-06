import { useState, useEffect } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
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
      if (error) setError(error.message);
      setSession(session);
      setUser(session?.user ?? null);
      setIsLoading(false);
    }).catch((sessionError: unknown) => {
      if (!active) return;
      setError(getErrorMessage(sessionError, 'Could not restore your session.'));
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
      if (error) setError(error.message);
      return { error };
    } catch (authError: unknown) {
      const message = getErrorMessage(authError, 'Could not sign in.');
      setError(message);
      throw authError instanceof Error ? authError : new Error(message);
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
      if (result.error) setError(result.error.message);
      return result;
    } catch (authError: unknown) {
      const message = getErrorMessage(authError, 'Could not create your account.');
      setError(message);
      throw authError instanceof Error ? authError : new Error(message);
    } finally {
      setIsLoading(false);
    }
  };

  const signOut = async () => {
    setError(null);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        setError(error.message);
        return { error };
      }
      setSession(null);
      setUser(null);
      return { error: null };
    } catch (authError: unknown) {
      const message = getErrorMessage(authError, 'Could not sign out.');
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
      if (error) setError(error.message);
    } catch (authError: unknown) {
      const message = getErrorMessage(authError, 'Could not authenticate with GitHub.');
      setError(message);
      throw authError instanceof Error ? authError : new Error(message);
    } finally {
      setIsLoading(false);
    }
  };

  return { user, session, isLoading, error, signIn, signUp, signOut, signInWithGitHub };
}
