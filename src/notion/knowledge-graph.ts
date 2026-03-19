import pLimit from 'p-limit';
import type { KnowledgeEntry, EntityType, Confidence } from '../types.js';
import { getNotionClient } from './client.js';
import { writeQueue, retryWithBackoff } from '../concurrency.js';

// Serialises check+create so concurrent scouts cannot both see "no entry"
// and both create the same entity. pLimit(1) makes the upsert atomic.
const kgUpsertQueue = pLimit(1);

interface CreateEntryParams {
  entityName: string;
  entityType: EntityType;
  claim: string;
  confidence: Confidence;
  source?: string;
  createdByTaskId: string;
}

// Returns existing page ID if an entity with the same name+type already exists,
// otherwise creates a new one. The entire check+create runs inside kgUpsertQueue
// (pLimit(1)) so concurrent scouts cannot both observe "no entry" and both create
// the same entity — making the upsert effectively atomic.
export async function createKnowledgeEntry(
  dbId: string,
  params: CreateEntryParams,
): Promise<string> {
  return kgUpsertQueue(async () => {
    const notion = getNotionClient();

    const existing = await notion.databases.query({
      database_id: dbId,
      filter: {
        and: [
          { property: 'entity_name', title: { equals: params.entityName } },
          { property: 'entity_type', select: { equals: params.entityType } },
        ],
      },
      page_size: 1,
    } as any);

    if (existing.results.length > 0) {
      return existing.results[0].id;
    }

    const page = await writeQueue.enqueue(() =>
      retryWithBackoff(() =>
        notion.pages.create({
          parent: { database_id: dbId },
          properties: {
            entity_name: { title: [{ text: { content: params.entityName } }] },
            entity_type: { select: { name: params.entityType } },
            claim: { rich_text: [{ text: { content: params.claim } }] },
            confidence: { select: { name: params.confidence } },
            ...(params.source ? { source: { url: params.source } } : {}),
            created_by_task_id: { rich_text: [{ text: { content: params.createdByTaskId } }] },
          },
        } as any),
      ),
    );
    return page.id;
  });
}

export async function queryEntitiesByType(
  dbId: string,
  entityType: EntityType,
): Promise<KnowledgeEntry[]> {
  const notion = getNotionClient();
  const entries: KnowledgeEntry[] = [];
  let cursor: string | undefined;

  do {
    const response = await notion.databases.query({
      database_id: dbId,
      filter: { property: 'entity_type', select: { equals: entityType } },
      ...(cursor ? { start_cursor: cursor } : {}),
    } as any);

    for (const page of response.results) {
      entries.push(pageToEntry(page));
    }

    cursor = (response as any).next_cursor ?? undefined;
  } while (cursor);

  return entries;
}

function pageToEntry(page: any): KnowledgeEntry {
  return {
    id: page.id,
    entityName: page.properties.entity_name?.title?.[0]?.plain_text ?? '',
    entityType: page.properties.entity_type?.select?.name ?? 'concept',
    claim: page.properties.claim?.rich_text?.[0]?.plain_text ?? '',
    confidence: page.properties.confidence?.select?.name ?? 'medium',
    source: page.properties.source?.url ?? undefined,
    relatedEntityIds: (page.properties.related_entities?.relation ?? []).map((r: any) => r.id),
    createdByTaskId: page.properties.created_by_task_id?.rich_text?.[0]?.plain_text ?? '',
  };
}

// Sets the related_entities relation property on a knowledge graph entry.
export async function updateRelatedEntities(
  pageId: string,
  relatedPageIds: string[],
): Promise<void> {
  const notion = getNotionClient();
  await writeQueue.enqueue(() =>
    retryWithBackoff(() =>
      notion.pages.update({
        page_id: pageId,
        properties: {
          related_entities: {
            relation: relatedPageIds.map(id => ({ id })),
          },
        },
      } as any),
    ),
  );
}

// Scans all entries and links entities whose names appear in each other's claims.
// Called after the Analyst pass to wire up the graph edges.
export async function computeAndStoreRelations(dbId: string): Promise<void> {
  const entries = await getAllEntries(dbId);
  if (entries.length < 2) return;

  await Promise.all(
    entries.map(async entry => {
      const claimLower = entry.claim.toLowerCase();
      const related = entries.filter(other => {
        if (other.id === entry.id) return false;
        // Word-boundary match: entity name must appear as a whole word (not substring of another word)
        const escaped = other.entityName.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(?<![a-z])${escaped}(?![a-z])`, 'i').test(claimLower);
      });
      if (related.length > 0) {
        await updateRelatedEntities(entry.id, related.map(r => r.id));
      }
    }),
  );
}

// Fetches all entries, paginating through Notion's 100-result-per-page limit.
export async function getAllEntries(dbId: string): Promise<KnowledgeEntry[]> {
  const notion = getNotionClient();
  const entries: KnowledgeEntry[] = [];
  let cursor: string | undefined;

  do {
    const response = await notion.databases.query({
      database_id: dbId,
      ...(cursor ? { start_cursor: cursor } : {}),
    } as any);

    for (const page of response.results) {
      entries.push(pageToEntry(page));
    }

    cursor = (response as any).next_cursor ?? undefined;
  } while (cursor);

  return entries;
}
