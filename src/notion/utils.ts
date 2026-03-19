// Formats a Notion page/database ID into a clickable https://notion.so URL.
// Notion web URLs use the unhyphenated 32-char hex form, not UUIDs.
export function notionUrl(pageId: string): string {
  return `https://notion.so/${pageId.replace(/-/g, '')}`;
}
