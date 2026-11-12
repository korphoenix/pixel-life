export interface World {
  user_id: string
  revision: number
  avatar_path: string | null
  current_image_path: string | null
  updated_at: string
}
export interface LifeEntry {
  id: string
  user_id: string
  kind: 'avatar' | 'life'
  revision: number
  caption: string
  occurred_on: string
  photo_path: string
  image_path: string
  created_at: string
}
export interface GenerationUsage {
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
}
