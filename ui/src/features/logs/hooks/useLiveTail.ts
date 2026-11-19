import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { LogDatasourceAdapter, NormalizedLogEntry } from '../api/logDatasource';

const LIVE_POLL_INTERVAL_MS = 1000;
const LIVE_FLUSH_INTERVAL_MS = 250;
export const MAX_LIVE_BUFFER_LINES = 2000;

export function useLiveTail({
  logAdapter,
  effectiveQuery,
  lineBreak,
  onClearSelection,
}: {
  logAdapter: LogDatasourceAdapter | null;
  effectiveQuery: string;
  lineBreak: boolean;
  onClearSelection: () => void;
}) {
  const [liveMode, setLiveMode] = useState(false);
  const [liveEntries, setLiveEntries] = useState<NormalizedLogEntry[]>([]);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const livePendingBufferRef = useRef<NormalizedLogEntry[]>([]);
  const liveScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const isProgrammaticScrollRef = useRef(false);

  // Live Tail: 1s incremental delta-polling + 250ms batched UI flush + 2,000-line FIFO ring buffer
  useEffect(() => {
    if (!liveMode || !logAdapter) return;

    setLiveError(null);
    setLiveEntries([]);
    livePendingBufferRef.current = [];

    const handle = logAdapter.startLiveTail({
      query: effectiveQuery,
      pollIntervalMs: LIVE_POLL_INTERVAL_MS,
      initialLookbackSeconds: 60,
      limitPerPoll: 500,
      onEntries: (batch) => {
        if (batch.length > 0) {
          livePendingBufferRef.current.push(...batch);
        }
      },
      onError: (err) => {
        setLiveError(err.message);
      },
    });

    const flushTimer = window.setInterval(() => {
      if (livePendingBufferRef.current.length === 0) return;
      const batch = livePendingBufferRef.current.splice(0);
      setLiveEntries((prev) => {
        const combined = prev.length === 0 ? batch : [...prev, ...batch];
        return combined.length > MAX_LIVE_BUFFER_LINES
          ? combined.slice(combined.length - MAX_LIVE_BUFFER_LINES)
          : combined;
      });
    }, LIVE_FLUSH_INTERVAL_MS);

    return () => {
      handle.stop();
      window.clearInterval(flushTimer);
      livePendingBufferRef.current = [];
    };
  }, [liveMode, logAdapter, effectiveQuery]);

  const liveVirtualizer = useVirtualizer({
    count: liveMode ? liveEntries.length : 0,
    getScrollElement: () => liveScrollContainerRef.current,
    estimateSize: () => (lineBreak ? 56 : 36),
    overscan: 12,
  });

  useEffect(() => {
    if (!liveMode || !autoScroll || liveEntries.length === 0) return;
    isProgrammaticScrollRef.current = true;
    liveVirtualizer.scrollToIndex(liveEntries.length - 1, { align: 'end' });
    const raf = window.requestAnimationFrame(() => {
      isProgrammaticScrollRef.current = false;
    });
    return () => window.cancelAnimationFrame(raf);
  }, [liveMode, autoScroll, liveEntries, liveVirtualizer]);

  const handleLiveScroll = useCallback(() => {
    if (!liveMode || isProgrammaticScrollRef.current) return;
    const el = liveScrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom > 48 && autoScroll) {
      setAutoScroll(false);
    } else if (distanceFromBottom <= 16 && !autoScroll) {
      setAutoScroll(true);
    }
  }, [liveMode, autoScroll]);

  const handleResumeLiveScroll = useCallback(() => {
    setAutoScroll(true);
    if (liveEntries.length > 0) {
      isProgrammaticScrollRef.current = true;
      liveVirtualizer.scrollToIndex(liveEntries.length - 1, { align: 'end' });
      window.requestAnimationFrame(() => {
        isProgrammaticScrollRef.current = false;
      });
    }
  }, [liveEntries.length, liveVirtualizer]);

  const handleClearLiveLogs = useCallback(() => {
    livePendingBufferRef.current = [];
    setLiveEntries([]);
    onClearSelection();
  }, [onClearSelection]);

  return {
    liveMode,
    setLiveMode,
    liveEntries,
    liveError,
    setLiveError,
    autoScroll,
    setAutoScroll,
    liveScrollContainerRef,
    liveVirtualizer,
    handleLiveScroll,
    handleResumeLiveScroll,
    handleClearLiveLogs,
  };
}
