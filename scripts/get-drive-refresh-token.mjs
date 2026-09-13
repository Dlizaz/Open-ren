// Script CHAY 1 LAN DUY NHAT TREN MAY TINH CA NHAN CUA BAN (khong chay tren
// Railway) de lay GOOGLE_OAUTH_REFRESH_TOKEN - dung de web upload video len
// CHINH GOOGLE DRIVE CA NHAN CUA BAN (thay the Service Account cu, vi Service
// Account khong co dung luong luu tru voi Gmail thuong).
//
// CACH DUNG:
// 1. Vao Google Cloud Console (console.cloud.google.com), chon dung project
//    ban da tao truoc do -> APIs & Services -> Credentials -> "+ Create
//    Credentials" -> "OAuth client ID".
//    - Neu chua co "OAuth consent screen" thi no se bat tao truoc: chon
//      "External", dien ten app bat ky, email ban -> Save and Continue qua
//      cac buoc (khong can dien them gi) -> Back to Dashboard. Vao muc
//      "Test users" them dung email Gmail ban dang dung.
//    - Application type: chon "Desktop app". Dat ten bat ky -> Create.
//    - Copy "Client ID" va "Client secret" hien ra.
// 2. Mo terminal tren may ban (khong phai Railway), dung vao trong thu muc
//    project nay, chay:
//      npm install
//      $env:GOOGLE_OAUTH_CLIENT_ID="dan_client_id_vao_day"     (PowerShell)
//      $env:GOOGLE_OAUTH_CLIENT_SECRET="dan_client_secret_vao_day"
//      node scripts/get-drive-refresh-token.mjs
//    (May Mac/Linux dung: export GOOGLE_OAUTH_CLIENT_ID=... thay vi $env:)
// 3. Script se in ra 1 duong link - mo link do trong trinh duyet, dang nhap
//    DUNG TAI KHOAN GMAIL BAN MUON LUU VIDEO VAO, bam "Continue"/"Allow".
// 4. Trinh duyet se tu redirect ve localhost va script tu bat duoc ma xac
//    thuc - terminal se in ra REFRESH TOKEN. Copy dong do.
// 5. Dem 3 gia tri (Client ID, Client Secret, Refresh Token) dien vao bien
//    moi truong tren Railway: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET,
//    GOOGLE_OAUTH_REFRESH_TOKEN. Xoa bien GOOGLE_SERVICE_ACCOUNT_JSON cu di
//    (khong can nua).

import { google } from "googleapis";
import http from "node:http";

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.log("❌ Thieu GOOGLE_OAUTH_CLIENT_ID hoac GOOGLE_OAUTH_CLIENT_SECRET.");
  console.log("Xem huong dan o dau file script nay de biet cach lay 2 gia tri do.");
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent", // bat buoc de chac chan Google tra ve refresh_token
  scope: ["https://www.googleapis.com/auth/drive"]
});

console.log("\n👉 Mo link nay trong trinh duyet, dang nhap dung Gmail muon dung:\n");
console.log(authUrl);
console.log("\nDang cho ban xac nhan trong trinh duyet...\n");

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith("/oauth2callback")) return;

  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get("code");

  res.end("Xong! Ban co the dong tab nay va quay lai terminal.");
  server.close();

  try {
    const { tokens } = await oauth2Client.getToken(code);
    console.log("✅ THANH CONG! Day la 3 gia tri can dien vao Railway:\n");
    console.log(`GOOGLE_OAUTH_CLIENT_ID=${CLIENT_ID}`);
    console.log(`GOOGLE_OAUTH_CLIENT_SECRET=${CLIENT_SECRET}`);
    console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`);

    if (!tokens.refresh_token) {
      console.log(
        "\n⚠️ Khong thay refresh_token. Neu ban da tung chay script nay truoc do voi " +
        "cung tai khoan, vao https://myaccount.google.com/permissions go quyen truy cap " +
        "cua app nay roi chay lai script tu dau."
      );
    }
  } catch (err) {
    console.log("❌ Loi khi doi code lay token:", err.message);
  }
});

server.listen(PORT);
