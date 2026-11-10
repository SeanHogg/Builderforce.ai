/** The editor's content hash for the directory source: SHA-256 of the bytes as lowercase hex, the same digest as memory's `sha256Hex`, computed natively. */

import { createHash } from "node:crypto";

export const nodeSha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
