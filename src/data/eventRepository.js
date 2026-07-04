import { isSupabaseConfigured } from '../lib/config'
import { localEventRepository } from './localEventRepository'
import { supabaseEventRepository } from './supabaseEventRepository'

// Single entry point for calendar-event data access, mirroring
// getTaskRepository. Screens depend on this interface, not the implementation:
//   listEvents(userId)             -> Event[]
//   createEvent(userId, data)      -> Event
//   updateEvent(userId, id, patch) -> Event
//   deleteEvent(userId, id)        -> void
export function getEventRepository() {
  return isSupabaseConfigured ? supabaseEventRepository : localEventRepository
}
