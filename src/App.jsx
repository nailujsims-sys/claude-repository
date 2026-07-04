import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ToastProvider } from './context/ToastContext'
import { UIProvider } from './context/UIContext'
import { TasksProvider } from './context/TasksContext'
import { EventsProvider } from './context/EventsContext'

import BottomNav from './components/BottomNav'
import Sidebar from './components/Sidebar'
import ActionSheet from './components/ActionSheet'
import TaskForm from './components/TaskForm'
import EventForm from './components/EventForm'
import ToastHost from './components/ToastHost'
import ErrorBanner from './components/ErrorBanner'

import Home from './screens/Home'
import TasksList from './screens/TasksList'
import TaskDetail from './screens/TaskDetail'
import Kalender from './screens/Kalender'
import Mehr from './screens/Mehr'
import Login from './screens/Login'

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Gate />
      </ToastProvider>
    </AuthProvider>
  )
}

// Decides between the loading splash, the login screen (Supabase mode only),
// and the full app.
function Gate() {
  const { loading, isConfigured, user } = useAuth()

  if (loading) {
    return (
      <div className="app-frame grid min-h-screen place-items-center bg-bg-base">
        <p className="text-[14px] text-text-secondary">Lädt…</p>
      </div>
    )
  }

  if (isConfigured && !user) {
    return (
      <div className="app-frame bg-bg-base">
        <Login />
      </div>
    )
  }

  return (
    <UIProvider>
      <TasksProvider>
        <EventsProvider>
          <AppShell />
        </EventsProvider>
      </TasksProvider>
    </UIProvider>
  )
}

function AppShell() {
  const location = useLocation()

  return (
    <div className="app-frame bg-bg-base">
      <ErrorBanner />

      {/* Routed screen content. Keyed by path for a subtle enter transition. */}
      <main key={location.pathname} className="page">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/aufgaben" element={<TasksList />} />
          <Route path="/aufgaben/:id" element={<TaskDetail />} />
          <Route path="/kalender" element={<Kalender />} />
          <Route path="/mehr" element={<Mehr />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {/* Persistent chrome + global overlays */}
      <BottomNav />
      <Sidebar />
      <ActionSheet />
      <TaskForm />
      <EventForm />
      <ToastHost />
    </div>
  )
}
