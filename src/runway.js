import RunwayML, { TaskFailedError } from "@runwayml/sdk";

// Gioi han cua chinh Runway cho promptText - server cua Runway se tra loi 400
// "Too big: expected string to have <=1000 characters" neu vuot qua so nay.
// Day KHONG phai gioi han tu code cua ban nen khong the "sua" thanh 15000 duoc,
// chi co the chan/canh bao truoc khi goi API de khong bi mat request.
export const PROMPT_MAX_LENGTH = 1000;

const client = new RunwayML({
  apiKey: process.env.RUNWAYML_API_SECRET
});

/**
 * Bien 1 loi tu Runway (SDK APIError, TaskFailedError, hoac loi mang thuong)
 * thanh dang de doc + du du lieu de hien thi tren web, khong can vao
 * dev.runwayml.com xem log nua.
 *
 * Tra ve:
 * - message: cau mo ta ngan gon, day du, hien thi truc tiep tren bang trang thai
 * - code: ma loi ("too_big", "content_moderation", "INTERNAL_ERROR"...) neu co
 * - field: ten truong bi loi (vd "promptText") neu co, tu Zod validation issues
 * - status: ma HTTP tra ve (400, 401, 429...) neu co
 */
export function describeRunwayError(error) {
  // Task da tao thanh cong nhung qua trinh generate/upscale that bai
  // (vi du: bi content moderation chan, model loi noi bo...)
  if (error instanceof TaskFailedError) {
    const details = error.taskDetails;
    const code = details?.failureCode;
    const reason = details?.failure || "Khong ro nguyen nhan tu Runway";
    return {
      message: code ? `Runway task that bai (${code}): ${reason}` : `Runway task that bai: ${reason}`,
      code: code || null,
      field: null,
      status: null
    };
  }

  // Loi tra ve tu chinh API cua Runway (APIError va cac lop con: BadRequestError,
  // AuthenticationError, RateLimitError...) - error.error la nguyen JSON body.
  const body = error?.error;
  if (body && typeof body === "object") {
    if (Array.isArray(body.issues) && body.issues.length > 0) {
      const issue = body.issues[0];
      const field = Array.isArray(issue.path) ? issue.path.join(".") : issue.path;
      const extra = body.issues.length > 1 ? ` (va ${body.issues.length - 1} loi khac)` : "";
      return {
        message: `${field ? field + ": " : ""}${issue.message}${extra}`,
        code: issue.code || null,
        field: field || null,
        status: error.status || null
      };
    }
    if (typeof body.error === "string") {
      return { message: body.error, code: null, field: null, status: error.status || null };
    }
  }

  if (error?.status) {
    return {
      message: `Runway tra ve loi ${error.status}: ${error.message}`,
      code: null,
      field: null,
      status: error.status
    };
  }

  return { message: error?.message || "Loi khong xac dinh", code: null, field: null, status: null };
}

/**
 * Huy 1 task tren Runway (dung khi nguoi dung bam Stop cho 1 video cu the,
 * de khong bi tinh phi credit cho task da bi bo giua chung).
 */
export async function cancelRunwayTask(taskId) {
  if (!taskId) return;
  try {
    await client.tasks.delete(taskId);
  } catch (error) {
    console.error(`Khong huy duoc task Runway ${taskId}:`, error.message);
  }
}

/**
 * Upscale video len 4K (hoac 2k/1k/720p) sau khi render xong.
 * videoUrl la link tam Runway tra ve sau buoc generateVideo (con han 24-48h),
 * dung truc tiep lam videoUri, khong can tai xuong truoc.
 */
export async function upscaleVideo({
  videoUrl,
  resolution = "4k",
  model = "magnific_video_upscaler_creative"
}) {
  try {
    const task = await client.videoUpscale
      .create({
        model,
        videoUri: videoUrl,
        resolution
      })
      .waitForTaskOutput();

    return task;
  } catch (error) {
    if (error instanceof TaskFailedError) {
      console.error("Upscale task failed:", error.taskDetails);
    }
    throw error;
  }
}

/**
 * Tạo video. Nếu có imageDataUrl -> dùng image-to-video.
 * Nếu không có ảnh -> dùng text-to-video.
 *
 * - abortSignal: cho phep huy giua chung (Stop rieng tung video). Khi bi abort,
 *   waitForTaskOutput nem AbortError va task tren Runway se duoc huy o cho goi
 *   (queue.js goi cancelRunwayTask sau khi bat duoc AbortError).
 * - onTaskCreated(taskId): bao ve cho caller ngay khi Runway nhan task, de luu
 *   lai taskId phong khi can Stop giua chung.
 */
export async function generateVideo({
  prompt,
  model = "gen4.5",
  ratio = "1280:720",
  duration = 5,
  imageDataUrl,
  abortSignal,
  onTaskCreated
}) {
  try {
    const creation = imageDataUrl
      ? client.imageToVideo.create({
          model,
          promptImage: imageDataUrl,
          promptText: prompt,
          ratio,
          duration
        })
      : client.textToVideo.create({
          model,
          promptText: prompt,
          ratio,
          duration
        });

    const created = await creation;
    if (onTaskCreated) onTaskCreated(created.id);

    const task = await creation.waitForTaskOutput({ abortSignal });
    return task;
  } catch (error) {
    if (error instanceof TaskFailedError) {
      console.error("Runway task failed:", error.taskDetails);
    }
    throw error;
  }
}
