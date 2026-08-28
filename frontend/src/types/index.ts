// ProctorAI shared frontend types

export interface HealthResponse {
  status: string
  service: string
  version: string
}

export type { Instructor } from '../services/auth'
