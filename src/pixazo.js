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
// 4. Tham so "ratio" van KHONG duoc gui len vi chua duoc xac nhan. Tham so
//    "duration" (so giay) DA duoc them theo dung format cua LTX goc (cac
//    ban trien khai LTX khac - fal.ai, Picsart... - deu dung field ten
//    "duration", gia tri thuong gap 6/8/10 giay). Gateway cua Pixazo CHUA
//    co doc chinh thuc cong khai xac nhan dieu nay, nen: neu Pixazo khong
//    hieu field nay, ho se tra loi 400 (se hien ro trong errorField/message
//    tren web) hoac im lang bo qua va dung do dai mac dinh cua ho - can
//    test thuc te sau khi deploy de biet chac.
// 5. Them RATE LIMITER dung chung cho MOI request goi Pixazo (ca submit lan
//    poll), gioi han so request/phut de tranh vuot qua han muc 60
//    request/phut cua Pixazo khi gui hang loat video roi di ngu. Chinh qua
//    bien moi truong PIXAZO_MAX_REQUESTS_PER_MINUTE (mac dinh 50, de du
//    khoang trong an toan duoi muc 60 that su cua Pixazo).

const PIXAZO_KEY = process.env.PIXAZO_KEY || "";

// Gioi han ky tu prompt cua Pixazo - theo yeu cau cua nguoi dung, web nay
// cho phep toi da 4500 ky tu (cao hon nhieu so voi 1000 cua Runway).
export const PROMPT_MAX_LENGTH = 4500;

const POLL_INTERVAL_MS = 5000;
// Thoi gian cho toi da truoc khi tu bo (phut). Mac dinh 8 phut - free tier
// cua Pixazo co the cham hon 4 phut vao gio cao diem. Chinh duoc qua bien
// moi truong PIXAZO_POLL_TIMEOUT_MINUTES tren Railway neu can cho lau hon.
const POLL_TIMEOUT_MS = (Number(process.env.PIXAZO_POLL_TIMEOUT_MINUTES) || 8) * 60 * 1000;

// ----- Rate limiter dung chung cho toan bo cac request goi Pixazo -----
// Sliding window 60 giay: truoc moi request (submit HOAC poll), ham nay
// kiem tra so request da goi trong 60 giay gan nhat, neu da toi han thi
// CHO (khong loi, khong bo qua) den khi co "cho trong" moi goi tiep.
// Dung chung 1 mang timestamp cho ca app (khong theo tung job rieng), vi
// gioi han 60 request/phut la gioi han TREN TOAN BO API KEY cua Pixazo,
// khong phai rieng tung video.
const MAX_REQUESTS_PER_MINUTE = Number(process.env.PIXAZO_MAX_REQUESTS_PER_MINUTE) || 50;
const requestTimestamps = [];

async function waitForRateLimitSlot() {
  while (true) {
    const now = Date.now();
    // Bo cac timestamp da qua 60 giay
    while (requestTimestamps.length && now - requestTimestamps[0] >= 60000) {
      requestTimestamps.shift();
    }
    if (requestTimestamps.length < MAX_REQUESTS_PER_MINUTE) {
      requestTimestamps.push(now);
      return;
    }
    const waitMs = 60000 - (now - requestTimestamps[0]) + 50; // +50ms cho chac
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

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

async function submitJob({ prompt, imageUrl, duration }) {
  await waitForRateLimitSlot();

  const body = { prompt, image_url: imageUrl };
  // QUAN TRONG: mac dinh KHONG gui "duration" len Pixazo. Da xac nhan thuc
  // te (so sanh voi script test-pixazo-image-to-video.mjs da chay OK) rang
  // gui them field nay co the khien job bi TREO IM LANG (khong bao gio
  // chuyen sang COMPLETED/FAILED) thay vi bao loi ro rang, dan den loi
  // "qua X phut van chua xong". Chi bat gui field nay khi nguoi dung tu
  // xac nhan muon thu nghiem, qua bien moi truong PIXAZO_SEND_DURATION=true.
  const shouldSendDuration = process.env.PIXAZO_SEND_DURATION === "true";
  if (shouldSendDuration && duration !== undefined && duration !== null && duration !== "") {
    body.duration = Number(duration);
  }

  const res = await fetch("https://gateway.pixazo.ai/ltx-video/v1/image-to-video", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Ocp-Apim-Subscription-Key": PIXAZO_KEY
    },
    body: JSON.stringify(body)
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
      let timer;
      const onAbort = () => {
        clearTimeout(timer);
        const err = new Error("Aborted");
        err.name = "AbortError";
        reject(err);
      };
      timer = setTimeout(() => {
        abortSignal?.removeEventListener("abort", onAbort);
        resolve();
      }, POLL_INTERVAL_MS);
      abortSignal?.addEventListener("abort", onAbort, { once: true });
    });

    await waitForRateLimitSlot();
    const res = await fetch(pollingUrl, {
      headers: { "Ocp-Apim-Subscription-Key": PIXAZO_KEY }
    });
    const data = await res.json();

    const elapsedSec = Math.round((Date.now() - (deadline - POLL_TIMEOUT_MS)) / 1000);
    console.log(`Pixazo poll (${elapsedSec}s): status=${data.status}`);

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
 * - duration: so giay video mong muon (vd 6/8/10). Optional - neu khong
 *   truyen, Pixazo se tu dung do dai mac dinh cua ho.
 * - abortSignal: cho phep huy giua chung (dung khi nguoi dung bam Stop cho
 *   rieng 1 video). Pixazo khong co API huy task tren server cua ho, nen
 *   khi abort, ham nay chi dung poll lai va nem AbortError, GIONG HANH VI
 *   voi generateVideo() cua Runway de queue.js xu ly duoc nhu nhau.
 * - onTaskCreated(pollingUrl): bao cho caller ngay khi Pixazo nhan job, de
 *   luu lai polling_url phong khi can debug (Pixazo khong tra ve 1 taskId
 *   rieng trong response mau, chi co polling_url).
 */
export async function generatePixazoVideo({ prompt, imageUrl, duration, abortSignal, onTaskCreated }) {
  assertConfigured();

  if (!imageUrl) {
    throw new Error("Pixazo (LTX) bắt buộc phải có ảnh đầu vào (chỉ hỗ trợ image-to-video)");
  }

  const submitResult = await submitJob({ prompt, imageUrl, duration });
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
