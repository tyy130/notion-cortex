import { describe, it, expect } from 'vitest';
import { notionUrl } from '../../src/notion/utils.js';

describe('notionUrl', () => {
  it('strips dashes from a UUID page ID', () => {
    expect(notionUrl('3273f827-ea93-815d-9e67-f6ce92db0165'))
      .toBe('https://notion.so/3273f827ea93815d9e67f6ce92db0165');
  });

  it('passes through an already-unhyphenated ID', () => {
    expect(notionUrl('3273f827ea93815d9e67f6ce92db0165'))
      .toBe('https://notion.so/3273f827ea93815d9e67f6ce92db0165');
  });

  it('handles IDs of non-standard length gracefully', () => {
    expect(notionUrl('short-id')).toBe('https://notion.so/shortid');
  });
});
