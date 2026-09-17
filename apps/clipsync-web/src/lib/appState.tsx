import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  exportPublicJwk,
  generateDeviceKeys,
  loadDeviceIdentity,
  saveDeviceIdentity,
  type DeviceIdentity,
} from './deviceIdentity.js';
import { createApiClient, type ApiClient, type ClipboardItemDto, type PeerDevice } from './apiClient.js';
import { createWsClient, type ConnectionStatus, type WsClient } from './wsClient.js';
import { deriveSharedKey, encryptContent, decryptContent } from './contentCrypto.js';
import { guessDeviceName } from './deviceName.js';
import type { PairingQrPayload } from './pairingQr.js';

const SERVER_BASE_URL = window.location.origin;

interface AppStateValue {
  identityLoading: boolean;
  identity: DeviceIdentity | null;
  peerDevices: PeerDevice[];
  items: ClipboardItemDto[];
  connectionStatus: ConnectionStatus;
  bootstrapAsHost: () => Promise<'became-host' | 'not-first-device'>;
  completePairingAsJoiner: (payload: PairingQrPayload) => Promise<void>;
  startInvitingNewDevice: () => Promise<{ token: string; expiresAt: string }>;
  refreshPeerDevices: () => Promise<void>;
  refreshItems: () => Promise<void>;
  addTextItem: (text: string) => Promise<void>;
  addImageItem: (blob: Blob) => Promise<void>;
  decryptItemText: (item: ClipboardItemDto) => Promise<string>;
  downloadBlob: (itemId: string) => Promise<Blob>;
  deleteItem: (id: string) => Promise<void>;
  clearHistory: () => Promise<void>;
  unpairDevice: (deviceId: string) => Promise<void>;
}

const AppStateContext = createContext<AppStateValue | null>(null);

export function useAppState(): AppStateValue {
  const value = useContext(AppStateContext);
  if (!value) throw new Error('useAppState must be used within AppStateProvider');
  return value;
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [identityLoading, setIdentityLoading] = useState(true);
  const [identity, setIdentity] = useState<DeviceIdentity | null>(null);
  const [peerDevices, setPeerDevices] = useState<PeerDevice[]>([]);
  const [items, setItems] = useState<ClipboardItemDto[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const pendingKeysRef = useRef<{ authKeyPair: CryptoKeyPair; exchangeKeyPair: CryptoKeyPair } | null>(null);

  useEffect(() => {
    loadDeviceIdentity()
      .then((loaded) => setIdentity(loaded))
      .finally(() => setIdentityLoading(false));
  }, []);

  const apiClient: ApiClient | null = useMemo(() => {
    if (!identity) return null;
    return createApiClient({
      baseUrl: SERVER_BASE_URL,
      deviceId: identity.deviceId,
      authPrivateKey: identity.authKeyPair.privateKey,
    });
  }, [identity]);

  const wsClientRef = useRef<WsClient | null>(null);

  useEffect(() => {
    if (!identity) return;
    const client = createWsClient({
      baseUrl: SERVER_BASE_URL,
      deviceId: identity.deviceId,
      authPrivateKey: identity.authKeyPair.privateKey,
      onStatusChange: setConnectionStatus,
      onEvent: (event) => {
        if (event.type === 'clipboard.created') {
          setItems((prev) => {
            const withoutExisting = prev.filter((item) => item.id !== event.item.id);
            return [event.item, ...withoutExisting];
          });
        } else if (event.type === 'clipboard.deleted') {
          setItems((prev) => prev.filter((item) => item.id !== event.id));
        } else if (event.type === 'clipboard.cleared') {
          setItems([]);
        }
      },
    });
    wsClientRef.current = client;
    return () => {
      client.close();
      wsClientRef.current = null;
    };
  }, [identity]);

  const refreshPeerDevices = useCallback(async () => {
    if (!apiClient) return;
    const { peerDevices: fetched } = await apiClient.listDevices();
    setPeerDevices(fetched);
  }, [apiClient]);

  const refreshItems = useCallback(async () => {
    if (!apiClient) return;
    const { items: fetched } = await apiClient.listClipboard();
    setItems(fetched);
  }, [apiClient]);

  useEffect(() => {
    if (!apiClient) return;
    refreshPeerDevices();
    refreshItems();
  }, [apiClient, refreshPeerDevices, refreshItems]);

  const bootstrapAsHost = useCallback(async (): Promise<'became-host' | 'not-first-device'> => {
    const { authKeyPair, exchangeKeyPair } = await generateDeviceKeys();
    const tempClient = createApiClient({
      baseUrl: SERVER_BASE_URL,
      deviceId: '',
      authPrivateKey: authKeyPair.privateKey,
    });
    const deviceName = guessDeviceName();
    let started: { token: string };
    try {
      started = await tempClient.pairingStart(deviceName, false);
    } catch {
      pendingKeysRef.current = { authKeyPair, exchangeKeyPair };
      return 'not-first-device';
    }
    const [publicKeyAuthJwk, publicKeyExchangeJwk] = await Promise.all([
      exportPublicJwk(authKeyPair.publicKey),
      exportPublicJwk(exchangeKeyPair.publicKey),
    ]);
    const completed = await tempClient.pairingComplete({
      token: started.token,
      deviceName,
      publicKeyAuthJwk,
      publicKeyExchangeJwk,
    });
    await saveDeviceIdentity({ deviceId: completed.deviceId, authKeyPair, exchangeKeyPair });
    setIdentity({ deviceId: completed.deviceId, authKeyPair, exchangeKeyPair });
    setPeerDevices(completed.peerDevices);
    return 'became-host';
  }, []);

  const completePairingAsJoiner = useCallback(async (payload: PairingQrPayload) => {
    const keys = pendingKeysRef.current ?? (await generateDeviceKeys());
    const tempClient = createApiClient({
      baseUrl: SERVER_BASE_URL,
      deviceId: '',
      authPrivateKey: keys.authKeyPair.privateKey,
    });
    const deviceName = guessDeviceName();
    const [publicKeyAuthJwk, publicKeyExchangeJwk] = await Promise.all([
      exportPublicJwk(keys.authKeyPair.publicKey),
      exportPublicJwk(keys.exchangeKeyPair.publicKey),
    ]);
    const completed = await tempClient.pairingComplete({
      token: payload.token,
      deviceName,
      publicKeyAuthJwk,
      publicKeyExchangeJwk,
    });
    await saveDeviceIdentity({ deviceId: completed.deviceId, ...keys });
    pendingKeysRef.current = null;
    setIdentity({ deviceId: completed.deviceId, ...keys });
    setPeerDevices(completed.peerDevices);
  }, []);

  const startInvitingNewDevice = useCallback(async () => {
    if (!apiClient) throw new Error('no_identity');
    return apiClient.pairingStart(guessDeviceName(), true);
  }, [apiClient]);

  const sharedKeyWithPeer = useCallback(async () => {
    if (!identity) throw new Error('no_identity');
    const peer = peerDevices[0];
    if (!peer) throw new Error('no_peer');
    return deriveSharedKey(identity.exchangeKeyPair.privateKey, peer.publicKeyExchangeJwk);
  }, [identity, peerDevices]);

  const addTextItem = useCallback(
    async (text: string) => {
      if (!apiClient) return;
      const sharedKey = await sharedKeyWithPeer();
      const ciphertext = await encryptContent(sharedKey, text);
      await apiClient.addClipboardItem({ contentType: 'text/plain', ciphertext });
    },
    [apiClient, sharedKeyWithPeer],
  );

  const addImageItem = useCallback(
    async (blob: Blob) => {
      if (!apiClient) return;
      const sharedKey = await sharedKeyWithPeer();
      // The server requires a non-empty ciphertext on create and only nils
      // it out once a blob is attached — this placeholder is never read.
      const placeholderCiphertext = await encryptContent(sharedKey, '');
      const created = await apiClient.addClipboardItem({ contentType: blob.type || 'image/png', ciphertext: placeholderCiphertext });
      await apiClient.uploadBlob(created.id, blob);
    },
    [apiClient, sharedKeyWithPeer],
  );

  const decryptItemText = useCallback(
    async (item: ClipboardItemDto) => {
      if (!item.ciphertext) throw new Error('no_ciphertext');
      const sharedKey = await sharedKeyWithPeer();
      return decryptContent(sharedKey, item.ciphertext);
    },
    [sharedKeyWithPeer],
  );

  const downloadBlob = useCallback(
    async (itemId: string) => {
      if (!apiClient) throw new Error('no_identity');
      return apiClient.downloadBlob(itemId);
    },
    [apiClient],
  );

  const deleteItem = useCallback(
    async (id: string) => {
      if (!apiClient) return;
      await apiClient.deleteClipboardItem(id);
      setItems((prev) => prev.filter((item) => item.id !== id));
    },
    [apiClient],
  );

  const clearHistory = useCallback(async () => {
    if (!apiClient) return;
    await apiClient.clearClipboard();
    setItems([]);
  }, [apiClient]);

  const unpairDevice = useCallback(
    async (deviceId: string) => {
      if (!apiClient) return;
      await apiClient.unpairDevice(deviceId);
      setPeerDevices((prev) => prev.filter((d) => d.deviceId !== deviceId));
    },
    [apiClient],
  );

  const value: AppStateValue = {
    identityLoading,
    identity,
    peerDevices,
    items,
    connectionStatus,
    bootstrapAsHost,
    completePairingAsJoiner,
    startInvitingNewDevice,
    refreshPeerDevices,
    refreshItems,
    addTextItem,
    addImageItem,
    decryptItemText,
    downloadBlob,
    deleteItem,
    clearHistory,
    unpairDevice,
  };

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}
