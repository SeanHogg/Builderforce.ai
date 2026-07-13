export interface Job {
  id: string;
  title: string;
  department: string;
  location: string;
  locationType?: string;
  employmentType: string;
  salary?: string;
  description: string;
  requirements: string[];
  weOffer: string[];
  status: 'draft' | 'published' | 'closed';
  createdAt: string;
  updatedAt: string;
}

export interface CreateJobInput {
  title: string;
  department: string;
  location: string;
  employmentType: string;
  salary?: string;
  description: string;
  requirements: string[];
  weOffer: string[];
}

export interface UpdateJobInput {
  title?: string;
  department?: string;
  location?: string;
  employmentType?: string;
  salary?: string;
  description?: string;
  requirements?: string[];
  weOffer?: string[];
  status?: 'draft' | 'published' | 'closed';
}

export interface JobApplication {
  id: string;
  jobId: string;
  candidateId: string;
  candidateName: string;
  coverNote?: string;
  videoUrl: string;
  thumbnailUrl?: string;
  status: 'new' | 'reviewed' | 'shortlisted' | 'rejected';
  createdAt: string;
  updatedAt: string;
  comments?: ApplicationComment[];
}

export interface ApplicationComment {
  id: string;
  postId: string;
  authorId: string;
  authorName: string;
  content: string;
  timestamp: number;
  type: 'private' | 'public';
}

export interface VideoReference {
  id: string;
  jobId?: string;
  candidateId?: string;
  userId?: string;
  url: string;
  duration: number;
  thumbnailUrl?: string;
  status: 'uploading' | 'processing' | 'ready' | 'failed';
  createdAt: string;
}

export interface VideoProcessingResult {
  inputUrl: string;
  outputUrls: {
    hls720p: string;
    thumbnail: string;
  };
  duration: number;
  createdAt: string;
}