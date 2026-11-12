export interface GenerationPreview {
  mode: 'demo' | 'generated'
  message: string
  imageUrl: string
  generationId: string
  baseRevision: number
  usage?: import('./world').GenerationUsage
}
