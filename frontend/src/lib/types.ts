export interface Project {
  id: string;
  name: string;
  description?: string;
  owner_id: string;
  template: string;
  created_at: string;
  updated_at: string;
}

export interface FileEntry {
  path: string;
  content: string;
  type: 'file' | 'directory';
}

export interface AIMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at?: string;
}

export interface CollaborationSession {
  id: string;
  project_id: string;
  user_id: string;
  started_at: string;
  ended_at?: string;
}

export interface UserPresence {
  userId: string;
  name: string;
  color: string;
  cursor?: {
    line: number;
    column: number;
  };
}

export interface WebContainerState {
  status: 'idle' | 'booting' | 'ready' | 'error';
  url?: string;
  error?: string;
}
