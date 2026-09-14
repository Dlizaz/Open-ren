import pLimit from "p-limit";
import { generateVideo, upscaleVideo, cancelRunwayTask, describeRunwayError } from "./runway.js";
import { generatePixazoVideo, describePixazoError } from "./pixazo.js";
import { getPromptMaxLength } from "./promptLimits.js";
import { downloadAndStoreVideo } from "./download.js";
import { uploadToDrive } from "./drive.js";
import { updateItemStatus, getItem } from "./storage.js";

// Mac dinh KHONG tu dong retry khi 1 video that bai - FAILED ngay lap tuc,
// hang doi tu chuyen sang video khac (neu co) hoac dung han neu khong con
// gi de lam. Nguoi dung tu bam nut "Render lai" (Resume) khi muon thu lai
// video da fail. Chinh duoc qua bien moi truong QUEUE_MAX_RETRIES neu muon
// quay lai hanh vi tu dong retry (vd =2 nhu truoc).
const MAX_RETRIES = Number(process.env.QUEUE_MAX_RETRIES ?? 0);
const CONCURRENCY = Number(process.env.QUEUE_CONCURRENCY) || 2;

// 1 limiter duy nhat cho ca app (dung chung ca Runway lan Pixazo), de nut
// Resume cho 1 video le cung tranh dung suat voi hang doi render hang loat.
const limit = pLimit(CONCURRENCY);

// Cong tac chung cho toan bo hang doi (giu de tuong thich voi nut
// Pause/Resume/Stop tong nhu ban cu).
let isPaused = false;
let isStopped = false;
let isRunning = false;

// Cong tac rieng cho tung video: id -> { paused, stopRequested }
const itemFlags = new Map();
// AbortController dang cho provider tra ve, theo tung id (de Stop huy duoc
// ngay ca khi dang render dang cho Runway/Pixazo).
const itemControllers = new Map();

function getFlags(id) {
  if (!itemFlags.has(id)) {
    itemFlags.set(id, { paused: false, stopRequested: false });
  }
  return itemFlags.get(id);
}

export function getQueueState() {
  return { isPaused, isStopped, isRunning };
}

export function pauseQueue() {
  isPaused = true;
}

export function resumeQueue() {
  isPaused = false;
}

export function stopQueue() {
  isStopped = true;
}

/**
 * Pause 1 video rieng le. Neu video con dang cho o hang doi (chua bat dau
 * render) thi se dung lai truoc khi bat dau. Neu provider dang xu ly rong,
 * ca Runway lan Pixazo deu KHONG co API pause giua chung nen video se render
 * xong buoc hien tai roi moi dung o cho kiem tra tiep theo (truoc
 * upscale/tai/upload).
 */
export function pauseItem(id) {
  getFlags(id).paused = true;
}

export function resumeItem(id) {
  const flags = getFlags(id);
  flags.paused = false;
  flags.stopRequested = false;
}

/**
 * Stop 1 video rieng le: huy request dang cho provider (neu co).
 * - Voi Runway: goi them cancelRunwayTask de huy that task ben Runway
 *   (tranh bi tinh phi credit cho task da bo giua chung).
 * - Voi Pixazo: KHONG co API huy job tren server cua ho, nen chi dung duoc
 *   phia client (ngung poll + bo qua ket qua tra ve sau do), job van co
 *   the tiep tuc chay ngam ben Pixazo.
 */
export async function stopItem(id) {
  const flags = getFlags(id);
  flags.stopRequested = true;

  const controller = itemControllers.get(id);
  if (controller) controller.abort();

  const item = await getItem(id);
  if (item?.provider === "pixazo") return;

  if (item?.runwayTaskId) {
    cancelRunwayTask(item.runwayTaskId).catch(() => {});
  }
}

async function waitWhilePausedItem(id) {
  while ((isPaused || getFlags(id).paused) && !isStopped && !getFlags(id).stopRequested) {
    await new Promise((r) => setTimeout(r, 1000));
  }
}

function isStopRequested(id) {
  return isStopped || getFlags(id).stopRequested;
}

/**
 * Dua 1 item vao hang doi xu ly (dung chung 1 limiter voi runQueue), item
 * phai la object da co day du prompt/provider/model/ratio/duration/... (tu
 * luu trong DB nen resume duoc bat cu luc nao ke ca sau khi server restart).
 */
export function enqueueItem(item) {
  const flags = getFlags(item.id);
  flags.stopRequested = false;
  flags.paused = false;
  return limit(() => processItem(item));
}

async function processItem(item) {
  const existing = await getItem(item.id);
  if (existing?.state === "DONE") {
    console.log(`Skip ${item.id}, already DONE`);
    return;
  }

  const provider = item.provider === "pixazo" ? "pixazo" : "runway";
  const promptMaxLength = getPromptMaxLength(provider);

  // Chan som neu prompt van con vuot gioi han cua provider tuong ung - tranh
  // render lai vo ich (vd: nguoi dung bam Resume cho 1 item da Failed vi qua
  // dai ma chua sua prompt).
  if (item.prompt && item.prompt.length > promptMaxLength) {
    await updateItemStatus(item.id, {
      state: "FAILED",
      error: `promptText: Prompt dài ${item.prompt.length} ký tự, vượt quá giới hạn ${promptMaxLength} ký tự của ${provider === "pixazo" ? "X" : "Runway"}`,
      errorCode: "too_big",
      errorField: "promptText",
      errorStatus: 400
    });
    return;
  }

  // Pixazo/LTX chi ho tro image-to-video - chan som neu thieu anh, tranh
  // goi API vo ich roi moi bao loi.
  if (provider === "pixazo" && !item.imageUrl) {
    await updateItemStatus(item.id, {
      state: "FAILED",
      error: "X bắt buộc phải có ảnh đầu vào (chỉ hỗ trợ image-to-video)",
      errorCode: "missing_image",
      errorField: "image",
      errorStatus: 400
    });
    return;
  }

  let attempt = 0;

  while (attempt <= MAX_RETRIES) {
    try {
      await waitWhilePausedItem(item.id);
      if (isStopRequested(item.id)) {
        await updateItemStatus(item.id, { state: "STOPPED" });
        return;
      }

      await updateItemStatus(item.id, {
        state: "RENDERING",
        prompt: item.prompt,
        provider,
        model: item.model,
        ratio: item.ratio,
        duration: item.duration,
        upscaleEnabled: provider === "runway" ? item.upscaleEnabled : false,
        hasImage: Boolean(item.imageDataUrl || item.imageUrl),
        attempt,
        error: null,
        errorCode: null,
        errorField: null,
        errorStatus: null
      });

      const controller = new AbortController();
      itemControllers.set(item.id, controller);

      let videoUrl;
      try {
        if (provider === "pixazo") {
          const result = await generatePixazoVideo({
            prompt: item.prompt,
            imageUrl: item.imageUrl,
            duration: item.duration,
            sendDuration: item.pixazoSendDuration,
            abortSignal: controller.signal,
            onTaskCreated: (pollingUrl) => updateItemStatus(item.id, { pixazoPollingUrl: pollingUrl })
          });
          videoUrl = result.videoUrl;
        } else {
          const task = await generateVideo({
            prompt: item.prompt,
            model: item.model,
            ratio: item.ratio,
            duration: item.duration,
            imageDataUrl: item.imageDataUrl,
            abortSignal: controller.signal,
            onTaskCreated: (taskId) => updateItemStatus(item.id, { runwayTaskId: taskId })
          });
          videoUrl = task.output?.[0] || task.output?.video || task.videoUrl;
        }
      } finally {
        itemControllers.delete(item.id);
      }

      if (!videoUrl) throw new Error(`${provider === "pixazo" ? "X" : "Runway"} render xong nhưng không trả về video URL`);

      await waitWhilePausedItem(item.id);
      if (isStopRequested(item.id)) {
        await updateItemStatus(item.id, { state: "STOPPED" });
        return;
      }

      // Upscale 4K sau khi render: chi Runway ho tro (Pixazo/LTX khong co
      // buoc upscale rieng trong API cua ho).
      if (provider === "runway" && item.upscaleEnabled) {
        await updateItemStatus(item.id, { state: "UPSCALING" });
        try {
          const upscaleTask = await upscaleVideo({
            videoUrl,
            resolution: item.upscaleResolution || "4k"
          });
          const upscaledUrl = upscaleTask.output?.[0];
          if (upscaledUrl) {
            videoUrl = upscaledUrl;
          } else {
            console.error(`Upscale ${item.id} tra ve rong, dung ban goc.`);
          }
        } catch (upscaleError) {
          const errorInfo = describeRunwayError(upscaleError);
          console.error(`Upscale ${item.id} that bai, dung ban goc:`, errorInfo.message);
          await updateItemStatus(item.id, { upscaleError: errorInfo.message });
        }
      }

      await updateItemStatus(item.id, { state: "DOWNLOADING" });
      const filename = `${item.id}.mp4`;
      const { buffer, fileId } = await downloadAndStoreVideo(videoUrl, filename);

      await updateItemStatus(item.id, {
        state: "UPLOADING",
        videoFileId: fileId.toString(),
        localPath: `/videos/${fileId.toString()}`
      });

      let driveLink = null;
      if (process.env.GOOGLE_OAUTH_REFRESH_TOKEN) {
        try {
          const driveFile = await uploadToDrive(buffer, filename);
          driveLink = driveFile.webViewLink;
        } catch (driveError) {
          console.error(`Drive upload failed for ${item.id}:`, driveError.message);
          await updateItemStatus(item.id, { driveError: driveError.message });
        }
      }

      await updateItemStatus(item.id, {
        state: "DONE",
        driveLink,
        videoFileId: fileId.toString(),
        localPath: `/videos/${fileId.toString()}`
      });
      return;
    } catch (error) {
      itemControllers.delete(item.id);

      if (error.name === "AbortError" || isStopRequested(item.id)) {
        console.log(`Da dung ${item.id} theo yeu cau`);
        await updateItemStatus(item.id, { state: "STOPPED" });
        return;
      }

      attempt++;
      const willRetry = attempt <= MAX_RETRIES;
      const errorInfo = provider === "pixazo" ? describePixazoError(error) : describeRunwayError(error);
      console.error(`Error on ${item.id}, attempt ${attempt}:`, errorInfo.message);
      await updateItemStatus(item.id, {
        state: willRetry ? "RETRYING" : "FAILED",
        error: errorInfo.message,
        errorCode: errorInfo.code,
        errorField: errorInfo.field,
        errorStatus: errorInfo.status,
        attempt
      });
      if (!willRetry) return;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

export async function runQueue(items) {
  isPaused = false;
  isStopped = false;
  isRunning = true;

  try {
    await Promise.all(items.map((item) => enqueueItem(item)));
  } finally {
    isRunning = false;
    console.log("QUEUE FINISHED");
  }
}
