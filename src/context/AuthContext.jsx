import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { isSupabaseConfigured, USER_NAME } from '../lib/config'

const AuthContext = createContext(null)

// In local mode there is no real auth — we synthesize a stable single user so
// the rest of the app (which keys data by user id) works unchanged.
const LOCAL_USER = { id: 'local-julian', email: 'julian@local' }

export function AuthProvider({ children }) {
  const [user, setUser] = useState(isSupabaseConfigured ? null : LOCAL_USER)
  const [loading, setLoading] = useState(isSupabaseConfigured)

  useEffect(() => {
    if (!isSupabaseConfigured) return
    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setUser(data.session?.user ?? null)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  async function signIn(email, password) {
    if (!isSupabaseConfigured) return { error: null }
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error }
  }

  async function signOut() {
    if (!isSupabaseConfigured) return
    await supabase.auth.signOut()
  }

  const value = {
    user,
    loading,
    signIn,
    signOut,
    isConfigured: isSupabaseConfigured,
    displayName: USER_NAME,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
