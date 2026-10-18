import { describe, expect, test } from 'bun:test';
import {
  finishRun,
  recordEvent,
  startRun,
  upsertVolume,
} from '@file-seiri/ledger';
import { createViewerApp } from './app.ts';
import { get, makeSource, NOW } from './test-support.ts';

/** SSE の応答から、指定の種類のメッセージが、`count` 件そろうまで読む(時間切れなら、そこまで) */
const readMessages = async (
  response: Response,
  until: (messages: { event: string; data: string }[]) => boolean,
  timeoutMs = 3000
): Promise<{ event: string; data: string }[]> => {
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  const messages: { event: string; data: string }[] = [];
  let buffer = '';
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !until(messages)) {
    const chunk = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value: undefined }>((resolve) =>
        setTimeout(() => resolve({ done: true, value: undefined }), 200)
      ),
    ]);
    if (chunk.value) buffer += decoder.decode(chunk.value);
    for (;;) {
      const end = buffer.indexOf('\n\n');
      if (end < 0) break;
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const event = /^event: (.*)$/m.exec(block)?.[1] ?? 'message';
      const data = /^data: (.*)$/m.exec(block)?.[1] ?? '';
      messages.push({ event, data });
    }
  }
  await reader.cancel();
  return messages;
};

const seedRunning = (source: ReturnType<typeof makeSource>) => {
  const { db } = source.ledger;
  const volume = upsertVolume(db, {
    volumeUuid: 'v',
    label: 'SD',
    seenAt: NOW,
  });
  const runId = startRun(db, {
    sourceVolumeId: volume.volumeId,
    isDryRun: false,
    startedAt: NOW,
  });
  return { db, runId };
};

describe('GET /api/live(SSE)', () => {
  test('実行中の進み具合と、直近のログを、つないだときに送る。新しいログも、流れてくる', async () => {
    const source = makeSource({ source: 'working', liveIntervalMs: 20 });
    const { db, runId } = seedRunning(source);
    recordEvent(db, {
      runId,
      level: 'INFO',
      code: 'RUN_START',
      message: 'はじめ',
      occurredAt: NOW,
    });
    recordEvent(db, {
      runId,
      level: 'DEBUG',
      code: 'NOISE',
      message: 'debug',
      occurredAt: NOW,
    });
    const app = createViewerApp(source);
    const response = await get(app, '/api/live');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    // 後から、ログが増える(取り込みが、書き込んだ想定)
    setTimeout(() => {
      recordEvent(db, {
        runId,
        level: 'WARN',
        code: 'FALLBACK',
        message: 'あとから',
        occurredAt: NOW,
      });
    }, 80);
    const messages = await readMessages(response, (all) =>
      all.some((m) => m.event === 'log' && m.data.includes('あとから'))
    );
    const progress = messages.find((m) => m.event === 'progress');
    expect(progress).toBeDefined();
    expect(JSON.parse(progress?.data ?? '{}').running.runId).toBe(runId);
    const logs = messages
      .filter((m) => m.event === 'log')
      .flatMap((m) => JSON.parse(m.data).events as { code: string }[]);
    // DEBUG は、流さない。INFO 以上だけ
    expect(logs.map((event) => event.code)).toEqual(['RUN_START', 'FALLBACK']);
  });

  test('実行が終われば、進み具合は、null になる', async () => {
    const source = makeSource({ source: 'working', liveIntervalMs: 20 });
    const { db, runId } = seedRunning(source);
    const response = await get(createViewerApp(source), '/api/live');
    setTimeout(() => {
      finishRun(db, runId, {
        status: 'completed',
        finishedAt: NOW,
        revisionAfter: 1,
      });
    }, 80);
    const messages = await readMessages(
      response,
      (all) => all.filter((m) => m.event === 'progress').length >= 2
    );
    const progresses = messages
      .filter((m) => m.event === 'progress')
      .map((m) => JSON.parse(m.data).running);
    expect(progresses[0]?.runId).toBe(runId);
    expect(progresses.at(-1)).toBeNull();
  });

  test('スナップショットでは、リアルタイムは、ない(404)', async () => {
    const source = makeSource({ source: 'snapshot' });
    expect((await get(createViewerApp(source), '/api/live')).status).toBe(404);
  });
});
