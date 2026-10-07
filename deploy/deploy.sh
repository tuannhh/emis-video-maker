#!/usr/bin/env bash
# Triển khai EMIS Video Maker lên Google Cloud Run.
#
#   PROJECT=my-project REGION=asia-southeast1 ADMIN_EMAIL=admin@example.com ./deploy/deploy.sh
#
# Cần làm một lần trước (xem docs/deploy-cloud-run.md): Cloud SQL, bucket, Artifact Registry, service account,
# và 3 secret: emis-database-url, emis-app-secret, emis-admin-password. Script không chứa bí mật nào.
set -euo pipefail
# Git Bash trên Windows tự đổi "/data/storage" trong tham số volume thành đường dẫn Windows: bỏ qua tham số đó
export MSYS2_ARG_CONV_EXCL="volume="

: "${PROJECT:?Đặt PROJECT}"
: "${ADMIN_EMAIL:?Đặt ADMIN_EMAIL}"
REGION="${REGION:-asia-southeast1}"
SQL_INSTANCE="${SQL_INSTANCE:-emis-video-db}"
BUCKET="${BUCKET:-$PROJECT-emis-video}"
SA="emis-video-sa@$PROJECT.iam.gserviceaccount.com"
REPO="$REGION-docker.pkg.dev/$PROJECT/emis-video"
TAG="${TAG:-$(git rev-parse --short HEAD)-$(date +%Y%m%d%H%M)}"

NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
API_URL="https://emis-video-api-$NUMBER.$REGION.run.app"
WEB_URL="https://emis-video-web-$NUMBER.$REGION.run.app"

if [ "${SKIP_BUILD:-}" != "1" ]; then
  echo "==> Build image $TAG"
  gcloud builds submit . --project "$PROJECT" --region "$REGION" --config deploy/cloudbuild.yaml \
    --substitutions "_REPO=$REPO,_TAG=$TAG,_API_URL=$API_URL"
fi

# Giá USD / 1 triệu token (bảng giá Standard, ai.google.dev) để báo cáo chi phí
DEFAULT_PRICING='{"gemini-3.8-flash":{"input":0.75,"output":3.75},"gemini-3.1-flash-image":{"input":0.5,"output":3,"output_image":60},"gemini-3.8-flash-tts":{"input":0.5,"output":9,"output_audio":9},"lyria-3.5":{"request":0.08,"input":0,"output":0}}'
PRICING="${GEMINI_PRICING:-$DEFAULT_PRICING}"

# Biến môi trường chung (không bí mật). GEMINI_PRICING có dấu phẩy nên dùng file YAML.
ENV_FILE=$(mktemp ./.deploy-env.XXXXXX)
trap 'rm -f "$ENV_FILE"' EXIT
cat >"$ENV_FILE" <<EOF
NODE_ENV: production
QUEUE_DRIVER: cloudrun
GCP_PROJECT: "$PROJECT"
GCP_REGION: "$REGION"
WORKER_JOB: emis-video-worker
STORAGE_DIR: /data/storage
STORAGE_BUCKET: "$BUCKET"
FILES_INTERNAL_URL: http://127.0.0.1:4100
WEB_ORIGIN: "$WEB_URL"
COOKIE_SECURE: "true"
ADMIN_EMAIL: "$ADMIN_EMAIL"
GEMINI_PRICING: '$PRICING'
EOF

COMMON=(
  --project "$PROJECT" --region "$REGION" --service-account "$SA"
  --set-cloudsql-instances "$PROJECT:$REGION:$SQL_INSTANCE"
  --env-vars-file "$ENV_FILE"
)
# Bucket GCS gắn vào STORAGE_DIR. Khi cập nhật thì gỡ volume cũ rồi gắn lại để không bị trùng.
VOLUME=(--add-volume "name=storage,type=cloud-storage,bucket=$BUCKET" --add-volume-mount "volume=storage,mount-path=/data/storage")
CLEAR=(--clear-volumes --clear-volume-mounts)
exists() { gcloud run "$1" describe "$2" --project "$PROJECT" --region "$REGION" >/dev/null 2>&1; }

echo "==> Cloud Run Job: worker sản xuất video (mỗi việc một lần chạy)"
JOB_ARGS=(
  --image "$REPO/backend:$TAG" --command node --args dist/job.js
  --cpu 4 --memory 8Gi --task-timeout 3600 --max-retries 0 --tasks 1
  --set-secrets "DATABASE_URL=emis-database-url:latest,APP_SECRET=emis-app-secret:latest"
  "${COMMON[@]}"
)
if exists jobs emis-video-worker; then
  gcloud run jobs update emis-video-worker "${JOB_ARGS[@]}" "${CLEAR[@]}" "${VOLUME[@]}"
else
  gcloud run jobs create emis-video-worker "${JOB_ARGS[@]}" "${VOLUME[@]}"
fi

echo "==> Cloud Run: API"
API_ARGS=(
  --image "$REPO/backend:$TAG" --command node --args dist/main.js
  --port 4100 --cpu 1 --memory 1Gi --min-instances 0 --max-instances 4 --timeout 300
  --execution-environment gen2 --allow-unauthenticated
  --set-secrets "DATABASE_URL=emis-database-url:latest,APP_SECRET=emis-app-secret:latest,ADMIN_PASSWORD=emis-admin-password:latest"
  "${COMMON[@]}"
)
if exists services emis-video-api; then API_ARGS+=("${CLEAR[@]}"); fi
gcloud run deploy emis-video-api "${API_ARGS[@]}" "${VOLUME[@]}"

echo "==> Cloud Run: web"
gcloud run deploy emis-video-web --image "$REPO/web:$TAG" --port 3100 --cpu 1 --memory 512Mi \
  --min-instances 0 --max-instances 4 --allow-unauthenticated \
  --project "$PROJECT" --region "$REGION" --service-account "$SA"

echo "Xong: $WEB_URL"
