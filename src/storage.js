import { getItemsCollection } from "./db.js";

/**
 * Cac trang thai duoc coi la "da xong", khong can tu dong render lai
 * khi server khoi dong lai.
 */
export const TERMINAL_STATES = ["DONE", "FAILED", "STOPPED"];

function fromDoc(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return { id: _id, ...rest };
}

/**
 * Tra ve toan bo item duoi dang { [id]: item } - giu nguyen shape cu
 * de public/app.js khong can sua gi ve phia doc du lieu.
 */
export async function loadStatus() {
  const col = await getItemsCollection();
  const docs = await col.find({}).toArray();
  const status = {};
  for (const doc of docs) {
    status[doc._id] = fromDoc(doc);
  }
  return status;
}

export async function getItem(id) {
  const col = await getItemsCollection();
  const doc = await col.findOne({ _id: id });
  return fromDoc(doc);
}

/**
 * Tao moi hoac cap nhat 1 phan cua item (upsert).
 */
export async function updateItemStatus(id, patch) {
  const col = await getItemsCollection();
  const now = new Date().toISOString();
  await col.updateOne(
    { _id: id },
    {
      $set: { ...patch, updatedAt: now },
      $setOnInsert: { createdAt: now }
    },
    { upsert: true }
  );
  return getItem(id);
}

/**
 * Danh sach cac item dang do dang (chua toi trang thai cuoi) - dung de
 * tu dong resume khi server vua khoi dong lai sau khi bi restart/redeploy.
 */
export async function getUnfinishedItems() {
  const col = await getItemsCollection();
  const docs = await col
    .find({ state: { $nin: TERMINAL_STATES.concat(["PAUSED"]) } })
    .toArray();
  return docs.map(fromDoc);
}
