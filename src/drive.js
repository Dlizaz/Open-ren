import { google } from "googleapis";
import { Readable } from "stream";

// DA DOI TU SERVICE ACCOUNT SANG OAUTH2 (dang nhap bang chinh tai khoan
// Gmail ca nhan cua nguoi dung). Ly do: Service Account KHONG co dung
// luong luu tru rieng (0 GB) - khi tai file len 1 folder Drive thuong
// (khong phai Shared Drive - tinh nang chi co tren Google Workspace tra
// phi), Google se bao loi "Service Accounts do not have storage quota".
// Voi Gmail ca nhan mien phi, cach duy nhat dung duoc la OAuth2: video se
// duoc tinh la do CHINH TAI KHOAN GMAIL cua nguoi dung tai len, dung dung
// 15GB mien phi cua ho.
//
// Can 3 bien moi truong (thay the GOOGLE_SERVICE_ACCOUNT_JSON cu):
//   GOOGLE_OAUTH_CLIENT_ID
//   GOOGLE_OAUTH_CLIENT_SECRET
//   GOOGLE_OAUTH_REFRESH_TOKEN
// Lay 3 gia tri nay bang cach chay 1 lan script scripts/get-drive-refresh-token.mjs
// TREN MAY TINH CA NHAN (khong chay tren Railway) - xem huong dan trong
// chinh file script do.

function getAuth() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Thieu GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REFRESH_TOKEN " +
      "(chay scripts/get-drive-refresh-token.mjs tren may ca nhan de lay 3 gia tri nay)"
    );
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return oauth2Client;
}

/**
 * Upload 1 file len Google Drive (Drive CA NHAN cua nguoi dung, qua OAuth2).
 * Nhan thang buffer (video da tai ve tu Runway/Pixazo, dang giu trong RAM)
 * thay vi doc tu dia, vi dia cua Railway khong dung de luu ben vung nua.
 * LUU Y: GOOGLE_DRIVE_FOLDER_ID gio la 1 folder NAM TRONG CHINH DRIVE CUA
 * BAN (khong can share cho ai ca, vi ban tu dang nhap luon).
 */
export async function uploadToDrive(buffer, filename) {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  const auth = getAuth();
  const drive = google.drive({ version: "v3", auth });

  const res = await drive.files.create({
    requestBody: {
      name: filename,
      parents: folderId ? [folderId] : undefined
    },
    media: {
      mimeType: "video/mp4",
      body: Readable.from(buffer)
    },
    fields: "id, webViewLink"
  });

  return res.data;
}
