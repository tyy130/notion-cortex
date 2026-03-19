import { describe, it, expect } from 'vitest';
import { markdownToNotionBlocks } from '../../src/notion/markdown-blocks.js';

describe('markdownToNotionBlocks', () => {
  it('converts headings h1–h3', () => {
    const blocks = markdownToNotionBlocks('# Title\n## Section\n### Sub');
    expect(blocks[0]).toMatchObject({ type: 'heading_1', heading_1: { rich_text: [{ text: { content: 'Title' } }] } });
    expect(blocks[1]).toMatchObject({ type: 'heading_2', heading_2: { rich_text: [{ text: { content: 'Section' } }] } });
    expect(blocks[2]).toMatchObject({ type: 'heading_3', heading_3: { rich_text: [{ text: { content: 'Sub' } }] } });
  });

  it('converts bullet and numbered list items', () => {
    const blocks = markdownToNotionBlocks('- alpha\n- beta\n1. first\n2. second');
    expect(blocks[0]).toMatchObject({ type: 'bulleted_list_item' });
    expect(blocks[1]).toMatchObject({ type: 'bulleted_list_item' });
    expect(blocks[2]).toMatchObject({ type: 'numbered_list_item' });
    expect(blocks[3]).toMatchObject({ type: 'numbered_list_item' });
  });

  it('applies inline bold, italic, and code annotations', () => {
    const blocks = markdownToNotionBlocks('**bold** and *italic* and `code`');
    const richText = (blocks[0] as any).paragraph.rich_text;
    expect(richText.find((t: any) => t.annotations?.bold)?.text.content).toBe('bold');
    expect(richText.find((t: any) => t.annotations?.italic)?.text.content).toBe('italic');
    expect(richText.find((t: any) => t.annotations?.code)?.text.content).toBe('code');
  });

  it('converts a markdown table into a Notion table block', () => {
    const md = '| Name | Type |\n|------|------|\n| GitHub Copilot | product |';
    const blocks = markdownToNotionBlocks(md);
    expect(blocks).toHaveLength(1);
    const table = blocks[0] as any;
    expect(table.type).toBe('table');
    expect(table.table.has_column_header).toBe(true);
    expect(table.table.table_width).toBe(2);
    // Header row
    expect(table.table.children[0].table_row.cells[0][0].text.content).toBe('Name');
    // Data row
    expect(table.table.children[1].table_row.cells[0][0].text.content).toBe('GitHub Copilot');
  });

  it('skips blank lines and returns plain paragraphs for undecorated text', () => {
    const blocks = markdownToNotionBlocks('Hello world\n\nSecond paragraph');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ type: 'paragraph' });
    expect(blocks[1]).toMatchObject({ type: 'paragraph' });
  });

  it('returns empty array for blank input', () => {
    expect(markdownToNotionBlocks('')).toEqual([]);
    expect(markdownToNotionBlocks('   \n\n   ')).toEqual([]);
  });

  it('converts markdown links to Notion rich_text with link.url', () => {
    const blocks = markdownToNotionBlocks('Visit [Cursor](https://cursor.sh) for more.');
    const richText = (blocks[0] as any).paragraph.rich_text;
    const linkSegment = richText.find((t: any) => t.text?.link?.url);
    expect(linkSegment?.text.content).toBe('Cursor');
    expect(linkSegment?.text.link.url).toBe('https://cursor.sh');
  });

  it('converts fenced code blocks to Notion code blocks with language', () => {
    const blocks = markdownToNotionBlocks('```typescript\nconst x = 1;\n```');
    expect(blocks[0]).toMatchObject({ type: 'code', code: { language: 'typescript' } });
    expect((blocks[0] as any).code.rich_text[0].text.content).toBe('const x = 1;');
  });

  it('maps ####+ headings to h3 (Notion max depth)', () => {
    const blocks = markdownToNotionBlocks('#### Deep\n##### Deeper\n###### Deepest');
    expect(blocks).toHaveLength(3);
    for (const block of blocks) {
      expect(block).toMatchObject({ type: 'heading_3' });
    }
    expect((blocks[0] as any).heading_3.rich_text[0].text.content).toBe('Deep');
    expect((blocks[1] as any).heading_3.rich_text[0].text.content).toBe('Deeper');
    expect((blocks[2] as any).heading_3.rich_text[0].text.content).toBe('Deepest');
  });
});
