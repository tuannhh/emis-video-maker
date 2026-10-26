# EMIS Video Maker

Tạo video bài học hoạt hình 2D tự động bằng Gemini. Con người chỉ làm 4 việc:
**đưa ý tưởng (kèm tư liệu, mascot, nhân vật/bối cảnh có sẵn nếu muốn) → duyệt kịch bản → duyệt thành phẩm → tự tải về đăng lên mạng xã hội**.

```
👤 Ý tưởng + tư liệu (ảnh, Word, PDF) + nhân vật, bối cảnh, ảnh phong cách tuỳ chọn
   ↓  gemini-3.8-flash (vision)   đọc tư liệu (OCR)
   ↓  gemini-3.8-flash            viết kịch bản (nhân vật, lời thoại, cảm xúc, cách đọc số)
👤 DUYỆT KỊCH BẢN                 sửa trực tiếp hoặc góp ý để AI sửa đúng chỗ (chọn câu, xem câu đã đổi, hoàn tác)
   ↓  gemini-3.8-flash            dàn dựng cảnh: nền, cỡ cảnh, camera, dáng diễn, phản ứng, nhãn/đếm, hiệu ứng âm thanh
   ↓  gemini-3.1-flash-lite-image vẽ nhân vật (Nano Banana 2 Lite, 1K) (4 dáng × 2 khẩu hình + chớp mắt) + bối cảnh và biến thể cùng nơi
                                  (AI tự kiểm tra số lượng đồ vật), lưu thư viện
   ↓  gemini-3.8-flash (vision)   định vị vật thể và từng vật cần đếm trong nền
   ↓  gemini-3.8-flash-tts        mỗi nhân vật đọc liền các câu của mình, giọng Bắc cố định, cắt theo khoảng lặng,
                                  tự kiểm tra lời đọc + vùng miền, tính khẩu hình
   ↓  lyria-002                   sáng tác nhạc nền ~30 giây, phát lặp (một lần, lưu thư viện dùng lại)
   ↓  Remotion                    render MP4 1080p30 + phụ đề SRT + thumbnail (nhạc nền tự giảm khi có lời, SFX)
   ↓  gemini-3.8-flash (video)    AI xem lại video, đối chiếu kịch bản, báo lỗi theo giây
👤 DUYỆT THÀNH PHẨM               duyệt, hoặc yêu cầu dựng lại video / sửa kịch bản
👤 Tải MP4 / SRT / thumbnail để đăng
```

## Chạy bằng Docker Compose

```bash
cp .env.example .env        # điền APP_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, GOOGLE_CLOUD_PROJECT, GEMINI_KEY_FILE
docker compose up -d --build
```

Mở http://localhost:3100, đăng nhập bằng `ADMIN_EMAIL` / `ADMIN_PASSWORD` (tài khoản admin được tạo ở lần chạy đầu).

### Gemini Enterprise Agent Platform

Lời gọi Gemini đi qua **Gemini Enterprise Agent Platform** (tên cũ Vertex AI) bằng service account. Dịch vụ nào Agent Platform
chưa có thì **đồng thời** dùng Gemini API key phụ (chế độ hybrid, xem bên dưới):

| Biến | Giá trị |
|---|---|
| `GEMINI_PROVIDER` | `agent-platform` (`developer-api` = đường cũ bằng API key, giữ để rollback) |
| `GOOGLE_CLOUD_PROJECT` | project chứa quyền và tính tiền, phải trùng `project_id` trong file khoá |
| `GOOGLE_CLOUD_LOCATION` | `global` (Nano Banana 2 Lite, Gemini 3.8, TTS đều có ở `global`) |
| `GEMINI_KEY_FILE` | Docker Compose: đường dẫn file khoá JSON **trên máy, ngoài thư mục mã nguồn**; được gắn chỉ đọc vào `/run/secrets` |
| `GOOGLE_APPLICATION_CREDENTIALS` | chạy trực tiếp bằng Node (`pnpm dev:*`): đường dẫn file khoá |

Service account cần đúng một role **Agent Platform User** (`roles/aiplatform.user`). App kiểm tra lúc khởi động và dừng ngay
(log rõ lý do) nếu thiếu project, không đọc được file khoá, file không phải service account hoặc khác project. Trang **Cài đặt**
hiện project, vùng, service account và model vẽ ảnh đang dùng. Không commit file khoá, không bake vào image.

Khác biệt so với Developer API (đã đo khi chuyển):
- **Hai model vẽ**: hình minh hoạ dùng **Nano Banana 2 Lite** (`gemini-3.1-flash-lite-image`, chỉ 1K, ~0,034 USD/ảnh); nhân vật
  và bối cảnh (vẽ một lần, dùng lại nhiều bài) dùng **Nano Banana 2** (`gemini-3.1-flash-image`, 2K, ~0,10 USD/ảnh) cho nét và
  màu đẹp hơn. Đổi bằng `GEMINI_IMAGE_MODEL` / `GEMINI_IMAGE_HQ_MODEL`; model Lite tự hạ yêu cầu 2K xuống 1K.
- **Lyria 3.x chưa có** trên Agent Platform: nhạc nền gọi `lyria-3.5` bằng **API key phụ**; không có key (hoặc lỗi) thì dùng
  `lyria-002` trên Agent Platform (WAV 32,8 giây, video phát lặp).
- **Không có Files API**: AI kiểm tra video gửi thẳng dữ liệu video trong request (đã thử video 46 MB).

**Hybrid với API key phụ**: key lấy từ trang **Cài đặt** (admin nhập, mã hoá trong DB) hoặc `GEMINI_API_KEY`. Ngoài nhạc nền,
nếu Agent Platform trả 404 (model chưa mở cho project/vùng) thì lời gọi đó tự chạy lại bằng key phụ và model được nhớ để các lần
sau đi thẳng qua key. Không có key phụ thì mọi thứ vẫn chạy trên Agent Platform.

Triển khai lên Google Cloud Run: xem [docs/deploy-cloud-run.md](docs/deploy-cloud-run.md).

## Tài khoản và phân quyền

| | Admin | Thành viên |
|---|---|---|
| Tạo bài, duyệt/sửa kịch bản, dựng lại, đổi nhạc, tải MP4/SRT/thumbnail | ✓ | ✓ (mọi bài) |
| Xoá bài học | ✓ | chỉ bài mình tạo |
| Thư viện: xem, tải nhạc lên, AI sáng tác nhạc | ✓ | ✓ |
| Thư viện: xoá nhân vật/bối cảnh, đặt nhạc mặc định, thay hiệu ứng | ✓ | |
| Cài đặt AI, báo cáo chi phí / token, quản lý thành viên | ✓ | |

- Admin thêm thành viên ở trang **Thành viên** (đặt mật khẩu ban đầu, đổi quyền, khoá, đặt lại mật khẩu). Mỗi người tự đổi mật khẩu ở menu tài khoản.
- Mật khẩu băm scrypt. Phiên đăng nhập là cookie HttpOnly ký HMAC (14 ngày); đổi mật khẩu hoặc khoá tài khoản sẽ thu hồi mọi phiên cũ.
  Sai mật khẩu 5 lần trong 15 phút thì tạm khoá đăng nhập.
- Gemini API key (key chính khi `GEMINI_PROVIDER=developer-api`, key phụ khi `agent-platform`) do admin nhập trên trang **Cài đặt**, hệ thống gọi thử Gemini trước khi lưu, mã hoá AES-256-GCM (khoá dẫn xuất từ
  `APP_SECRET`) rồi lưu DB, chỉ hiện 4 ký tự cuối. Đổi key có hiệu lực ngay, không cần khởi động lại. `GEMINI_API_KEY` trong môi trường
  chỉ là dự phòng khi chưa nhập key.
- File (`/files/...`) cũng cần đăng nhập; renderer dùng link nội bộ có chữ ký riêng cho từng file.

| Service | Vai trò |
|---|---|
| `web` | Next.js — giao diện, proxy `/api` và `/files` sang `api` |
| `api` | NestJS — REST API, phục vụ file |
| `worker` | NestJS + BullMQ — chạy pipeline AI và render Remotion (Chromium) |
| `postgres` | Bài học, thư viện nhân vật/bối cảnh, cache giọng đọc |
| `redis` | Hàng đợi công việc |

File (ảnh, audio, video) nằm trong volume `storage`, dùng chung giữa `api` và `worker`.
Chỉ `web` (3100) và `api` (4100) mở cổng, và chỉ trên `127.0.0.1`.

## Phát triển trên máy

```bash
pnpm install
docker compose up -d postgres redis   # Postgres: 15432, Redis: 16379
pnpm build:shared
pnpm dev:api        # http://localhost:4100
pnpm dev:worker
pnpm dev:web        # http://localhost:3100
pnpm dev:studio     # Remotion Studio để chỉnh hình ảnh video
```

## Cấu trúc

```
apps/api            NestJS: src/main.ts (HTTP) và src/worker.ts (pipeline)
  src/core          config, DB (tự migrate), storage, Gemini client, repo
  src/http          controller + luồng trạng thái bài học
  src/pipeline      các bước: script → storyboard → assets → voice → render → qa
apps/web            Next.js: danh sách/tạo bài, duyệt kịch bản, duyệt video, thư viện
packages/shared     schema zod dùng chung (kịch bản, storyboard, props render)
packages/video      composition Remotion: intro, cảnh (camera, nhân vật, nhãn, phụ đề), outro
docker/             Dockerfile cho backend và web
```

## Tạo bài học (`/new`)

| Mục | Cách dùng | Ghi chú |
| --- | --- | --- |
| Tư liệu tham khảo | Kéo thả, bấm chọn hoặc **Ctrl+V** dán ảnh ở bất kỳ đâu trên trang. Ảnh (PNG, JPG, WEBP), Word `.docx`, PDF | Tối đa **2MB mỗi tệp**, 5 tệp. Không tải thì AI tự soạn nội dung. `.doc` cũ cần lưu lại thành `.docx`/PDF |
| Nhân vật | Chọn tối đa 3 nhân vật trong thư viện, bấm ★ để chọn **mascot** dẫn dắt cả video; tuỳ chọn "chỉ dùng nhân vật đã chọn" | Dùng lại thì không tốn chi phí vẽ |
| Bối cảnh | Chọn tối đa 4 bối cảnh trong thư viện; tuỳ chọn "chỉ dùng bối cảnh đã chọn" (không vẽ nền mới) | Tiết kiệm nhất |
| Phong cách | Tải một ảnh mẫu (khung hình video cũ, tranh 3D...) | Nhân vật, bối cảnh **vẽ mới** theo phong cách ảnh này và được lưu riêng, không thay thế bản trong thư viện |

**Thêm nhân vật vào thư viện** (trang tạo bài hoặc trang Thư viện):

- **Tải mascot có sẵn**: AI vẽ lại đúng thiết kế (hình dáng, màu, logo) ở tư thế chính diện trên nền magenta để tách nền.
  Mascot nên rõ nét, thấy toàn thân và không có màu hồng tím.
- **AI tạo nhân vật mới**: ảnh tham chiếu (không bắt buộc) + ô yêu cầu, nút **✨ AI gợi ý** viết yêu cầu theo môn/lớp/chủ đề và ảnh
  tham chiếu; có thể vẽ theo ảnh phong cách của bài đang tạo.
- Xem trước tốn khoảng 1 ảnh; các dáng tay, khẩu hình, chớp mắt được dựng khi nhân vật được dùng trong bài lần đầu.

Tư liệu được AI đọc (OCR) một lần lúc viết kịch bản, kết quả lưu lại nên viết lại kịch bản không tốn thêm. Chi phí đọc tư liệu
và tạo nhân vật ở thư viện có mục riêng trong trang Báo cáo.

## URL bài học

`/{môn}/{lớp}/{tên-bài}/{mã 6 ký tự}`, ví dụ `/toan/lop-1/lam-quen-voi-so-10/1122ab`. Bài được tìm theo mã; đổi tên bài
thì URL tự cập nhật, link cũ (kể cả `/lessons/{id}`) vẫn mở được.

## Âm thanh

- **Nhạc nền**: chọn "Tự động" (bản mặc định trong thư viện; chưa có thì AI sáng tác bằng Lyria), bản khác trong thư viện,
  tải file lên, hoặc tắt. Chỉnh âm lượng và mức tự giảm khi nhân vật nói (ducking). Đổi nhạc sau khi đã render chỉ render lại,
  không gọi lại AI.
- **Hiệu ứng (SFX)**: `pop, ding, chime, sparkle, whoosh, swish, boing, click, tada, bubble` được **tổng hợp bằng code**
  (`apps/api/src/pipeline/sfx.ts`), không phụ thuộc file của bên thứ ba. AI chọn điểm nhấn cho từng câu; hệ thống tự thêm tiếng
  chuyển cảnh, nhãn hiện ra, đếm từng vật. Có thể thay từng hiệu ứng bằng file riêng trong Thư viện.
  Không dùng âm thanh từ các trang như myinstants: file do người dùng tải lên, không rõ bản quyền, rủi ro khi dùng thương mại.

## Token và chi phí

Mọi lượt gọi Gemini (viết kịch bản, dàn dựng, vẽ, định vị, lồng tiếng, kiểm tra lời đọc, sáng tác nhạc, AI xem video) được ghi vào
bảng `gemini_usage` theo bài học và bước, **cộng dồn cả các lần viết lại / dựng lại**. Trang bài học hiện tổng token, theo bước,
theo model và theo loại dữ liệu (chữ/ảnh/âm thanh); trang **Báo cáo** tổng hợp theo bài, theo thành viên, theo bước và model.
Chỉ admin xem được: `GET /api/lessons/{id}/usage`, `GET /api/usage`, `GET /api/usage/lessons`.

Để tự tính tiền, khai báo giá (USD / 1 triệu token) trong `.env`:

```bash
GEMINI_PRICING={"gemini-3.8-flash":{"input":0.5,"input_audio":1,"output":3},"gemini-3.8-flash-tts":{"input":0.5,"output_audio":10},"gemini-3.1-flash-lite-image":{"input":0.25,"output_image":30},"gemini-3.1-flash-image":{"input":0.5,"output_image":60},"lyria-3.5":{"request":0.08},"lyria-002":{"request":0.06}}
```

(số trên chỉ là ví dụ định dạng — lấy giá thật trong bảng giá Gemini API). Khoá theo loại: `input_text/input_image/input_audio/input_video`,
`output_text/output_image/output_audio`, thiếu thì dùng `input`/`output`; token suy luận tính theo giá output chữ.
Tài sản dùng lại từ thư viện và câu thoại đã có trong cache không tốn token.

## Trạng thái bài học

`generating_script` → `script_review` → `producing` → `final_review` → `approved`, lỗi thì `failed`
(nút "Chạy lại" tiếp tục từ bước lỗi; nhân vật, bối cảnh và giọng đọc đã tạo được giữ lại).

## Ghi chú kỹ thuật

- **Remotion license**: miễn phí cho cá nhân và công ty ≤ 3 nhân viên. MVP đang ở giai đoạn đánh giá;
  dùng chính thức cần mua Company License. Phần render tách riêng trong `packages/video` và
  `apps/api/src/pipeline/render.step.ts` để có thể thay bằng renderer khác.
- **Gemini TTS** (đã đo thực tế với `gemini-3.8-flash-tts`):
  - Mỗi request TTS tự chọn giọng Bắc hoặc Nam ngẫu nhiên: đọc từng câu riêng thì 2/6 câu ra giọng Nam, nên hội thoại bị
    "nhảy giọng". Chỉ định qua trường có cấu trúc `speechMetadata.style` ("Standard Northern Vietnamese accent (Hà Nội)…"):
    12/12 giọng Bắc và **không bị đọc thành lời** (khác với câu chỉ dẫn hay thẻ `[excited]` trong văn bản — 4/8 mẫu bị đọc ra).
    SDK hiện bỏ mất `speechMetadata` nên gọi REST trực tiếp.
  - Mỗi nhân vật đọc liền tối đa 6 câu trong một request (giọng nhất quán), cắt theo khoảng lặng bằng quy hoạch động
    (nghỉ giữa hai câu dài hơn nghỉ trong câu), rồi chép lời từng đoạn để kiểm tra + kiểm tra vùng miền cả đoạn;
    câu nào sai thì đọc lại riêng câu đó. Audio được cache theo (model, phiên bản, giọng, style, độ trẻ, lời).
  - **Giọng trẻ em**: Gemini TTS không có giọng trẻ em riêng. Nhân vật trẻ em/mascot được (1) mô tả âm sắc trẻ con trong
    `speechMetadata.style` cùng chỉ dẫn diễn xuất từng câu (`delivery`, ví dụ "gasp, rising tone of wonder"), đo được cao độ
    tăng 230→280 Hz (Puck), 280→316 Hz (Leda); (2) nâng cao độ thêm 6–17% sau khi đọc (`youngerVoice` trong `audio.ts`: đổi tốc
    độ lấy mẫu rồi kéo giãn WSOLA nên **giữ nguyên thời lượng**, khớp miệng không lệch). Mức "độ trẻ giọng" chọn theo nhân vật
    trong trang kịch bản, có nút **Nghe thử**.
- **Chuyển động**: nhân vật đứng trong không gian của bối cảnh nên camera zoom/lia là zoom cả cảnh như quay thật.
  Cỡ cảnh wide / two-shot / medium / close-up / object, người nói đặt ở một phần ba khung chừa khoảng nhìn; shot/phản shot
  là cắt thẳng, camera chỉ di chuyển khi dẫn mắt (toàn cảnh → vật), đường cong chậm dần; nhoè hậu cảnh ở trung/cận cảnh;
  chuyển cảnh iris / slide / hoà tan (cùng nơi). Khi nói nhân vật khua tay theo lời (3 cử chỉ: một tay mở, hai tay giải thích,
  giơ ngón tay) — giơ tay khi bắt đầu nói, đổi cử chỉ ở chỗ ngắt hơi hoặc giữa cụm dài, buông tay khi nói xong; miệng nhép theo
  giọng, mắt chớp, quay mặt về người đang nói. **Biểu cảm**: mắt/mày đổi theo cảm xúc câu thoại (vui, ngạc nhiên, suy nghĩ), hiện
  dần rồi tắt dần; người nghe vui lây khi bạn reo. **Chuyển động cơ thể**: cả người (mọi lớp ảnh cùng lúc nên không lệch) thở
  nhẹ, lắc lư theo nhịp và độ lớn giọng khi nói, gật đầu khi đồng ý, hơi nghiêng về phía người đang nói, nhảy khi reo mừng.
  Mức chuyển động chọn khi tạo bài: nhẹ nhàng / vừa phải / sinh động. Có bóng tiếp đất.
  Props của từng lần render lưu ở `lessons/{id}/{stamp}/props.json` để mở lại trong Remotion Studio.
- **Bối cảnh**: model ảnh hay vẽ sai số lượng (bài số 3 nhưng đĩa có 5 quả cam). Storyboard ghi rõ "EXACTLY THREE ...",
  sau khi vẽ Gemini đối chiếu ảnh với mô tả; sai thì vẽ lại kèm lỗi cụ thể (tối đa 3 lần).
- **Bối cảnh cùng nơi**: khi số lượng đồ vật đổi giữa các phần (9 quả cam → 10 quả), AI tạo nền biến thể bằng cách sửa ảnh nền
  gốc nên vẫn là cùng một căn phòng, chuyển cảnh bằng hoà tan. Model sửa ảnh hay chỉ xếp lại đồ vật thay vì thêm, nên mỗi vòng vẽ
  2 bản song song, AI đếm lại từng bản, tối đa 3 vòng; vẫn sai thì ghi cảnh báo vào lịch sử bài học và đánh dấu nền trong thư viện
  để lần sau vẽ lại (AI kiểm tra video cuối cũng bắt lỗi này).
- **Phong cách vẽ**: chọn khi tạo bài — hoạt hình 2D hiện đại (mặc định), hoạt hình 3D mềm, tranh truyện màu nước, giấy cắt —
  hoặc tải ảnh mẫu phong cách. Nhân vật, bối cảnh, hình minh hoạ vẽ theo phong cách khác mặc định được gắn hậu tố mã phong cách
  nên không lẫn với bản cũ trong thư viện. Kịch bản yêu cầu nhân vật đa dạng (tuổi, dáng, trang phục, màu chủ đạo khác nhau).
- **Nhân vật (rig 6)**: vẽ góc 3/4 trên nền magenta, AI sửa ảnh ra 5 dáng tay (nói, giải thích, ý tưởng, chỉ, reo) + miệng mở
  + mắt nhắm + 3 biểu cảm mắt (vui, ngạc nhiên, suy nghĩ), tách nền và cắt chung một khung. Mỗi lần sửa ảnh là một bản vẽ lại nên nét viền, tóc, mắt lệch nhau vài pixel —
  đổi nguyên ảnh theo từng âm tiết sẽ làm nhân vật rung. Vì vậy `apps/api/src/pipeline/rig.ts` lấy ảnh đứng làm nền cố định:
  chỉ vùng tay thật sự thay đổi được dán lên (bỏ nét lệch mảnh, giữ nguyên từng pixel của đầu), còn miệng mở và mắt nhắm
  và biểu cảm được tách thành miếng dán nhỏ chồng lên mặt. Nhân vật cũ được nâng cấp tự động, dùng lại ảnh đã vẽ, chỉ vẽ thêm dáng còn thiếu. Nhân vật và bối cảnh lưu thư viện, bài sau dùng lại cho nhất quán;
  xoá trong trang Thư viện để AI vẽ lại. Miệng/mắt được tìm theo vị trí đôi mắt bên trong thân (đúng cả với mascot trong suốt,
  mặt thấp); vị trí miệng được lưu để camera trung/cận cảnh luôn giữ miệng trên vùng phụ đề.
- **Hình minh hoạ**: khi lời thoại nhắc tới sự vật không có trong nền ("tròn như bánh xe"), AI vẽ hình sự vật (lưu thư viện,
  dùng lại) và hình bật ra cạnh nhân vật đúng lúc nói tới. Một câu nhắc nhiều vật thì vẽ đủ từng vật (tối đa 4 mỗi câu, 16 mỗi
  bài), kèm **quan hệ vị trí** ("chim sẻ **trên** cây", "mèo **dưới** bàn", trong, cạnh, trái, phải...): video ghép các vật thành
  một cụm đúng vị trí, cỡ to/vừa/nhỏ theo thực tế, chú thích gộp "Chim sẻ trên cây". Câu đếm ("một, hai... sáu cây bút chì") thì
  video tự nhân hình thành đúng số lượng, từng cái hiện theo nhịp đếm. Màu nền tách (magenta/xanh lá/xanh dương) được chọn theo
  màu của vật để không làm mất màu vật (con lợn hồng, chùm nho tím).
- **Sửa đúng chỗ**: góp ý kịch bản thì AI trả về bản vá (sửa/chèn/xoá từng câu), các câu khác giữ nguyên từng chữ; có thể tích
  chọn câu để AI chỉ sửa những câu đó. Câu đã đổi được tô màu kèm câu cũ, hoàn tác từng câu hoặc tất cả. Khi sản xuất lại, chỉ
  những phần có câu thay đổi mới được dàn dựng lại (cảnh khác, hình, giọng đọc đều dùng lại); góp ý video thì AI chỉ dựng lại
  các cảnh liên quan (biết câu nào ở giây nào).
- **Bố cục chữ**: nhãn, số đếm và hình minh hoạ được xếp vào chỗ trống trong khung (không đè lên nhân vật, không tràn mép,
  không chạm phụ đề); khi dàn dựng, nhân vật đứng che vật cần đếm sẽ được dời sang bên.
- **Model** đổi được qua biến môi trường `GEMINI_TEXT_MODEL`, `GEMINI_TTS_MODEL`, `GEMINI_IMAGE_MODEL`, `GEMINI_IMAGE_HQ_MODEL`,
  `GEMINI_MUSIC_MODEL`, `GEMINI_MUSIC_FALLBACK_MODEL`.
