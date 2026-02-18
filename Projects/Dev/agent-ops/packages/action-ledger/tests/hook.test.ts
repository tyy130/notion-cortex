import { describe, expect, it } from 'vitest';
import { detectHookSource, normalizeHookPayload, parseHookSourceHint } from '../src/hook';

describe('hook source detection', () => {
  it('detects claude payloads', () => {
    const source = detectHookSource({
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      tool_response: { output: 'ok', is_error: false },
    });
    expect(source).toBe('claude');
  });

  it('detects copilot payloads', () => {
    const source = detectHookSource({
      toolName: 'Read',
      toolInput: { path: 'src/index.ts' },
      toolOutput: { output: '...' },
    });
    expect(source).toBe('copilot');
  });

  it('detects gemini payloads', () => {
    const source = detectHookSource({
      functionCall: { name: 'search', arguments: '{"query":"agent ops"}' },
    });
    expect(source).toBe('gemini');
  });

  it('detects codex payloads', () => {
    const source = detectHookSource({
      source: 'codex',
      tool: 'edit_file',
      arguments: { path: 'src/a.ts' },
    });
    expect(source).toBe('codex');
  });

  it('detects aider payloads', () => {
    const source = detectHookSource({
      command: 'git status',
      stdout: 'M src/index.ts',
      exit_code: 0,
    });
    expect(source).toBe('aider');
  });
});

describe('hook payload normalization', () => {
  it('normalizes claude payloads', () => {
    const normalized = normalizeHookPayload({
      tool_name: 'Bash',
      tool_input: { command: 'ls -la' },
      tool_response: { output: 'file.txt', is_error: false },
      duration_ms: 25,
    });

    expect(normalized.tool).toBe('Bash');
    expect(normalized.input).toEqual({ command: 'ls -la' });
    expect(normalized.output).toBe('file.txt');
    expect(normalized.outcome).toBe('success');
    expect(normalized.hook_source).toBe('claude');
    expect(normalized.duration_ms).toBe(25);
  });

  it('normalizes copilot payloads with errors', () => {
    const normalized = normalizeHookPayload({
      toolName: 'Read',
      toolInput: { path: 'src/index.ts' },
      toolOutput: { error: 'file missing', isError: true },
    });

    expect(normalized.outcome).toBe('error');
    expect(normalized.error).toBe('file missing');
    expect(normalized.hook_source).toBe('copilot');
  });

  it('normalizes gemini functionCall arguments from json string', () => {
    const normalized = normalizeHookPayload({
      functionCall: { name: 'search', arguments: '{"query":"agent ops"}' },
      response: { output: 'found 1 result' },
    });

    expect(normalized.tool).toBe('search');
    expect(normalized.input).toEqual({ query: 'agent ops' });
    expect(normalized.output).toBe('found 1 result');
    expect(normalized.hook_source).toBe('gemini');
  });

  it('normalizes codex payloads', () => {
    const normalized = normalizeHookPayload({
      source: 'codex',
      tool: 'edit_file',
      arguments: { path: 'src/index.ts' },
      result: { output: 'patched' },
    });

    expect(normalized.tool).toBe('edit_file');
    expect(normalized.input).toEqual({ path: 'src/index.ts' });
    expect(normalized.output).toBe('patched');
    expect(normalized.hook_source).toBe('codex');
  });

  it('normalizes aider payloads and treats non-zero exit as error', () => {
    const normalized = normalizeHookPayload({
      command: 'pytest -q',
      stdout: '2 failed',
      stderr: 'traceback',
      exit_code: 1,
    });

    expect(normalized.tool).toBe('UnknownTool');
    expect(normalized.input).toEqual({ command: 'pytest -q' });
    expect(normalized.outcome).toBe('error');
    expect(normalized.error).toBe('traceback');
    expect(normalized.hook_source).toBe('aider');
  });

  it('supports explicit source hint', () => {
    const normalized = normalizeHookPayload(
      {
        tool: 'Bash',
        input: { command: 'echo hi' },
      },
      'copilot',
    );

    expect(normalized.hook_source).toBe('copilot');
  });
});

describe('hook source hints', () => {
  it('parses known hints and rejects unknown values', () => {
    expect(parseHookSourceHint('claude')).toBe('claude');
    expect(() => parseHookSourceHint('unsupported')).toThrow(
      'Unsupported hook source hint: unsupported',
    );
  });
});
