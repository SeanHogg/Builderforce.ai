/**
 * Session loader — weight bytes in, a budget-tracked ORT session out.
 *
 * Split from DiffusionEngine so the engine stays the SESSION OWNER only:
 *   • `fetchSessionBuffers` — pure I/O: the model + optional external-data
 *     sidecar for one session. No ORT calls, so the engine can download every
 *     session's weights in parallel.
 *   • `createAdmittedSession` — one ORT create, then admission into the shared
 *     {@link SessionResidency} charged at the downloaded byte size.
 *
 * SERIAL-CREATE INVARIANT: callers MUST NOT run `createAdmittedSession`
 * concurrently when any session carries external data. ORT-web mounts sidecars
 * on a GLOBAL Map on the wasm Module and the `finally` of every session create
 * unmounts it, so concurrent creates race ("Module.MountedFiles is not
 * available"). DiffusionEngine.init() awaits each create in turn; the
 * 'DiffusionEngine.init session-create serialisation (external-data race
 * guard)' suite in diffusion-engine.test.ts locks that.
 */

import * as ort from 'onnxruntime-web';
import type { OnnxFile } from '../../types';
import { basename } from '../ort-session';
import { reportProgress } from '../progress';
import type { SessionComponent, SessionResidency } from './session-residency';

export interface SessionBuffers {
  component: SessionComponent;
  modelBuf: ArrayBuffer;
  externalData: { name: string; buf: ArrayBuffer } | null;
}

/** Bytes one session was built from — what the residency budget charges. */
function sessionBufferBytes(bufs: SessionBuffers): number {
  return bufs.modelBuf.byteLength + (bufs.externalData?.buf.byteLength ?? 0);
}

/** Download the model + (optional) external-data buffers for one session. */
export async function fetchSessionBuffers(
  file: OnnxFile,
  component: SessionComponent,
  fetchWeight: (path: string) => Promise<ArrayBuffer>,
  onProgress?: (label: string) => void,
): Promise<SessionBuffers> {
  reportProgress(`Downloading ${component} (${file.model})…`, onProgress);
  const modelBuf = await fetchWeight(file.model);
  let externalData: SessionBuffers['externalData'] = null;
  if (file.externalData) {
    reportProgress(`Downloading ${component} weight data (${file.externalData})…`, onProgress);
    const dataBuf = await fetchWeight(file.externalData);
    externalData = { name: basename(file.externalData), buf: dataBuf };
  }
  return { component, modelBuf, externalData };
}

export interface CreateSessionContext {
  residency: SessionResidency;
  modelId: string;
  onProgress?: (label: string) => void;
  /** Translate an ORT create failure into an actionable error. */
  explain: (err: unknown, phase: string) => Error;
}

/** Create one ORT session from downloaded buffers and admit it into the
 *  residency budget. See the SERIAL-CREATE INVARIANT above. */
export async function createAdmittedSession(
  bufs: SessionBuffers,
  baseOptions: ort.InferenceSession.SessionOptions,
  ctx: CreateSessionContext,
): Promise<ort.InferenceSession> {
  const options: ort.InferenceSession.SessionOptions = { ...baseOptions };
  if (bufs.externalData) {
    // The .onnx graph references its sidecar by basename (e.g.
    // 'model.onnx_data'); ORT matches the externalData `path` against it.
    options.externalData = [
      { path: bufs.externalData.name, data: new Uint8Array(bufs.externalData.buf) },
    ];
  }
  reportProgress(`Creating ${bufs.component} ORT session…`, ctx.onProgress);
  let session: ort.InferenceSession;
  try {
    session = await ort.InferenceSession.create(new Uint8Array(bufs.modelBuf), options);
  } catch (err) {
    throw ctx.explain(err, `${bufs.component} session create`);
  }
  reportProgress(`${bufs.component} ready.`, ctx.onProgress);
  await ctx.residency.admit({
    modelId: ctx.modelId,
    component: bufs.component,
    bytes: sessionBufferBytes(bufs),
    session,
  });
  return session;
}
