import { z } from 'zod';

// ─── Enums ────────────────────────────────────────────────────────────────────

export const TaskStatusSchema = z.enum(['pending', 'active', 'done', 'blocked']);
export const AgentTypeSchema = z.enum(['orchestrator', 'scout', 'analyst', 'synthesizer', 'writer']);
export const EntityTypeSchema = z.enum(['company', 'person', 'product', 'trend', 'concept']);
export const ConfidenceSchema = z.enum(['high', 'medium', 'low']);
export const GateStatusSchema = z.enum(['Pending', 'Approved', 'Rejected']);

// ─── Database Entry Schemas ───────────────────────────────────────────────────

export const TaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: TaskStatusSchema,
  assignedAgent: AgentTypeSchema.optional(),
  priority: z.number().default(0),
  createdBy: z.enum(['orchestrator', 'scout', 'analyst']),
});

export const WorkingMemoryPageSchema = z.object({
  id: z.string(),
  agentType: AgentTypeSchema,
  tokenCount: z.number().default(0),
});

export const KnowledgeEntrySchema = z.object({
  id: z.string(),
  entityName: z.string(),
  entityType: EntityTypeSchema,
  claim: z.string(),
  confidence: ConfidenceSchema,
  source: z.string().optional(),
  relatedEntityIds: z.array(z.string()).default([]),
  createdByTaskId: z.string(),
});

export const ApprovalGateSchema = z.object({
  id: z.string(),
  gateName: z.string(),
  status: GateStatusSchema,
  notes: z.string().default(''),
});

export const OutputSchema = z.object({
  id: z.string(),
  title: z.string(),
  topic: z.string(),
  createdAt: z.string(),
});

// ─── Runtime Types ────────────────────────────────────────────────────────────

export const NotionDbIdsSchema = z.object({
  taskBus: z.string(),
  workingMemory: z.string(),
  knowledgeGraph: z.string(),
  approvalGates: z.string(),
  outputs: z.string(),
});

export const AgentContextSchema = z.object({
  taskId: z.string(),
  workingMemoryId: z.string(),
  topic: z.string(),
  subTopic: z.string(),
  dbIds: NotionDbIdsSchema,
});

// ─── Inferred Types ───────────────────────────────────────────────────────────

export type Task = z.infer<typeof TaskSchema>;
export type WorkingMemoryPage = z.infer<typeof WorkingMemoryPageSchema>;
export type KnowledgeEntry = z.infer<typeof KnowledgeEntrySchema>;
export type ApprovalGate = z.infer<typeof ApprovalGateSchema>;
export type Output = z.infer<typeof OutputSchema>;
export type NotionDbIds = z.infer<typeof NotionDbIdsSchema>;
export type AgentContext = z.infer<typeof AgentContextSchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type AgentType = z.infer<typeof AgentTypeSchema>;
export type EntityType = z.infer<typeof EntityTypeSchema>;
export type Confidence = z.infer<typeof ConfidenceSchema>;
export type GateStatus = z.infer<typeof GateStatusSchema>;
