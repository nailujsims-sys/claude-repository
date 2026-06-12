import { isSupabaseConfigured } from '../lib/config'
import { localTaskRepository } from './localTaskRepository'
import { supabaseTaskRepository } from './supabaseTaskRepository'

// Single entry point for data access. Swapping backends (or adding a new one)
// only touches this factory — screens depend on the interface, not the impl.
//
// Interface:
//   listTasks(userId)            -> Task[]
//   createTask(userId, data)     -> Task
//   updateTask(userId, id, patch)-> Task
//   reorderTasks(userId, updates)-> void   (updates: [{ id, ...patch }])
export function getTaskRepository() {
  return isSupabaseConfigured ? supabaseTaskRepository : localTaskRepository
}
