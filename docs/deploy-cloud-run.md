# Triển khai lên Google Cloud Run

```
Trình duyệt ──► emis-video-web (Cloud Run, Next.js) ──/api, /files──► emis-video-api (Cloud Run, NestJS)
                                                                         │  jobs:run (JOB_NAME, JOB_DATA)
                                                                         ▼
                                                     emis-video-worker (Cloud Run Job: AI + render Remotion)
  Cloud SQL Postgres ◄── api, worker                 Bucket GCS gắn vào /data/storage của api và worker
```

- **Không cần Redis / worker chạy thường trực**: mỗi lần viết kịch bản hoặc sản xuất video, API gọi `jobs:run` của Cloud Run Job
  `emis-video-worker` (4 vCPU, 8 GiB, tối đa 1 giờ). Không có việc thì không tốn tiền compute.
- **File** nằm trong bucket GCS, gắn vào `/data/storage` bằng Cloud Storage volume. Trình duyệt tải ảnh/video qua link ký sẵn
  (V4, hạn 1 giờ) nên video lớn không đi qua Cloud Run. Worker phục vụ file cho renderer ngay trong tiến trình (`job.ts`).
- **Bí mật** ở Secret Manager: `emis-database-url`, `emis-app-secret`, `emis-admin-password`.
- **Gemini** gọi qua Gemini Enterprise Agent Platform (`GEMINI_PROVIDER=agent-platform`, vùng `global`). Có secret
  `emis-gemini-sa-key` (nội dung = file khoá JSON của service account có role `roles/aiplatform.user`) thì script gắn file đó
  chỉ đọc vào `/run/secrets/gcp-agent-platform.json` cho API và Job; không có secret thì dùng chính service account của Cloud Run
  (`emis-video-sa`, khi đó cấp role `roles/aiplatform.user` cho nó). Dịch vụ Agent Platform chưa có (nhạc nền Lyria 3.5) dùng
  Gemini API key phụ admin nhập ở trang **Cài đặt** (lưu mã hoá trong DB, dùng chung cho API và Job).

## Chuẩn bị một lần

```bash
P=my-project; R=asia-southeast1; SA=emis-video-sa@$P.iam.gserviceaccount.com
gcloud services enable run.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com \
  artifactregistry.googleapis.com cloudbuild.googleapis.com storage.googleapis.com iamcredentials.googleapis.com --project $P

# Postgres
gcloud sql instances create emis-video-db --project $P --region $R --database-version POSTGRES_16 \
  --tier db-f1-micro --edition enterprise --storage-size 10
gcloud sql databases create emis --instance emis-video-db --project $P
gcloud sql users create emis --instance emis-video-db --project $P --password "<mật khẩu DB>"

# Bucket, kho image, service account
gcloud storage buckets create gs://$P-emis-video --project $P --location $R --uniform-bucket-level-access --public-access-prevention
gcloud artifacts repositories create emis-video --project $P --location $R --repository-format docker
gcloud iam service-accounts create emis-video-sa --project $P
for role in roles/cloudsql.client roles/secretmanager.secretAccessor roles/run.developer roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding $P --member serviceAccount:$SA --role $role --condition=None
done
gcloud storage buckets add-iam-policy-binding gs://$P-emis-video --member serviceAccount:$SA --role roles/storage.objectAdmin
# Chạy Cloud Run Job dưới chính SA này + ký link tải GCS (signBlob)
for role in roles/iam.serviceAccountUser roles/iam.serviceAccountTokenCreator; do
  gcloud iam service-accounts add-iam-policy-binding $SA --project $P --member serviceAccount:$SA --role $role
done

# Bí mật (nhập từ bàn phím / pipe, không để trong lịch sử shell)
printf 'postgresql://emis:<mật khẩu DB>@localhost/emis?host=/cloudsql/%s' "$P:$R:emis-video-db" \
  | gcloud secrets create emis-database-url --project $P --data-file=-
openssl rand -base64 48 | tr -d '\n' | gcloud secrets create emis-app-secret --project $P --data-file=-
read -rs ADMIN_PW && printf '%s' "$ADMIN_PW" | gcloud secrets create emis-admin-password --project $P --data-file=-
```

## Triển khai / cập nhật

```bash
PROJECT=my-project REGION=asia-southeast1 ADMIN_EMAIL=admin@example.com ./deploy/deploy.sh
```

Script build 2 image bằng Cloud Build (backend cho API + Job, web), rồi cập nhật Job `emis-video-worker`, service `emis-video-api`
và `emis-video-web`. URL web: `https://emis-video-web-<project-number>.<region>.run.app`.

Sau lần đầu: đăng nhập bằng `ADMIN_EMAIL` + mật khẩu trong secret `emis-admin-password`, **đổi mật khẩu**, vào **Cài đặt** kiểm tra
nền tảng AI (project, vùng, service account), rồi thêm thành viên ở trang **Thành viên**.

Đưa file khoá service account lên Secret Manager (một lần, và mỗi lần thay khoá):

```bash
gcloud secrets create emis-gemini-sa-key --project $P --replication-policy automatic --data-file <file-khoá>.json
# thay khoá: gcloud secrets versions add emis-gemini-sa-key --project $P --data-file <file-khoá-mới>.json
gcloud secrets add-iam-policy-binding emis-gemini-sa-key --project $P \
  --member serviceAccount:emis-video-sa@$P.iam.gserviceaccount.com --role roles/secretmanager.secretAccessor
```

Secret mật khẩu admin chỉ dùng để tạo tài khoản lần đầu; đổi mật khẩu trên web không cần sửa secret.

## Lưu ý

- `APP_SECRET` dùng để ký phiên đăng nhập (và mã hoá API key khi dùng `developer-api`): đổi secret này sẽ đăng xuất mọi người.
- Bài học bị lỗi giữa chừng (ví dụ Job hết giờ) hiện trạng thái lỗi trên web, bấm **Chạy lại**. Log Job:
  `gcloud run jobs executions list --job emis-video-worker --region $R`.
- Chi phí khi rảnh: Cloud SQL db-f1-micro (~9 USD/tháng) + lưu trữ GCS; Cloud Run và Job chỉ tính khi có người dùng / đang sản xuất.
