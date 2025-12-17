import { createSHA256 } from 'hash-wasm';

self.onmessage = async (e) => {
  const { file } = e.data;

  const hasher = await createSHA256();
  const reader = file.stream().getReader();

  let processed = 0;
  const total = file.size;

  const startTime = performance.now();
  let lastPost = startTime;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    hasher.update(value);
    processed += value.length;

    const now = performance.now();

    if (now - lastPost > 16) {
      self.postMessage({
        type: 'progress',
        processed,
        total,
        elapsedMs: now - startTime
      });
      lastPost = now;
    }
  }

  const endTime = performance.now();
  self.postMessage({
    type: 'progress',
    processed: total,
    total,
    elapsedMs: endTime - startTime
  });

  const hashBytes = hasher.digest('binary');
  let binary = '';
  for (let i = 0; i < hashBytes.length; i++) {
    binary += String.fromCharCode(hashBytes[i]);
  }

  self.postMessage({
    type: 'done',
    hash: btoa(binary),
    elapsedMs: endTime - startTime
  });
};
