import { create } from 'zustand'

export type Note = {
  id: string
  content: string
  user_id: string
  interaction_id: string | null
  created_at: string
  updated_at: string
}

interface NotesStore {
  notes: Note[]
  loadNotes: () => Promise<void>
  addNote: (content: string) => Promise<void>
  updateNote: (id: string, content: string) => Promise<void>
  deleteNote: (id: string) => Promise<void>
}

export const useNotesStore = create<NotesStore>((set, get) => ({
  notes: [],

  loadNotes: async () => {
    try {
      const notes = await window.api.notes.getAll()
      set({ notes })
    } catch (error) {
      console.error('Failed to load notes from database:', error)
    }
  },

  addNote: async (content: string) => {
    try {
      const newNote = await window.api.notes.add({
        content: content.trim(),
      })
      set(state => ({ notes: [newNote, ...state.notes] }))
    } catch (error) {
      console.error('Failed to add note to database:', error)
    }
  },

  updateNote: async (id: string, content: string) => {
    try {
      await window.api.notes.updateContent(id, content)
      // For an immediate UI update, we can call loadNotes again
      // or manually update the state.
      get().loadNotes()
    } catch (error) {
      console.error('Failed to update note in database:', error)
    }
  },

  deleteNote: async (id: string) => {
    try {
      await window.api.notes.delete(id)
      set(state => ({
        notes: state.notes.filter(note => note.id !== id),
      }))
    } catch (error) {
      console.error('Failed to delete note from database:', error)
    }
  },
}))
