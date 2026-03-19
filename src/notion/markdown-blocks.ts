// Converts a markdown string into Notion block objects suitable for
// blocks.children.append. Handles headings, bullets, numbered lists,
// tables, paragraphs, and inline bold/italic/code annotations.

interface RichTextItem {
  type: 'text';
  text: { content: string };
  annotations?: { bold?: boolean; italic?: boolean; code?: boolean };
}

type NotionBlock = Record<string, unknown>;

interface RichTextLink extends RichTextItem {
  text: { content: string; link?: { url: string } };
}

// Splits a line into annotated rich_text segments.
// Recognises [text](url) links, **bold**, *italic*, and `code` spans.
function parseInline(text: string): RichTextLink[] {
  const items: RichTextLink[] = [];
  const pattern = /\[([^\]]+)\]\(([^)]+)\)|\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|([^*`\[]+)/g;

  for (const match of text.matchAll(pattern)) {
    if (match[1] !== undefined && match[2] !== undefined) {
      // [label](url) link
      items.push({ type: 'text', text: { content: match[1], link: { url: match[2] } } });
    } else if (match[3] !== undefined) {
      items.push({ type: 'text', text: { content: match[3] }, annotations: { bold: true } });
    } else if (match[4] !== undefined) {
      items.push({ type: 'text', text: { content: match[4] }, annotations: { italic: true } });
    } else if (match[5] !== undefined) {
      items.push({ type: 'text', text: { content: match[5] }, annotations: { code: true } });
    } else if (match[6] !== undefined && match[6].length > 0) {
      items.push({ type: 'text', text: { content: match[6] } });
    }
  }

  return items;
}

function headingBlock(level: 1 | 2 | 3, text: string): NotionBlock {
  const type = `heading_${level}` as const;
  return { object: 'block', type, [type]: { rich_text: parseInline(text) } };
}

function bulletBlock(text: string): NotionBlock {
  return {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: parseInline(text) },
  };
}

function numberedBlock(text: string): NotionBlock {
  return {
    object: 'block',
    type: 'numbered_list_item',
    numbered_list_item: { rich_text: parseInline(text) },
  };
}

function paragraphBlock(text: string): NotionBlock {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: parseInline(text) },
  };
}

// Parses markdown table lines into a Notion table block (with rows inline).
// Returns null if the table has no data rows.
function tableBlock(lines: string[]): NotionBlock | null {
  // Drop separator rows (|---|---|)
  const dataLines = lines.filter(l => !/^\|[\s:\-|]+\|$/.test(l));
  if (dataLines.length === 0) return null;

  const rows = dataLines.map(line =>
    line
      .split('|')
      .slice(1, -1)
      .map(cell => parseInline(cell.trim())),
  );

  const tableWidth = Math.max(...rows.map(r => r.length));

  return {
    object: 'block',
    type: 'table',
    table: {
      table_width: tableWidth,
      has_column_header: true,
      has_row_header: false,
      children: rows.map(cells => ({
        object: 'block',
        type: 'table_row',
        table_row: { cells },
      })),
    },
  };
}

export function markdownToNotionBlocks(markdown: string): NotionBlock[] {
  const lines = markdown.split('\n');
  const blocks: NotionBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('# ')) {
      blocks.push(headingBlock(1, line.slice(2).trim()));
      i++; continue;
    }
    if (line.startsWith('## ')) {
      blocks.push(headingBlock(2, line.slice(3).trim()));
      i++; continue;
    }
    if (line.startsWith('### ')) {
      blocks.push(headingBlock(3, line.slice(4).trim()));
      i++; continue;
    }
    // Notion only supports h1–h3; map ####+ to h3.
    if (/^#{4,}\s/.test(line)) {
      blocks.push(headingBlock(3, line.replace(/^#+\s+/, '')));
      i++; continue;
    }

    if (line.startsWith('- ') || line.startsWith('* ')) {
      blocks.push(bulletBlock(line.slice(2)));
      i++; continue;
    }

    const numberedMatch = line.match(/^\d+\.\s+(.+)/);
    if (numberedMatch) {
      blocks.push(numberedBlock(numberedMatch[1]));
      i++; continue;
    }

    // Fenced code blocks (``` ... ```)
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i++]);
      }
      i++; // skip closing ```
      blocks.push({
        object: 'block',
        type: 'code',
        code: {
          rich_text: [{ type: 'text', text: { content: codeLines.join('\n') } }],
          language: lang || 'plain text',
        },
      });
      continue;
    }

    // Collect all consecutive table lines together
    if (line.startsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        tableLines.push(lines[i++]);
      }
      const block = tableBlock(tableLines);
      if (block) blocks.push(block);
      continue;
    }

    if (line.trim() === '') {
      i++; continue;
    }

    blocks.push(paragraphBlock(line));
    i++;
  }

  return blocks;
}
