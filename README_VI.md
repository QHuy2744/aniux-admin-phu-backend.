# ANIUX AI Admin Phụ — Backend cho NVNMC

Bản này dùng NVNMC/Pterodactyl **Client API**, không dùng RCON và không cần mở cổng RCON. API key được lưu trong Environment của backend, tuyệt đối không đưa vào APK hoặc repository.

## Triển khai
1. Giải nén ZIP; tải các file bên trong thư mục `aniux-admin-phu-backend` lên repo GitHub backend (đặt `server.js`, `package.json`, `render.yaml` ở thư mục gốc repo).
2. Tạo Web Service trên Render từ repo đó.
3. Thêm Environment Variables:
   - `ADMIN_HELPER_KEY`: tự tạo mã đăng nhập cho admin phụ, dài và khó đoán.
   - `NVNMC_PANEL_URL`: `https://panel.nvnmc.cloud` (xác nhận đúng domain dashboard của bạn).
   - `NVNMC_SERVER_IDENTIFIER`: mã server, ví dụ `29fa32ab` nếu đó vẫn là identifier server của bạn.
   - `NVNMC_API_KEY`: Client API key tạo trong tài khoản NVNMC; chỉ lưu trên Render, không gửi vào chat/GitHub/APK.
   - `ADMIN_HELPER_PERMISSIONS`: `status,players,announce,kick` (hoặc bỏ quyền kick bằng `status,players,announce`).
4. Deploy. Mở `https://TEN-DICH-VU.onrender.com/health`; kết quả phải có `"ok":true`.
5. Trong APK nhập URL HTTPS của dịch vụ Render và giá trị `ADMIN_HELPER_KEY`.

## Quyền API
API key phải là Client API key và được phép đọc resources + gửi command. Nếu NVNMC không cấp Client API key hoặc quyền console command, thao tác sẽ báo lỗi 401/403. Không dùng Application API key.

## Hành vi
- `status`: đọc trạng thái/resources từ NVNMC.
- `players`: gửi lệnh `list`; Pterodactyl Client API không trả đầu ra console đồng bộ, nên xem kết quả ở mục Console trong NVNMC.
- `announce`: gửi lệnh `say` đã giới hạn nội dung.
- `kick`: chỉ nhận tên người chơi Java 1–16 ký tự.

Không gửi mật khẩu RCON hoặc secret quản trị vào chat. Nếu `management-server-secret` từng bị chia sẻ, hãy đổi nó. Đây là bộ khung tích hợp; cần kiểm tra quyền API thực tế của NVNMC sau khi deploy.
