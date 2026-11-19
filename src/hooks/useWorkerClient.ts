import { useCallback, useEffect, useRef } from 'react';
import ProcessorWorker from '../processing.worker?worker&inline';
import type { ImportProgress, WorkerResponse } from '../worker/types';

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: ImportProgress) => void;
}

export function useWorkerClient() {
  const worker = useRef<Worker | null>(null);
  const sequence = useRef(0);
  const pending = useRef(new Map<number, Pending>());
  const stop = useCallback(() => {
    worker.current?.terminate(); worker.current = null;
    for (const entry of pending.current.values()) entry.reject(new Error('Cancelled'));
    pending.current.clear();
  }, []);
  const request = useCallback(<T,>(message: Record<string, unknown>, onProgress?: Pending['onProgress']): Promise<T> => {
    if (!worker.current) {
      const active = new ProcessorWorker();
      worker.current = active;
      active.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const entry = pending.current.get(event.data.id);
        if (!entry) return;
        if ('progress' in event.data) { entry.onProgress?.(event.data.progress); return; }
        pending.current.delete(event.data.id);
        if ('error' in event.data) entry.reject(new Error(event.data.error)); else entry.resolve(event.data.data);
      };
      active.onerror = () => {
        for (const entry of pending.current.values()) entry.reject(new Error('The local worker stopped. Import the file again.'));
        pending.current.clear(); active.terminate();
        if (worker.current === active) worker.current = null;
      };
    }
    return new Promise<T>((resolve, reject) => {
      const id = ++sequence.current;
      pending.current.set(id, { resolve: value => resolve(value as T), reject, onProgress });
      try { worker.current!.postMessage({ ...message, id }); }
      catch { pending.current.delete(id); reject(new Error('Unable to start local processing. Import the file again.')); }
    });
  }, []);
  useEffect(() => stop, [stop]);
  return { request, stop };
}
