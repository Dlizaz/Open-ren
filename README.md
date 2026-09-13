# Open ren - Video Queue (Runway + Pixazo, Auto Google Drive)

Web nhỏ để bạn:
1. Upload 1 file CSV chứa nhiều prompt (+ ảnh nếu muốn dùng image-to-video)
2. Chọn nguồn tạo video: **Runway** (nhiều model) hoặc **Pixazo** (model LTX của Lightricks, free tier)
3. Bấm "Bắt đầu render" rồi đi làm việc khác
4. Máy tự render từng video qua API tương ứng, tự tải về, tự đẩy lên Google Drive
5. Có thể tắt tab/trình duyệt — server vẫn chạy nền trên Railway
6. Pause / Resume / Stop được **từng video riêng lẻ**, không chỉ cả hàng đợi
7. Trạng thái + video được lưu trên **MongoDB Atlas**, không phụ thuộc đĩa của Railway — server bị restart/redeploy giữa chừng thì video đang render sẽ tự động render tiếp

## 0. Giới hạn độ dài prompt (quan trọng)

Mỗi nguồn có giới hạn ký tự prompt riêng, lấy theo đúng giới hạn API của họ:
- **Runway**: cứng **1000 ký tự** ngay tại API của họ (không phải do code này) — gửi prompt dài hơn sẽ bị Runway trả lỗi 400 `"Too big: expected string to have <=1000 characters"`.
- **Pixazo (LTX)**: **4500 ký tự**.

App sẽ tự chặn và báo lỗi rõ ràng cho prompt nào vượt quá giới hạn của nguồn đang chọn, ngay từ lúc bạn bấm "Bắt đầu render", để không mất công chờ render rồi mới biết lỗi.

## 0.0.1. Lưu ý riêng khi dùng Pixazo (LTX)

- Pixazo/LTX **chỉ hỗ trợ image-to-video**, không có text-to-video — mỗi dòng dùng Pixazo bắt buộc phải có ảnh.
- Pixazo yêu cầu ảnh phải là 1 **link công khai trên internet** (họ tải ảnh về từ server của họ), khác với Runway (nhận thẳng base64). Vì vậy web tự lưu ảnh bạn upload vào MongoDB GridFS và phát lại qua route `/uploads/:id` để tạo link công khai đó — **chỉ hoạt động khi web có domain public thật** (deploy Railway...), **không chạy được khi mở ở localhost** vì Pixazo không thể kết nối vào máy local của bạn.
- Cần điền `PIXAZO_KEY` trong biến môi trường (xem `.env.example`), lấy free tại pixazo.ai.
- Pixazo không có bước upscale 4K riêng và không có API huỷ job giữa chừng như Runway, nên nút Stop với video Pixazo chỉ dừng poll ở phía web, job có thể vẫn chạy ngầm bên Pixazo.

## 0.1. Cấu hình MongoDB Atlas (bắt buộc từ bản này)

1. Vào MongoDB Atlas → tạo (hoặc dùng) 1 Cluster miễn phí
2. **Database Access**: tạo 1 user (username/password)
3. **Network Access**: thêm `0.0.0.0/0` (cho phép Railway kết nối) hoặc IP cụ thể của Railway
4. **Database → Connect → Drivers**: copy connection string dạng `mongodb+srv://user:password@cluster.xxxxx.mongodb.net/?retryWrites=true&w=majority`
5. Dán vào biến môi trường `MONGODB_URI` (trong `.env` khi chạy local, hoặc trong Railway → Variables khi deploy)

Toàn bộ trạng thái từng video (đang chạy / thất bại / xong) và cả file video đã render (lưu qua GridFS) đều nằm trong Mongo, không còn phụ thuộc đĩa tạm của Railway nữa.

## 1. Cấu trúc CSV

| cột | bắt buộc | mô tả |
|---|---|---|
| id | có | mã định danh, dùng để đặt tên file video, vd `001` |
| prompt | có | nội dung prompt |
| model | không | `gen4.5`, `seedance2_5`, `wan3`... (mặc định `gen4.5`) |
| duration | không | số giây (mặc định 5) |
| image | không | tên file ảnh **đã upload cùng lúc**, dùng cho image-to-video |

Xem file mẫu `prompts.example.csv`. Nếu dòng có cột `image` khớp tên 1 ảnh bạn upload, hệ thống tự chuyển sang chế độ image-to-video cho dòng đó.

## 2. Chạy thử ở máy local

```bash
npm install
cp .env.example .env
# điền RUNWAYML_API_SECRET (nếu dùng Runway) và/hoặc PIXAZO_KEY (nếu dùng Pixazo) vào .env
npm start
```

Lưu ý: chạy ở `localhost` vẫn dùng được Runway bình thường, nhưng **Pixazo sẽ không hoạt động** ở localhost (xem mục 0.0.1 phía trên) — cần deploy lên host có domain public để thử Pixazo.

Mở `http://localhost:3000`.

## 3. Lấy Runway API key

Tạo tại **dev.runwayml.com** (khác với tài khoản web runwayml.com thường dùng). Lưu ý: gói Unlimited trên web KHÔNG tự động thành API không giới hạn — API tính phí theo credit riêng.

## 4. Cấu hình Google Drive tự động upload (tuỳ chọn nhưng bạn cần cái này)

Vì server chạy trên Railway (không có màn hình đăng nhập Google của bạn), cách ổn định nhất là dùng **Service Account**:

1. Vào [Google Cloud Console](https://console.cloud.google.com/) → tạo project mới (hoặc dùng project có sẵn)
2. Bật **Google Drive API** cho project đó
3. Vào **IAM & Admin → Service Accounts → Create Service Account**
4. Sau khi tạo, vào tab **Keys → Add Key → JSON** → tải file JSON về
5. Mở file JSON đó, copy toàn bộ nội dung, dán làm giá trị biến `GOOGLE_SERVICE_ACCOUNT_JSON` (dán nguyên 1 dòng)
6. **Quan trọng:** vào Google Drive, tạo 1 folder để chứa video, bấm **Share** folder đó và thêm email của service account (dạng `xxx@xxx.iam.gserviceaccount.com`) với quyền **Editor**
7. Copy ID của folder (đoạn cuối URL khi mở folder) vào `GOOGLE_DRIVE_FOLDER_ID`

> Lưu ý: Service account có Drive riêng gần như không có dung lượng "My Drive" cá nhân — bắt buộc phải share folder như bước 6, nếu không sẽ báo lỗi quota khi upload.

Nếu bạn không set `GOOGLE_SERVICE_ACCOUNT_JSON`, hệ thống vẫn chạy bình thường, chỉ là video sẽ chỉ lưu local (tải qua nút "Tải video" trên web) chứ không tự đẩy Drive.

## 4.1. Pause / Resume / Stop từng video

Ở bảng trạng thái, mỗi dòng video có nút riêng:
- **⏸ Pause**: dừng video đó lại ở điểm kiểm tra gần nhất (trước khi bắt đầu render, hoặc sau khi render xong nhưng trước khi upscale/tải/upload — Runway không hỗ trợ tạm dừng giữa lúc đang render nên nếu video đang render dở, nó sẽ render xong bước đó rồi mới dừng)
- **▶ Resume**: cho chạy tiếp nếu đang Pause; nếu video đã Stop hoặc Failed thì Resume sẽ render lại từ đầu
- **⏹ Stop**: hủy hẳn video đó — nếu đang chờ Runway render, app sẽ gọi hủy task thật trên Runway (`DELETE /v1/tasks/{id}`) để không bị tính phí credit cho phần dở dang

Nút Pause/Resume/Stop tổng ở phía trên (⏸/▶/⏹ cạnh chữ "Đang chạy...") vẫn còn, áp dụng cho cả hàng đợi.

## 5. Đẩy lên GitHub

```bash
git init
git add .
git commit -m "init runway video queue"
git branch -M main
git remote add origin <link_repo_cua_ban>
git push -u origin main
```

`.env` đã được `.gitignore`, sẽ không bị đẩy lên — an toàn.

## 6. Deploy Railway

1. Vào [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo** → chọn repo vừa tạo
2. Railway tự nhận diện Node.js qua `package.json` (`npm install` + `npm start`)
3. Vào tab **Variables**, thêm các biến giống `.env.example`:
   - `RUNWAYML_API_SECRET` (nếu dùng Runway)
   - `PIXAZO_KEY` (nếu dùng Pixazo)
   - `PUBLIC_BASE_URL` (thường để trống là được, server tự suy ra domain Railway)
   - `GOOGLE_SERVICE_ACCOUNT_JSON`
   - `GOOGLE_DRIVE_FOLDER_ID`
   - `QUEUE_CONCURRENCY` (vd `2`)
   - Không cần set `PORT`, Railway tự cấp
4. Deploy xong, Railway cho bạn 1 domain dạng `xxx.up.railway.app` — mở link đó chính là trang upload

### Lưu ý quan trọng về lưu trữ trên Railway

Railway dùng **ổ đĩa tạm (ephemeral)** — nếu app restart/redeploy, các file trong `downloads/` và `uploads/` (và cả `status.json`) có thể bị xoá. Vì vậy:
- Video luôn nên được đẩy lên Google Drive ngay khi render xong (đã tự động làm ở bước 4) — đừng dựa vào việc video còn nằm trên Railway lâu dài
- Nếu cần resume chính xác sau khi Railway restart, nên gắn thêm 1 [Railway Volume](https://docs.railway.app/reference/volumes) mount vào thư mục project để `status.json`/`downloads` không mất — mình có thể hướng dẫn thêm nếu bạn cần

## 7. Các nút điều khiển trên web

- **Pause**: tạm dừng, các job đang chạy sẽ hoàn tất rồi các job tiếp theo chờ
- **Resume**: chạy tiếp
- **Stop**: dừng hẳn queue hiện tại
- Bảng trạng thái tự refresh mỗi 3 giây, hiện `QUEUE → RENDERING → UPLOADING → DONE` (hoặc `FAILED` sau khi thử lại 2 lần)

## 8. Những gì bản này có so với bản MVP ban đầu

- ✅ Web UI upload CSV + nhiều ảnh cùng lúc (kéo/chọn file), không cần sửa code
- ✅ Hỗ trợ cả text-to-video và image-to-video (tự chọn theo cột `image`)
- ✅ Tự động upload video lên Google Drive qua Service Account
- ✅ `status.json` để biết job nào DONE/FAILED, resume không làm lại job đã xong
- ✅ Concurrency (chạy song song nhiều job), tự retry 2 lần khi lỗi
- ✅ Nút Pause / Resume / Stop
- ✅ Sẵn sàng deploy Railway từ GitHup bằng `npm start`

## 9. Có thể thêm sau (nếu bạn cần)

- Railway Volume để không mất dữ liệu khi redeploy
- Thanh progress bar tổng (x/y hoàn thành) và ước tính credit đã dùng
- Đặt tên file theo ngày (`christmas_2026-09-12_001.mp4`)
- Giới hạn upload bằng mật khẩu đơn giản (tránh người lạ vào trang dùng credit của bạn)
