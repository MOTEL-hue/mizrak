import { loadDocs, writeMany } from './docStore';
import { COLLECTIONS, docsToAll, type BatchOp } from './docView';

export const getAll = async () => docsToAll(await loadDocs());

export async function applyBatch(ops: BatchOp[]) {
  await writeMany(ops.filter((op) => COLLECTIONS.includes(op.c) && typeof op.id === 'string' && (op.del || op.data)));
  return { ok: true, n: ops.length };
}
