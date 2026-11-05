/**
 * A data channel does not compress, and a view of a large army is about 28 KB of
 * repetitive JSON. Raw deflate takes it to about 1.5 KB (docs/BENCHMARKS.md).
 */
export async function deflate(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Inflate, refusing output past `limit` bytes so a small packet cannot expand into a huge one. */
export async function inflate(bytes: Uint8Array, limit: number): Promise<string | null> {
  try {
    const stream = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const joined = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) {
      joined.set(chunk, at);
      at += chunk.length;
    }
    return new TextDecoder().decode(joined);
  } catch {
    return null;
  }
}
