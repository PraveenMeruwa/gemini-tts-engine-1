export interface ChunkLogItem {
  index: number;
  wordCount: number;
  status: 'generating' | 'done' | 'error' | 'retrying';
  message: string;
}

export interface VoiceOption {
  value: string;
  label: string;
}
