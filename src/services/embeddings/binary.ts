import { EMBEDDING_POLICY } from "./policy.js";

const VECTOR_BYTES = EMBEDDING_POLICY.dimensions * Float32Array.BYTES_PER_ELEMENT;

export function serializeEmbedding(values: ArrayLike<number>): Buffer {
  if (values.length !== EMBEDDING_POLICY.dimensions) {
    throw new Error("Invalid embedding");
  }
  const result = Buffer.allocUnsafe(VECTOR_BYTES);
  for (let i = 0; i < EMBEDDING_POLICY.dimensions; i += 1) {
    const value = values[i];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error("Invalid embedding");
    }
    result.writeFloatLE(value, i * Float32Array.BYTES_PER_ELEMENT);
    if (!Number.isFinite(result.readFloatLE(i * Float32Array.BYTES_PER_ELEMENT))) {
      throw new Error("Invalid embedding");
    }
  }
  return result;
}

export function deserializeEmbeddingInto(buffer: Uint8Array, target: Float32Array, offset: number): void {
  if (
    buffer.byteLength !== VECTOR_BYTES ||
    offset < 0 ||
    offset + EMBEDDING_POLICY.dimensions > target.length
  ) {
    throw new Error("Invalid embedding");
  }
  const bytes = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  for (let i = 0; i < EMBEDDING_POLICY.dimensions; i += 1) {
    const value = bytes.readFloatLE(i * Float32Array.BYTES_PER_ELEMENT);
    if (!Number.isFinite(value)) throw new Error("Invalid embedding");
    target[offset + i] = value;
  }
}
