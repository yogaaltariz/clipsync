import { describe, expect, it, vi } from 'vitest';
import { ConnectionHub } from '../src/ws/hub.js';

function fakeSocket() {
  return { readyState: 1, send: vi.fn(), close: vi.fn() } as any;
}

describe('ConnectionHub', () => {
  it('broadcasts an event to every added socket', () => {
    const hub = new ConnectionHub();
    const a = fakeSocket();
    const b = fakeSocket();
    hub.add('device-a', a);
    hub.add('device-b', b);
    hub.broadcast({ type: 'clipboard.cleared' });
    expect(a.send).toHaveBeenCalledWith(JSON.stringify({ type: 'clipboard.cleared' }));
    expect(b.send).toHaveBeenCalledWith(JSON.stringify({ type: 'clipboard.cleared' }));
  });

  it('stops sending to a removed socket', () => {
    const hub = new ConnectionHub();
    const a = fakeSocket();
    hub.add('device-a', a);
    hub.remove('device-a', a);
    hub.broadcast({ type: 'clipboard.cleared' });
    expect(a.send).not.toHaveBeenCalled();
  });

  it('closes and forgets every socket for a disconnected device', () => {
    const hub = new ConnectionHub();
    const a = fakeSocket();
    hub.add('device-a', a);
    hub.disconnectDevice('device-a');
    expect(a.close).toHaveBeenCalled();
    hub.broadcast({ type: 'clipboard.cleared' });
    expect(a.send).not.toHaveBeenCalled();
  });
});
