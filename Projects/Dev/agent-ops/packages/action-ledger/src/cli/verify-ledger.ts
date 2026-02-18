#!/usr/bin/env node

import { verifyLedgerFile } from '../index';

interface VerifyCliFlags {
  requireSignatures: boolean;
  signingSecret?: string;
  keySecrets: Record<string, string>;
  acceptedSchemaVersions: string[];
  allowMissingSchemaVersion: boolean;
  json: boolean;
  logPath?: string;
}

function parseKeySecret(value: string): [string, string] {
  const separatorIndex = value.indexOf('=');
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
    throw new Error(`Invalid --key-secret value: ${value}. Expected <keyId>=<secret>.`);
  }
  const keyId = value.slice(0, separatorIndex);
  const secret = value.slice(separatorIndex + 1);
  return [keyId, secret];
}

function parseFlags(args: string[], env: NodeJS.ProcessEnv): VerifyCliFlags {
  const flags: VerifyCliFlags = {
    requireSignatures: false,
    keySecrets: {},
    acceptedSchemaVersions: [],
    allowMissingSchemaVersion: true,
    json: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--require-signatures') {
      flags.requireSignatures = true;
      continue;
    }
    if (arg === '--signing-secret') {
      const value = args[index + 1];
      if (!value) {
        throw new Error('--signing-secret requires a value');
      }
      flags.signingSecret = value;
      index += 1;
      continue;
    }
    if (arg === '--key-secret') {
      const value = args[index + 1];
      if (!value) {
        throw new Error('--key-secret requires a value');
      }
      const [keyId, secret] = parseKeySecret(value);
      flags.keySecrets[keyId] = secret;
      index += 1;
      continue;
    }
    if (arg === '--accept-schema') {
      const value = args[index + 1];
      if (!value) {
        throw new Error('--accept-schema requires a value');
      }
      flags.acceptedSchemaVersions.push(value);
      index += 1;
      continue;
    }
    if (arg === '--disallow-missing-schema') {
      flags.allowMissingSchemaVersion = false;
      continue;
    }
    if (arg === '--json') {
      flags.json = true;
      continue;
    }
    if (arg.startsWith('--')) {
      throw new Error(`Unknown flag: ${arg}`);
    }
    if (!flags.logPath) {
      flags.logPath = arg;
      continue;
    }
    throw new Error(`Unexpected positional argument: ${arg}`);
  }

  flags.logPath = flags.logPath ?? env.AGENT_OPS_LOG_PATH ?? '.agent-ops/ledger.jsonl';
  if (!flags.signingSecret && env.AGENT_OPS_SIGNING_SECRET) {
    flags.signingSecret = env.AGENT_OPS_SIGNING_SECRET;
  }

  return flags;
}

export async function runVerifyLedgerCli(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  output: Pick<Console, 'log' | 'error'> = console,
): Promise<number> {
  const flags = parseFlags(args, env);
  const report = await verifyLedgerFile(flags.logPath!, {
    signingSecret: flags.signingSecret,
    signingSecretsByKeyId:
      Object.keys(flags.keySecrets).length > 0 ? flags.keySecrets : undefined,
    requireSignatures: flags.requireSignatures,
    acceptedSchemaVersions:
      flags.acceptedSchemaVersions.length > 0 ? flags.acceptedSchemaVersions : undefined,
    allowMissingSchemaVersion: flags.allowMissingSchemaVersion,
  });

  if (flags.json) {
    output.log(JSON.stringify(report));
  } else if (report.valid) {
    output.log(`Ledger verification passed (${report.entries} entries).`);
  } else {
    output.error(
      `Ledger verification failed (${report.entries} entries):\n- ${report.errors.join('\n- ')}`,
    );
  }

  return report.valid ? 0 : 1;
}

if (require.main === module) {
  runVerifyLedgerCli(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[action-ledger-verify] ${message}`);
      process.exit(1);
    },
  );
}
