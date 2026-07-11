'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AUTH_API_URL, getStoredTenantToken } from './auth';
import { meetingsApi } from './builderforceApi';

/**
 * useMediaRoom — mesh-P2P WebRTC for a live meeting / ceremony.
 *
 * Every participant opens ONE WebSocket to the media relay
 * (`/api/meetings/rooms/<roomKey>/ws`) — the same CeremonyRoomDO fan-out used for
 * presence, keyed `media:<roomKey>`. SDP offers/answers and ICE candidates ride
 * that socket peer-to-peer (each frame carries `to`/`from`); the media itself
 * flows directly between browsers (no server relay of audio/video).
 *
 * Glare-free negotiation: for any pair, the peer with the lexicographically
 * greater assigned id is the offerer, so exactly one side initiates regardless of
 * join ordering.
 *
 * NOTE: mesh scales to a handful of simultaneous cameras (bandwidth is ~N²). For
 * a whole-team broadcast an SFU would be swapped in behind this same hook.
 */
export interface RemoteTile {
  peerId: string;
  name: string;
  ref: string;
  stream: MediaStream;
  camOn: boolean;
  micOn: boolean;
}

interface PeerState {
  pc: RTCPeerConnection;
  name: string;
  ref: string;
  stream: MediaStream;
  camOn: boolean;
  micOn: boolean;
}

interface RoomPeer { id: string; name: string; kind: string; ref: string; }

export interface UseMediaRoom {
  localStream: MediaStream | null;
  tiles: RemoteTile[];
  camOn: boolean;
  micOn: boolean;
  connected: boolean;
  /** getUserMedia failed / was denied (null = fine). */
  mediaError: string | null;
  /** Live caption text keyed by member ref (STT lines + agent spoken lines). */
  captions: Record<string, string>;
  /** Member refs currently speaking (drives the tile accent ring). */
  speaking: Set<string>;
  toggleCam: () => void;
  toggleMic: () => void;
}

const EMPTY: RemoteTile[] = [];

export function useMediaRoom(
  roomKey: string | null,
  me: { name: string; ref: string },
  opts: { enabled: boolean; audioOnly?: boolean },
): UseMediaRoom {
  const { enabled, audioOnly = false } = opts;
  const [tiles, setTiles] = useState<RemoteTile[]>(EMPTY);
  const [connected, setConnected] = useState(false);
  const [camOn, setCamOn] = useState(!audioOnly);
  const [micOn, setMicOn] = useState(true);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [captions, setCaptions] = useState<Record<string, string>>({});
  const [speaking, setSpeaking] = useState<Set<string>>(() => new Set());

  const captionTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);
  const myIdRef = useRef<string>('');
  const peersRef = useRef<Map<string, PeerState>>(new Map());
  const localRef = useRef<MediaStream | null>(null);
  const iceRef = useRef<RTCIceServer[]>([{ urls: 'stun:stun.l.google.com:19302' }]);
  const meRef = useRef(me);
  useEffect(() => { meRef.current = me; }, [me]);

  // Re-render tiles from the peer map.
  const syncTiles = useCallback(() => {
    setTiles([...peersRef.current.entries()].map(([peerId, p]) => ({
      peerId, name: p.name, ref: p.ref, stream: p.stream, camOn: p.camOn, micOn: p.micOn,
    })));
  }, []);

  // A caption arrived for `ref` (a human STT line, or an agent's spoken line). Show
  // it on that tile, flag them speaking, and — for agent lines — voice it aloud via
  // the browser's speech synthesis (agents have no media track). Auto-clears after a
  // hold proportional to the line length.
  const markCaption = useCallback((ref: string, text: string, speak: boolean) => {
    if (!ref || !text) return;
    setCaptions((prev) => ({ ...prev, [ref]: text }));
    setSpeaking((prev) => { const n = new Set(prev); n.add(ref); return n; });
    const timers = captionTimers.current;
    const existing = timers.get(ref);
    if (existing) clearTimeout(existing);
    const holdMs = Math.min(14_000, 2_800 + text.length * 55);
    timers.set(ref, setTimeout(() => {
      setCaptions((prev) => { const n = { ...prev }; delete n[ref]; return n; });
      setSpeaking((prev) => { const n = new Set(prev); n.delete(ref); return n; });
      timers.delete(ref);
    }, holdMs));
    if (speak && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try { window.speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } catch { /* voicing is best-effort */ }
    }
  }, []);

  const send = useCallback((frame: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(frame)); } catch { /* ignore */ }
    }
  }, []);

  // Create (or return) the RTCPeerConnection for a peer, wired for tracks + ICE.
  const ensurePeer = useCallback((peer: RoomPeer): PeerState => {
    const existing = peersRef.current.get(peer.id);
    if (existing) return existing;
    const pc = new RTCPeerConnection({ iceServers: iceRef.current });
    const stream = new MediaStream();
    const state: PeerState = { pc, name: peer.name || 'Guest', ref: peer.ref, stream, camOn: true, micOn: true };
    peersRef.current.set(peer.id, state);

    // Publish my local tracks to this peer.
    const local = localRef.current;
    if (local) for (const track of local.getTracks()) pc.addTrack(track, local);

    pc.onicecandidate = (e) => {
      if (e.candidate) send({ type: 'rtc-ice', to: peer.id, candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      for (const track of e.streams[0]?.getTracks() ?? [e.track]) {
        if (!state.stream.getTracks().some((t) => t.id === track.id)) state.stream.addTrack(track);
      }
      syncTiles();
    };
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
        // Leave teardown to the presence-leave frame; a transient disconnect may recover.
      }
    };
    return state;
  }, [send, syncTiles]);

  const closePeer = useCallback((peerId: string) => {
    const p = peersRef.current.get(peerId);
    if (!p) return;
    try { p.pc.close(); } catch { /* ignore */ }
    peersRef.current.delete(peerId);
    syncTiles();
  }, [syncTiles]);

  const makeOffer = useCallback(async (peer: RoomPeer) => {
    const { pc } = ensurePeer(peer);
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      send({ type: 'rtc-offer', to: peer.id, sdp: pc.localDescription });
    } catch { /* renegotiation will retry on next presence event */ }
  }, [ensurePeer, send]);

  // Deterministic offerer: greater id initiates.
  const shouldOffer = useCallback((peerId: string) => myIdRef.current > peerId, []);

  const handleFrame = useCallback(async (msg: Record<string, unknown>) => {
    const type = msg.type as string;
    const from = msg.from as string | undefined;

    if (type === 'hello') { myIdRef.current = String(msg.id ?? ''); return; }

    // Caption / agent-voice frames are broadcast server-side (agents have no socket)
    // so they carry no `from` — handle them before the peer-frame guard below.
    if (type === 'caption') { markCaption(String(msg.ref ?? ''), String(msg.text ?? ''), false); return; }
    if (type === 'agent-say') { markCaption(String(msg.ref ?? ''), String(msg.text ?? ''), true); return; }

    if (type === 'roster') {
      const peers = (msg.peers as RoomPeer[] | undefined) ?? [];
      for (const p of peers) {
        if (p.id === myIdRef.current) continue;
        ensurePeer(p);
        if (shouldOffer(p.id)) makeOffer(p);
      }
      syncTiles();
      return;
    }

    if (type === 'presence') {
      const action = msg.action as string;
      const peer = msg.peer as RoomPeer | undefined;
      if (!peer) return;
      if (action === 'join') {
        ensurePeer(peer);
        if (shouldOffer(peer.id)) makeOffer(peer);
        syncTiles();
      } else if (action === 'leave') {
        closePeer(peer.id);
      }
      return;
    }

    if (!from || (msg.to && msg.to !== myIdRef.current)) return;

    if (type === 'rtc-offer') {
      const state = ensurePeer({ id: from, name: String(msg.name ?? ''), kind: 'human', ref: String(msg.ref ?? '') });
      try {
        await state.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp as RTCSessionDescriptionInit));
        const answer = await state.pc.createAnswer();
        await state.pc.setLocalDescription(answer);
        send({ type: 'rtc-answer', to: from, sdp: state.pc.localDescription });
      } catch { /* ignore malformed */ }
    } else if (type === 'rtc-answer') {
      const p = peersRef.current.get(from);
      if (p) { try { await p.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp as RTCSessionDescriptionInit)); } catch { /* ignore */ } }
    } else if (type === 'rtc-ice') {
      const p = peersRef.current.get(from);
      if (p && msg.candidate) { try { await p.pc.addIceCandidate(new RTCIceCandidate(msg.candidate as RTCIceCandidateInit)); } catch { /* ignore */ } }
    } else if (type === 'm-state') {
      const p = peersRef.current.get(from);
      if (p) { p.camOn = !!msg.camOn; p.micOn = !!msg.micOn; syncTiles(); }
    }
  }, [ensurePeer, makeOffer, shouldOffer, closePeer, send, syncTiles, markCaption]);

  // Acquire media + open the socket while enabled.
  useEffect(() => {
    if (!enabled || !roomKey) return;
    const token = getStoredTenantToken();
    if (!token) return;
    let cancelled = false;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const start = async () => {
      // 1) Local media.
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: !audioOnly, audio: true });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        localRef.current = stream;
        setLocalStream(stream);
        stream.getVideoTracks().forEach((t) => { t.enabled = !audioOnly; });
        setCamOn(!audioOnly && stream.getVideoTracks().length > 0);
        setMicOn(true);
      } catch (e) {
        setMediaError(e instanceof Error ? e.message : 'Camera/microphone unavailable');
      }
      // 2) ICE config (best-effort; STUN default already set).
      try {
        const cfg = await meetingsApi.ice();
        if (!cancelled && cfg.iceServers?.length) iceRef.current = cfg.iceServers as RTCIceServer[];
      } catch { /* keep default STUN */ }

      // 3) Signaling socket.
      const base = AUTH_API_URL.replace(/^http/, 'ws');
      const url = `${base}/api/meetings/rooms/${encodeURIComponent(roomKey)}/ws?token=${encodeURIComponent(token)}`;
      const connect = () => {
        if (cancelled) return;
        try { ws = new WebSocket(url); } catch { retry = setTimeout(connect, 2000); return; }
        wsRef.current = ws;
        ws.onopen = () => {
          setConnected(true);
          send({ type: 'join', name: meRef.current.name, kind: 'human', ref: meRef.current.ref });
        };
        ws.onmessage = (ev) => {
          let msg: Record<string, unknown>;
          try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ''); } catch { return; }
          if (msg && typeof msg.type === 'string') handleFrame(msg);
        };
        ws.onclose = () => { setConnected(false); if (!cancelled) retry = setTimeout(connect, 2000); };
        ws.onerror = () => { try { ws?.close(); } catch { /* ignore */ } };
      };
      connect();
    };
    start();

    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      try { ws?.close(); } catch { /* ignore */ }
      wsRef.current = null;
      for (const [id] of peersRef.current) { try { peersRef.current.get(id)?.pc.close(); } catch { /* ignore */ } }
      peersRef.current.clear();
      localRef.current?.getTracks().forEach((t) => t.stop());
      localRef.current = null;
      setLocalStream(null);
      setTiles(EMPTY);
      setConnected(false);
      myIdRef.current = '';
      for (const [, timer] of captionTimers.current) clearTimeout(timer);
      captionTimers.current.clear();
      setCaptions({});
      setSpeaking(new Set());
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) { try { window.speechSynthesis.cancel(); } catch { /* ignore */ } }
    };
  }, [enabled, roomKey, audioOnly, send, handleFrame]);

  const toggleCam = useCallback(() => {
    const stream = localRef.current;
    if (!stream) return;
    const next = !camOn;
    stream.getVideoTracks().forEach((t) => { t.enabled = next; });
    setCamOn(next);
    send({ type: 'm-state', camOn: next, micOn });
  }, [camOn, micOn, send]);

  const toggleMic = useCallback(() => {
    const stream = localRef.current;
    if (!stream) return;
    const next = !micOn;
    stream.getAudioTracks().forEach((t) => { t.enabled = next; });
    setMicOn(next);
    send({ type: 'm-state', camOn, micOn: next });
  }, [camOn, micOn, send]);

  return { localStream, tiles, camOn, micOn, connected, mediaError, captions, speaking, toggleCam, toggleMic };
}
