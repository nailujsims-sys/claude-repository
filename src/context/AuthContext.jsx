import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { isSupabaseConfigured, passwordResetRedirectTo } from '../lib/config'
import { profileRepository } from '../data/profileRepository'
import { displayNameFor, isRecoveryReturn, urlWithoutRecoveryMarker } from '../lib/auth'

const AuthContext = createContext(null)

// The app's identity. There is no local or anonymous mode any more: either
// Supabase says who this is, or the app holds no personal data at all.
//
// `status` is deliberately three-valued. "no user" and "we do not know yet"
// look the same to a boolean and would flash the login screen at every reload —
// the difference is the whole point of session restoration.
export function AuthProvider({ children }) {
  const [status, setStatus] = useState('loading') // 'loading' | 'ready'
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [recovery, setRecovery] = useState(() =>
    typeof window === 'undefined' ? false : isRecoveryReturn(window.location.search)
  )

  useEffect(() => {
    if (!supabase) return
    let active = true

    // getSession() awaits the client's own initialisation, which is where a
    // PKCE code from a reset mail is exchanged. So this resolves *after* the
    // link has been redeemed — no login flash on the way to the new-password
    // screen, and no second code path to keep in sync.
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setUser(data.session?.user ?? null)
      setStatus('ready')
    })

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      setUser(session?.user ?? null)
      setStatus('ready')
      if (!session?.user) setProfile(null)
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  // The profile is a nicety (the display name), never a gate: if it cannot be
  // read the app still runs and falls back to the email.
  useEffect(() => {
    if (!user) return
    let active = true
    profileRepository
      .getProfile(user.id)
      .then((row) => active && setProfile(row))
      .catch(() => active && setProfile(null))
    return () => {
      active = false
    }
  }, [user])

  const signIn = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error }
  }, [])

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut()
    return { error }
  }, [])

  const requestPasswordReset = useCallback(async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: passwordResetRedirectTo(),
    })
    return { error }
  }, [])

  const updatePassword = useCallback(async (password) => {
    const { error } = await supabase.auth.updateUser({ password })
    if (!error) {
      setRecovery(false)
      // Drop the marker, so a reload lands in the app rather than back on the
      // "set a new password" screen.
      if (typeof window !== 'undefined' && window.history?.replaceState) {
        window.history.replaceState({}, '', urlWithoutRecoveryMarker(window.location.href))
      }
    }
    return { error }
  }, [])

  const value = useMemo(
    () => ({
      status,
      user,
      profile,
      recovery,
      isConfigured: isSupabaseConfigured,
      displayName: displayNameFor(profile, user),
      email: user?.email ?? '',
      signIn,
      signOut,
      requestPasswordReset,
      updatePassword,
    }),
    [status, user, profile, recovery, signIn, signOut, requestPasswordReset, updatePassword]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
