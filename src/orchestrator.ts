import pLimit from 'p-limit';
import type { NotionDbIds } from './types.js';
import { bootstrapWorkspace } from './notion/bootstrap.js';
import { createTask } from './notion/task-bus.js';
import { createWorkingMemoryPage } from './notion/working-memory.js';
import { createApprovalGate, pollGateUntilResolved } from './notion/approval-gates.js';
import { createNotionMCPClient } from './notion/mcp-client.js';
import { runScoutAgent } from './agents/scout.js';
import { runAnalystAgent } from './agents/analyst.js';
import { computeAndStoreRelations } from './notion/knowledge-graph.js';
import { runSynthesizerAgent } from './agents/synthesizer.js';
import { runWriterAgent } from './agents/writer.js';
import { resolveModel, streamChat } from './llm.js';
import { notionUrl } from './notion/utils.js';

const SCOUT_CONCURRENCY = Number(process.env.CORTEX_SCOUT_CONCURRENCY ?? 3);

// Asks the LLM to decompose a topic into 5 specific research angles.
// Falls back to generic angles if the model returns unparseable output.
async function decomposeIntoSubTopics(topic: string): Promise<string[]> {
  const text = await streamChat(
    {
      model: resolveModel('fast'),
      maxTokens: 512,
      messages: [
        {
          role: 'user',
          content: `You are a research strategist. Decompose the following topic into exactly 5 specific research angles that together will produce a comprehensive intelligence brief.

Topic: "${topic}"

Output ONLY a JSON array of 5 sub-topic strings. Each string should be a concrete, specific angle — not just "topic + generic label". Mix factual, competitive, technical, and forward-looking perspectives.

\`\`\`json
["angle 1", "angle 2", "angle 3", "angle 4", "angle 5"]
\`\`\``,
        },
      ],
    },
    () => {},
  );

  const match = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (match) {
    try {
      const angles: unknown = JSON.parse(match[1]);
      if (Array.isArray(angles) && angles.length > 0) return angles as string[];
    } catch { /* fall through */ }
  }

  // Generic fallback
  return [
    `Key players and products in: ${topic}`,
    `Market trends and growth in: ${topic}`,
    `Competitive landscape and pricing in: ${topic}`,
    `Technical differentiation and features in: ${topic}`,
    `User adoption and developer sentiment in: ${topic}`,
  ];
}

function elapsed(startMs: number): string {
  return `${((performance.now() - startMs) / 1000).toFixed(1)}s`;
}

export async function runOrchestrator(
  topic: string,
  parentPageId: string,
  options: { autoApprove?: boolean } = {},
): Promise<void> {
  const runStart = performance.now();
  console.log(`\n🧠 Notion Cortex — starting run for: "${topic}"\n`);

  // 1. Bootstrap workspace
  console.log('📋 Bootstrapping Notion workspace...');
  const t0 = performance.now();
  const dbIds = await bootstrapWorkspace(parentPageId);
  console.log(`✅ Workspace ready (${elapsed(t0)})\n`);

  // 2. AI-driven topic decomposition
  console.log('🧩 Decomposing topic into research angles...');
  const subTopics = await decomposeIntoSubTopics(topic);
  console.log(`   ${subTopics.length} angles identified:`);
  subTopics.forEach((t, i) => console.log(`   ${i + 1}. ${t}`));
  console.log();

  // 3. Connect to Notion MCP
  const notionApiKey = process.env.NOTION_API_KEY!;
  const mcp = await createNotionMCPClient(notionApiKey);

  try {
    // 4. Create scout tasks
    console.log(`🔍 Creating ${subTopics.length} research tasks...\n`);
    const scoutTaskIds = await Promise.all(
      subTopics.map((subTopic, i) =>
        createTask(dbIds.taskBus, {
          title: subTopic,
          createdBy: 'orchestrator',
          priority: i,
        }),
      ),
    );

    // 5. Run Scout agents in parallel
    console.log(`🚀 Running ${scoutTaskIds.length} Scout agents (concurrency: ${SCOUT_CONCURRENCY})...\n`);
    const limit = pLimit(SCOUT_CONCURRENCY);
    const scoutPageIds: string[] = [];
    const tScouts = performance.now();

    let successfulScouts = 0;
    await Promise.all(
      scoutTaskIds.map((taskId, i) =>
        limit(async () => {
          const wmId = await createWorkingMemoryPage(dbIds.workingMemory, 'scout', taskId, subTopics[i]);
          scoutPageIds.push(wmId);
          console.log(`  🔎 Scout ${i + 1} → ${notionUrl(wmId)}`);
          try {
            await runScoutAgent(
              { taskId, workingMemoryId: wmId, topic, subTopic: subTopics[i], dbIds },
              mcp,
            );
            successfulScouts++;
            console.log(`  ✅ Scout ${i + 1} done`);
          } catch (err) {
            console.warn(`  ⚠️  Scout ${i + 1} failed (task ${taskId}):`, (err as Error).message);
          }
        }),
      ),
    );

    if (successfulScouts === 0) {
      throw new Error('All Scout agents failed — cannot continue without research data.');
    }
    if (successfulScouts < scoutTaskIds.length) {
      console.warn(`\n⚠️  ${scoutTaskIds.length - successfulScouts} Scout(s) failed — continuing with partial data.\n`);
    }

    console.log(`\n📊 All Scouts complete (${elapsed(tScouts)}). Running Analyst...\n`);

    // 6. Analyst
    const analystTaskId = await createTask(dbIds.taskBus, {
      title: `Analyze findings for: ${topic}`,
      createdBy: 'orchestrator',
      priority: 10,
    });
    const analystWmId = await createWorkingMemoryPage(dbIds.workingMemory, 'analyst', analystTaskId, topic);
    const tAnalyst = performance.now();
    await runAnalystAgent(
      { taskId: analystTaskId, workingMemoryId: analystWmId, topic, subTopic: topic, dbIds },
      scoutPageIds,
    );
    console.log(`✅ Analyst done (${elapsed(tAnalyst)})\n`);

    // Wire up graph edges — link entities whose names appear in each other's claims
    console.log('🕸️  Computing knowledge graph relations...');
    const tGraph = performance.now();
    await computeAndStoreRelations(dbIds.knowledgeGraph);
    console.log(`✅ Relations linked (${elapsed(tGraph)})\n`);

    // 7. Synthesizer
    console.log('🔗 Running Synthesizer...\n');
    const synthTaskId = await createTask(dbIds.taskBus, {
      title: `Synthesize knowledge for: ${topic}`,
      createdBy: 'orchestrator',
      priority: 20,
    });
    const synthWmId = await createWorkingMemoryPage(dbIds.workingMemory, 'synthesizer', synthTaskId, topic);
    const tSynth = performance.now();
    const synthesisPageId = await runSynthesizerAgent({
      taskId: synthTaskId,
      workingMemoryId: synthWmId,
      topic,
      subTopic: topic,
      dbIds,
    });
    console.log(`✅ Synthesis written → ${notionUrl(synthesisPageId)} (${elapsed(tSynth)})\n`);

    // 8. Approval gate
    if (!options.autoApprove) {
      const gateId = await createApprovalGate(dbIds.approvalGates, {
        gateName: `Approve synthesis for: ${topic}`,
        synthesisPageId,
      });

      const gatesDbUrl = notionUrl(dbIds.approvalGates);
      console.log(`⏸  Awaiting approval — open cortex-approval-gates in Notion:`);
      console.log(`   ${gatesDbUrl}`);
      console.log(`   Find "${`Approve synthesis for: ${topic}`.slice(0, 60)}..."`);
      console.log(`   Review the synthesis link in the Notes field, then set Status → Approved\n`);

      const maxWaitMs = Number(process.env.CORTEX_APPROVAL_POLL_MAX_S ?? 3600) * 1000;
      const result = await pollGateUntilResolved(gateId, { maxWaitMs });

      if (result.status === 'Rejected') {
        console.log(`\n❌ Rejected. Notes: ${result.notes}`);
        console.log('Re-run with --auto-approve or address the feedback and run again.');
        return;
      }
      console.log('✅ Approved!\n');
    }

    // 9. Writer
    console.log('✍️  Running Writer...\n');
    const writerTaskId = await createTask(dbIds.taskBus, {
      title: `Write final output for: ${topic}`,
      createdBy: 'orchestrator',
      priority: 30,
    });
    const writerWmId = await createWorkingMemoryPage(dbIds.workingMemory, 'writer', writerTaskId, topic);
    const tWriter = performance.now();
    const outputPageId = await runWriterAgent(
      { taskId: writerTaskId, workingMemoryId: writerWmId, topic, subTopic: topic, dbIds },
      synthesisPageId,
    );
    console.log(`✅ Writer done (${elapsed(tWriter)})\n`);

    const totalTime = elapsed(runStart);
    console.log(`🎉 Done in ${totalTime}! Intelligence brief: ${notionUrl(outputPageId)}\n`);
  } finally {
    await mcp.close();
  }
}
