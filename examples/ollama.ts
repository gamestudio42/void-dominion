#!/usr/bin/env node
/**
 * Ollama-powered agent example for Agent Arena (OPTIONAL - not required for tests).
 * This demonstrates integration with a language model for strategic decision-making.
 * Run: OLLAMA_MODEL=llama3.2 node --experimental-transform-types examples/ollama.ts
 *
 * Prerequisites:
 * - Ollama installed and running (https://ollama.ai)
 * - A model pulled: ollama pull llama3.2
 */

import { createJsonlReader, createJsonlWriter, SCHEMA_VERSION, validateObserveRequest } from '../packages/agent-sdk/src/index.ts';

const reader = createJsonlReader(process.stdin);
const writer = createJsonlWriter(process.stdout);

const OLLAMA_API = process.env.OLLAMA_API ?? 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'llama3.2';

interface OllamaResponse {
  response: string;
  done: boolean;
}

async function callOllama(prompt: string): Promise<string> {
  const response = await fetch(`${OLLAMA_API}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama API error: ${response.status}`);
  }

  const data = (await response.json()) as OllamaResponse;
  return data.response;
}

function buildPrompt(request: ReturnType<typeof validateObserveRequest>): string {
  if (!request) return '';
  return `You are commanding units in an RTS game. Current state:
- Tick: ${request.tick}
- Resources: ${request.ore} ore, ${request.aether} aether
- Units: ${request.units.length}
- Buildings: ${request.buildings.length}
- Nodes: ${request.nodes.length}

Respond with ONE action in JSON format:
{"type": "noop"}

Keep your response brief.`;
}

async function main() {
  while (true) {
    const message = await reader.read();
    if (message === null) break;

    const request = validateObserveRequest(message);
    if (!request) {
      console.error('Invalid request received');
      continue;
    }

    try {
      const prompt = buildPrompt(request);
      const _response = await callOllama(prompt);

      await writer.write({
        schemaVersion: SCHEMA_VERSION,
        requestId: request.requestId,
        type: 'agent.act',
        actions: [{ type: 'noop' }],
      });
    } catch (err) {
      console.error('Ollama error:', err);
      await writer.write({
        schemaVersion: SCHEMA_VERSION,
        requestId: request.requestId,
        type: 'agent.act',
        actions: [{ type: 'noop' }],
      });
    }
  }
}

main().catch((err) => {
  console.error('Ollama agent error:', err);
  process.exit(1);
});
