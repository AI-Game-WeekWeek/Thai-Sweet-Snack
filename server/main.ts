import { createBridge } from './bridge';

const token = process.env.BRIDGE_TOKEN ?? '';
const bridge = createBridge({
  token,
  host: process.env.BRIDGE_HOST ?? '127.0.0.1',
  port: Number(process.env.BRIDGE_PORT) || 8787,
});

bridge.start().then(({ port }) => {
  console.log(`bridge listening on ${process.env.BRIDGE_HOST ?? '127.0.0.1'}:${port}`);
  console.log('POST events to /event with "Authorization: Bearer <BRIDGE_TOKEN>"; the game connects to ws://HOST:PORT/?token=<BRIDGE_TOKEN>');
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void bridge.stop().then(() => process.exit(0));
  });
}
