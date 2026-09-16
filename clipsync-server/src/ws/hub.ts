import type WebSocket from 'ws';
import type { ClipboardEvent } from '../types.js';

export class ConnectionHub {
  private socketsByDevice = new Map<string, Set<WebSocket>>();

  add(deviceId: string, socket: WebSocket): void {
    const set = this.socketsByDevice.get(deviceId) ?? new Set();
    set.add(socket);
    this.socketsByDevice.set(deviceId, set);
  }

  remove(deviceId: string, socket: WebSocket): void {
    this.socketsByDevice.get(deviceId)?.delete(socket);
  }

  broadcast(event: ClipboardEvent): void {
    const payload = JSON.stringify(event);
    for (const sockets of this.socketsByDevice.values()) {
      for (const socket of sockets) {
        if (socket.readyState === 1 /* OPEN */) socket.send(payload);
      }
    }
  }

  disconnectDevice(deviceId: string): void {
    const sockets = this.socketsByDevice.get(deviceId);
    if (!sockets) return;
    for (const socket of sockets) socket.close();
    this.socketsByDevice.delete(deviceId);
  }
}
