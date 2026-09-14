// Tinh domain cong khai HIEN TAI cua chinh app - dung de tao link anh gui
// cho Pixazo (Pixazo bat buoc image_url phai la link internet that).
//
// QUAN TRONG: goi ham nay NGAY LUC CHUAN BI GUI request cho Pixazo (trong
// queue.js), KHONG duoc tinh 1 lan roi luu ket qua co dinh vao DB. Neu ban
// doi ten service hoac doi custom domain tren Railway giua luc 1 video con
// dang cho trong hang doi, domain se doi nhung nho tinh lai moi lan the
// nay, link luon khop domain moi nhat - khong bi "chet" nhu truoc (link cu
// tro ve domain da khong con ton tai, khien Pixazo tai anh bi timeout).
//
// Thu tu uu tien:
// 1. PUBLIC_BASE_URL - neu ban tu dinh nghia (vd chay sau CDN/proxy rieng,
//    hoac muon ep cung 1 domain cu the du service co doi ten).
// 2. RAILWAY_PUBLIC_DOMAIN - bien HE THONG Railway TU DONG bom vao moi
//    deploy, luon phan anh dung domain cong khai HIEN TAI cua service (ca
//    khi doi ten service lan gan custom domain rieng) - khong can ban tu
//    cau hinh gi ca.
// 3. Neu khong co ca 2 (vd dang chay tren may local) - nem loi ro rang,
//    vi Pixazo khong the goi nguoc lai duoc vao localhost cua ban.
export function getPublicBaseUrl() {
  if (process.env.PUBLIC_BASE_URL) {
    return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  }
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  }
  throw new Error(
    "Khong xac dinh duoc domain cong khai (can dat PUBLIC_BASE_URL, hoac chay tren Railway " +
      "de co san RAILWAY_PUBLIC_DOMAIN) - Pixazo khong the tai anh tu localhost cua ban."
  );
}
