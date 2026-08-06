/**
 * A simple client-side fetch wrapper that batches multiple GET requests
 * into a single POST to /api/batch.
 */

type BatchRequest = {
  key: string;
  path: string;
};

type BatchResponse = {
  results: Record<string, { status: number; data: any }>;
};

let inFlightBatch: BatchRequest[] = [];
let batchTimeout: ReturnType<typeof setTimeout> | null = null;
let batchPromise: Promise<BatchResponse> | null = null;
let batchResolvers: Array<(val: BatchResponse) => void> = [];
let batchRejecters: Array<(err: any) => void> = [];

export function apiBatch(key: string, path: string): Promise<any> {
  return new Promise((resolve, reject) => {
    inFlightBatch.push({ key, path });

    if (!batchPromise) {
      batchPromise = new Promise<BatchResponse>((res, rej) => {
        batchResolvers.push(res);
        batchRejecters.push(rej);
      });
    }

    const currentPromise = batchPromise;

    if (batchTimeout) {
      clearTimeout(batchTimeout);
    }

    batchTimeout = setTimeout(async () => {
      const requestsToProcess = [...inFlightBatch];
      inFlightBatch = [];
      batchTimeout = null;
      batchPromise = null;
      const resolversToCall = [...batchResolvers];
      const rejectersToCall = [...batchRejecters];
      batchResolvers = [];
      batchRejecters = [];

      try {
        const res = await fetch("/api/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requests: requestsToProcess }),
        });
        const data = await res.json();
        resolversToCall.forEach(r => r(data));
      } catch (err) {
        rejectersToCall.forEach(r => r(err));
      }
    }, 5); // 5ms batch window

    currentPromise.then(
      (data) => {
        const result = data?.results?.[key];
        if (result?.status === 200) {
          resolve(result.data);
        } else {
          reject(new Error(`Batch request failed for ${key} with status ${result?.status}`));
        }
      },
      (err) => reject(err)
    );
  });
}
