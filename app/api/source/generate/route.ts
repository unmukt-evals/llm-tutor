// app/api/source/generate/route.ts
// POST { sourceText, targetModuleId? } → { candidate, oldMarkdown, oldPoolJson, moduleFileName }.
// Server-only: runs the LLM (OAuth/keychain via getLLMClient), validates the
// candidate. The access token NEVER appears in the response — only the proposed
// files + the prior (old) markdown/pool so the client can render a diff.
import { NextResponse } from 'next/server';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getLLMClient } from '@/lib/llm/client';
import { generateCandidate } from '@/lib/llm/generate';
import type { GenerateInput } from '@/lib/llm/types';

export const dynamic = 'force-dynamic';

function getCurriculumDir(): string {
  const dir = process.env.CURRICULUM_DIR;
  if (!dir) throw new Error('CURRICULUM_DIR env var is not set. Point it to your curriculum folder.');
  return dir;
}

/** Find the existing module .md file for a given module id (filename prefix match). */
async function findModuleFile(dir: string, moduleId: string): Promise<string | null> {
  const entries = await readdir(dir);
  const match = entries.find((f) => f.endsWith('.md') && f.startsWith(`${moduleId}-`));
  if (match) return match;
  const exact = entries.find((f) => f === `${moduleId}.md`);
  return exact ?? null;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { sourceText, targetModuleId } = (body ?? {}) as {
    sourceText?: unknown;
    targetModuleId?: unknown;
  };
  if (typeof sourceText !== 'string' || sourceText.trim().length === 0) {
    return NextResponse.json({ error: 'Body must include non-empty sourceText' }, { status: 400 });
  }

  let dir: string;
  try {
    dir = getCurriculumDir();
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }

  const input: GenerateInput = { sourceText };
  let oldMarkdown = '';
  let oldPoolJson = '';
  let moduleFileName: string | null = null;

  // "new" or blank → propose a new module; any other string → update that module.
  if (typeof targetModuleId === 'string' && targetModuleId.length > 0 && targetModuleId !== 'new') {
    input.targetModuleId = targetModuleId;
    try {
      moduleFileName = await findModuleFile(dir, targetModuleId);
      if (moduleFileName) {
        oldMarkdown = await readFile(join(dir, moduleFileName), 'utf8').catch(() => '');
        if (oldMarkdown) input.existingMarkdown = oldMarkdown;
      }
      oldPoolJson = await readFile(join(dir, 'mcq', `${targetModuleId}.json`), 'utf8').catch(() => '');
      if (oldPoolJson) input.existingPoolJson = oldPoolJson;
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  }

  try {
    const client = getLLMClient();
    const candidate = await generateCandidate(client, input);
    return NextResponse.json({
      candidate,
      oldMarkdown,
      oldPoolJson,
      moduleFileName, // null → a NEW module (apply derives the default filename)
    });
  } catch (err) {
    // Includes the actionable "token expired — run any Claude Code command" message;
    // the access token itself is never read into this scope.
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
