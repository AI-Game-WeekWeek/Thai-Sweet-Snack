import { WebSocket } from 'ws';
import type { Bridge } from './bridge';

export interface TikFinityClient {
  stop(): void;
}

/**
 * Connects to an event stream (TikFinity's local WebSocket, if your TikFinity offers one) as a CLIENT and feeds every
 * message into the bridge. Retries with backoff and never throws: if nothing is listening the game simply gets no
 * events from it. The address is configurable because it is not verified for every TikFinity version.
 */
export function startTikFinityClient(bridge: Bridge, url: string, log: (m: string) => void = () => {}): TikFinityClient {
  let ws: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let delay = 2000;
  let warned = false;

  const connect = (): void => {
    if (stopped) return;
    try {
      ws = new WebSocket(url, { maxPayload: 256 * 1024 });
    } catch {
      return schedule();
    }
    ws.on('open', () => {
      delay = 2000;
      warned = false;
      bridge.setSourceState('TikFinity: เชื่อมต่อแล้ว (' + url + ')');
      log('TikFinity เชื่อมต่อแล้ว');
    });
    ws.on('message', (data) => {
      try {
        bridge.ingestTikFinity(JSON.parse(String(data)));
      } catch {
        /* not JSON: ignore */
      }
    });
    ws.on('error', () => {
      /* closed handler reconnects */
    });
    ws.on('close', () => {
      bridge.setSourceState('TikFinity: ยังไม่เจอที่ ' + url + ' (กำลังลองใหม่)');
      if (!warned) {
        warned = true;
        log('ยังต่อ TikFinity ไม่ได้ที่ ' + url + ' จะลองใหม่เรื่อยๆ (ถ้าพอร์ตไม่ตรง ตั้ง TIKFINITY_WS=ws://... หรือใช้ลิงก์ webhook แทน)');
      }
      schedule();
    });
  };
  const schedule = (): void => {
    if (stopped) return;
    timer = setTimeout(connect, delay);
    delay = Math.min(30_000, delay * 1.7);
  };
  connect();
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      try {
        ws?.terminate();
      } catch {
        /* already closed */
      }
    },
  };
}
