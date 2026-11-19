/// <reference lib="webworker" />
import { WorkerEngine } from './worker/engine';
import type { WorkerRequest } from './worker/types';

const engine = new WorkerEngine();

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  void engine.handle(request, progress => self.postMessage({ id: request.id, progress })).then(data => {
    if (data && 'buffer' in data) self.postMessage({ id: request.id, data }, [data.buffer]);
    else self.postMessage({ id: request.id, data });
  }).catch(error => {
    self.postMessage({ id: request?.id, error: error instanceof Error ? error.message : 'Unable to process this file.' });
  });
};
