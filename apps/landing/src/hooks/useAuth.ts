import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export function useAuth() {
  const [user, setUser] = useState<any>(null);
  const [session, setSession] = useState<any>(null);
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
      setError(sessionError instanceof Error ? sessionError.message : 'Could not restore your session.');
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
    } finally {
      setIsLoading(false);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
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
    } finally {
      setIsLoading(false);
    }
  };

  return { user, session, isLoading, error, signIn, signUp, signOut, signInWithGitHub };
}
