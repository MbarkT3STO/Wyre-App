/**
 * checksumWorker.ts
 * Worker-thread script that computes a SHA-256 checksum of a file.
 * Runs off the main thread so large-file hashing does not block the event loop
 * (and therefore does not delay the TCP handshake or UI updates).
 *
 * Communication protocol:
 *   parentPort.postMessage({ filePath: string })   → start hashing
 *   parentPort.postMessage({ checksum: string })   → result (success)
 *   parentPort.postMessage({ error: string })      → result (failure)
 */

import { workerData, parentPort } from 'worker_threads';
import { createReadStream } from 'fs';
import { createHash } from 'crypto';
import { TRANSFER_CHUNK_SIZE } from '../../shared/utils/constants';

function computeChecksum(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath, { highWaterMark: TRANSFER_CHUNK_SIZE });
    stream.on('data', (chunk: Buffer | string) => {
      hash.update(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

if (!parentPort) {
  throw new Error('checksumWorker must be run as a worker thread');
}

const { filePath } = workerData as { filePath: string };

computeChecksum(filePath)
  .then((checksum) => parentPort!.postMessage({ checksum }))
  .catch((err: Error) => parentPort!.postMessage({ error: err.message }));
