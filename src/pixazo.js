// Provider Pixazo (model duy nhat ho ho tro: LTX cua Lightricks), dung API
// free tier cua Pixazo. Cau truc file nay co tinh doi xung voi runway.js de
// queue.js/server.js xu ly ca 2 provider giong nhau (cung export
// PROMPT_MAX_LENGTH + 1 ham generate + 1 ham describe loi).
//
// KHAC BIET QUAN TRONG so voi Runway:
// 1. Pixazo/LTX CHI ho tro image-to-video, KHONG co text-to-video. Nghia la
//    moi dong (row) dung provider "pixazo" bat buoc phai co anh dau vao.
// 2. Pixazo yeu cau image_url la 1 URL CONG KHAI tren internet (ho tai anh
//    ve tu server cua ho), KHONG nhan duoc data:base64 nhu Runway. Vi vay
//    server.js phai tu luu anh upload vao GridFS va dua ra 1 link public
//    (xem route GET /uploads/:id trong server.js) roi moi goi ham nay.
// 3. Pixazo khong co API huy (cancel) task giua chung nhu Runway, va cung
//    khong co buoc upscale rieng - vi vay Stop 1 video dang dung Pixazo chi
//    dung duoc o phia client (ngung poll + bo qua ket qua), khong huy that
//    duoc job da gui tren server cua Pixazo.
// 4. Cac tham so nhu duration/ratio KHONG duoc gui len vi test thuc te
//    (test-pixazo-image-to-video.mjs) chi xac nhan 2 truong "prompt" va
//    "image_url" hoat dong - tranh doan them tham so ho khong xac nhan.

const PIXAZO_KEY = process.env.PIXAZO_KEY || "";

// Gioi han ky tu prompt cua Pixazo - theo yeu cau cua nguoi dung, web nay
// cho phep toi da 4500 ky tu (cao hon nhieu so voi 1000 cua Runway).
export const PROMPT_MAX_LENGTH = 4500;

const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 4 * 60 * 1000; // 4 phut, giong het script test da chay thanh cong

function assertConfigured() {
  if (!PIXAZO_KEY) {
    throw new Error("Server missing PIXAZO_KEY");
  }
}

/**
 * Bien 1 loi tu Pixazo thanh dang de doc + du du lieu de hien thi tren web,
 * dong bo shape voi describeRunwayError (message/code/field/status) de
 * server.js/queue.js/app.js xu ly ca 2 provider giong het nhau.
 */
export function describePixazoError(error) {
  if (error?.name === "AbortError") {
    return { message: "Da dung theo yeu cau", code: null, field: null, status: null };
  }
  return {
    message: error?.message || "Loi khong xac dinh tu Pixazo",
    code: error?.pixazoCode || null,
    field: null,
    status: error?.status || null
  };
}

async function submitJob({ prompt, imageUrl }) {
  const res = await fetch("https://gateway.pixazo.ai/ltx-video/v1/image-to-video", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Ocp-Apim-Subscription-Key": PIXAZO_KEY
    },
    body: JSON.stringify({ prompt, image_url: imageUrl })
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  if (!res.ok) {
    const message =
      (data && typeof data === "object" && (data.message || data.error)) ||
      `Pixazo tra ve loi HTTP ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    err.pixazoCode = data && typeof data === "object" ? data.code : null;
    throw err;
  }

  return data;
}

async function pollUntilDone(pollingUrl, abortSignal) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (abortSignal?.aborted) {
      const err = new Error("Aborted");
      err.name = "AbortError";
      throw err;
    }

    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, POLL_INTERVAL_MS);
      const onAbort = () => {
        clearTimeout(timer);
        const err = new Error("Aborted");
        err.name = "AbortError";
        reject(err);
      };
      abortSignal?.addEventListener("abort", onAbort, { once: true });
    });

    const res = await fetch(pollingUrl, {
      headers: { "Ocp-Apim-Subscription-Key": PIXAZO_KEY }
    });
    const data = await res.json();

    if (data.status === "COMPLETED") return data;
    if (data.status === "FAILED" || data.status === "ERROR") {
      const err = new Error(`Pixazo job that bai: ${JSON.stringify(data)}`);
      err.pixazoCode = data.status;
      throw err;
    }
  }

  throw new Error("Qua 4 phut Pixazo van chua xong, tu bo cho.");
}

/**
 * Tao video tu anh qua Pixazo/LTX. Bat buoc phai co imageUrl (URL cong khai
 * tren internet) - KHONG ho tro text-to-video.
 *
 * - abortSignal: cho phep huy giua chung (dung khi nguoi dung bam Stop cho
 *   rieng 1 video). Pixazo khong co API huy task tren server cua ho, nen
 *   khi abort, ham nay chi dung poll lai va nem AbortError, GIONG HANH VI
 *   voi generateVideo() cua Runway de queue.js xu ly duoc nhu nhau.
 * - onTaskCreated(pollingUrl): bao cho caller ngay khi Pixazo nhan job, de
 *   luu lai polling_url phong khi can debug (Pixazo khong tra ve 1 taskId
 *   rieng trong response mau, chi co polling_url).
 */
export async function generatePixazoVideo({ prompt, imageUrl, abortSignal, onTaskCreated }) {
  assertConfigured();

  if (!imageUrl) {
    throw new Error("Pixazo (LTX) bắt buộc phải có ảnh đầu vào (chỉ hỗ trợ image-to-video)");
  }

  const submitResult = await submitJob({ prompt, imageUrl });
  if (onTaskCreated) onTaskCreated(submitResult.polling_url || null);

  let finalResult = submitResult;
  if (submitResult.status && submitResult.status !== "COMPLETED") {
    finalResult = await pollUntilDone(submitResult.polling_url, abortSignal);
  }

  const videoUrl = finalResult.output?.media_url?.[0];
  if (!videoUrl) {
    throw new Error("Pixazo render xong nhưng không trả về video URL");
  }

  return { videoUrl, raw: finalResult };
}
