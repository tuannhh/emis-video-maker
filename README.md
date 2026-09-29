# Edu Video AI

Tạo video bài học hoạt hình 2D tự động bằng Gemini. Con người chỉ làm 4 việc:
**đưa ý tưởng → duyệt kịch bản → duyệt thành phẩm → tự tải về đăng lên mạng xã hội**.

```
👤 Ý tưởng
   ↓  gemini-3.8-flash            viết kịch bản (nhân vật, lời thoại, cảm xúc, cách đọc số)
👤 DUYỆT KỊCH BẢN                 sửa trực tiếp hoặc yêu cầu AI viết lại theo góp ý
   ↓  gemini-3.8-flash            dàn dựng cảnh: nền, cỡ cảnh, camera, dáng diễn, phản ứng, nhãn/đếm, hiệu ứng âm thanh
   ↓  gemini-3.1-flash-image      vẽ nhân vật (4 dáng × 2 khẩu hình + chớp mắt) + bối cảnh và biến thể cùng nơi
                                  (AI tự kiểm tra số lượng đồ vật), lưu thư viện
   ↓  gemini-3.8-flash (vision)   định vị vật thể và từng vật cần đếm trong nền
   ↓  gemini-3.8-flash-tts        mỗi nhân vật đọc liền các câu của mình, giọng Bắc cố định, cắt theo khoảng lặng,
                                  tự kiểm tra lời đọc + vùng miền, tính khẩu hình
   ↓  lyria-3.5                   sáng tác nhạc nền (một lần, lưu thư viện dùng lại)
   ↓  Remotion                    render MP4 1080p30 + phụ đề SRT + thumbnail (nhạc nền tự giảm khi có lời, SFX)
   ↓  gemini-3.8-flash (video)    AI xem lại video, đối chiếu kịch bản, báo lỗi theo giây
👤 DUYỆT THÀNH PHẨM               duyệt, hoặc yêu cầu dựng lại video / sửa kịch bản
👤 Tải MP4 / SRT / thumbnail để đăng
```

## Chạy bằng Docker Compose

```bash
cp .env.example .env        # điền GEMINI_API_KEY
docker compose up -d --build
```

Mở http://localhost:3100.

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
theo model và theo loại dữ liệu (chữ/ảnh/âm thanh). `GET /api/lessons/{id}/usage` cho từng bài, `GET /api/usage` cho toàn hệ thống.

Để tự tính tiền, khai báo giá (USD / 1 triệu token) trong `.env`:

```bash
GEMINI_PRICING={"gemini-3.8-flash":{"input":0.5,"input_audio":1,"output":3},"gemini-3.8-flash-tts":{"input":0.5,"output_audio":10},"gemini-3.1-flash-image":{"input":0.5,"output_image":30},"lyria-3.5":{"input":0,"output_audio":0}}
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
    câu nào sai thì đọc lại riêng câu đó. Audio được cache theo (model, phiên bản, giọng, style, lời).
- **Chuyển động**: nhân vật đứng trong không gian của bối cảnh nên camera zoom/lia là zoom cả cảnh như quay thật.
  Cỡ cảnh wide / two-shot / medium / close-up / object, người nói đặt ở một phần ba khung chừa khoảng nhìn; shot/phản shot
  là cắt thẳng, camera chỉ di chuyển khi dẫn mắt (toàn cảnh → vật), đường cong chậm dần; nhoè hậu cảnh ở trung/cận cảnh;
  chuyển cảnh iris / slide / hoà tan (cùng nơi). Nhân vật **đứng yên như diễn viên**: thân và đầu không rung lắc, khi nói chỉ
  tay khua theo lời (3 cử chỉ: một tay mở, hai tay giải thích, giơ ngón tay) — giơ tay khi bắt đầu nói, đổi cử chỉ ở chỗ ngắt hơi
  hoặc giữa cụm dài, giữ tay qua nhịp nghỉ ngắn, buông tay khi nói xong; miệng nhép theo giọng, mắt chớp, quay mặt về người
  đang nói; chuyển động toàn thân chỉ khi nhảy lên reo mừng. Có bóng tiếp đất.
  Props của từng lần render lưu ở `lessons/{id}/{stamp}/props.json` để mở lại trong Remotion Studio.
- **Bối cảnh**: model ảnh hay vẽ sai số lượng (bài số 3 nhưng đĩa có 5 quả cam). Storyboard ghi rõ "EXACTLY THREE ...",
  sau khi vẽ Gemini đối chiếu ảnh với mô tả; sai thì vẽ lại kèm lỗi cụ thể (tối đa 3 lần).
- **Bối cảnh cùng nơi**: khi số lượng đồ vật đổi giữa các phần (9 quả cam → 10 quả), AI tạo nền biến thể bằng cách sửa ảnh nền
  gốc nên vẫn là cùng một căn phòng, chuyển cảnh bằng hoà tan. Model sửa ảnh hay chỉ xếp lại đồ vật thay vì thêm, nên mỗi vòng vẽ
  2 bản song song, AI đếm lại từng bản, tối đa 3 vòng; vẫn sai thì ghi cảnh báo vào lịch sử bài học và đánh dấu nền trong thư viện
  để lần sau vẽ lại (AI kiểm tra video cuối cũng bắt lỗi này).
- **Nhân vật (rig 3)**: vẽ góc 3/4 trên nền magenta, AI sửa ảnh ra 5 dáng tay (nói, giải thích, ý tưởng, chỉ, reo) + miệng mở
  + mắt nhắm, tách nền và cắt chung một khung. Mỗi lần sửa ảnh là một bản vẽ lại nên nét viền, tóc, mắt lệch nhau vài pixel —
  đổi nguyên ảnh theo từng âm tiết sẽ làm nhân vật rung. Vì vậy `apps/api/src/pipeline/rig.ts` lấy ảnh đứng làm nền cố định:
  chỉ vùng tay thật sự thay đổi được dán lên (bỏ nét lệch mảnh, giữ nguyên từng pixel của đầu), còn miệng mở và mắt nhắm
  được tách thành miếng dán nhỏ chồng lên mặt. Nhân vật cũ được nâng cấp tự động, dùng lại ảnh đã vẽ, chỉ vẽ thêm dáng còn thiếu. Nhân vật và bối cảnh lưu thư viện, bài sau dùng lại cho nhất quán;
  xoá trong trang Thư viện để AI vẽ lại.
- **Model** đổi được qua biến môi trường `GEMINI_TEXT_MODEL`, `GEMINI_TTS_MODEL`, `GEMINI_IMAGE_MODEL`, `GEMINI_MUSIC_MODEL`.
