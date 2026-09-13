import { PROMPT_MAX_LENGTH as RUNWAY_PROMPT_MAX_LENGTH } from "./runway.js";
import { PROMPT_MAX_LENGTH as PIXAZO_PROMPT_MAX_LENGTH } from "./pixazo.js";

// Gom gioi han ky tu prompt cua tung nha cung cap 1 cho duy nhat, de
// server.js va queue.js dung chung (khong bi lech gia tri nhau khi sua sau
// nay). Gia tri thuc te lay tu chinh gioi han API cua ho:
// - Runway: 1000 ky tu (cung, khong doi duoc - server cua Runway tra 400 neu vuot).
// - Pixazo (LTX): 4500 ky tu (theo yeu cau cau hinh cho web nay).
export const PROMPT_MAX_LENGTHS = {
  runway: RUNWAY_PROMPT_MAX_LENGTH,
  pixazo: PIXAZO_PROMPT_MAX_LENGTH
};

export const DEFAULT_PROVIDER = "runway";

export function getPromptMaxLength(provider) {
  return PROMPT_MAX_LENGTHS[provider] || PROMPT_MAX_LENGTHS[DEFAULT_PROVIDER];
}

export function normalizeProvider(provider) {
  const p = String(provider || "").toLowerCase().trim();
  return PROMPT_MAX_LENGTHS[p] ? p : DEFAULT_PROVIDER;
}
