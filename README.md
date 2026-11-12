# 生活亂入 · Nuxt 4

上傳自己的照片建立粗像素角色，再用生活照片延續世界。採用 Supabase 信箱／密碼登入、私人 Storage 與 PostgreSQL 存檔。每次生圖先保存候選；使用者確認後，以單一交易更新世界與歷史紀錄。支援重複確認、舊版本衝突檢查及重新整理後讀回候選。

## 開始

Node.js 24 LTS。`npm install`，將 `.env.example` 複製成 `.env` 並填寫設定（已有 .env 請勿覆蓋）。先照 [SUPABASE_SETUP.md](./SUPABASE_SETUP.md) 建立 Supabase 專案、執行資料表 migration、設定驗證信網址，再執行 `npm run dev`。

AI 金鑰僅放 `NUXT_AI_API_KEY`，不放 public 設定。Supabase 使用公開 publishable／anon key 與使用者登入 token，沒有使用 service_role。後端用 getUser 驗證登入，資料表與私人檔案由 RLS 隔離。生成使用 gpt-image-2.5-sunburst，每次皆付費、沒有自動重試。正式環境生成仍停用。

## 資料與程式

- `pages/index.vue`：登入、建立角色、生活照片、確認存檔與歷史對照。
- `composables/useCloud.ts`：瀏覽器 Supabase 登入狀態。
- `server/utils/cloud.ts`：伺服器驗證登入與使用者範圍的 Supabase client。
- `server/api/generate.post.ts`：驗證額度、取得角色和世界參考、呼叫 AI、存入私人候選圖。
- `supabase/migrations/202611100001_world.sql`：worlds / generations / entries、私人 bucket、RLS 及交易函式。
- `utils/avatar-storage.ts`：原有瀏覽器角色儲存，保留既有資料，新雲端流程不再使用。

照片與圖片存於 Storage，資料庫只存路徑與紀錄。最新世界及最近七筆文字提供生成上下文；舊紀錄持續保留、每頁讀取 20 筆。此版沒有長期摘要或像素元素資料表。

## 驗證

- `npm run typecheck`
- `npm test`：在本機 PostgreSQL（PGlite）測試 migration、帳號隔離、候選不更新世界、確認交易與重試、版本衝突及每日額度；不呼叫付費 AI。
- `npm run build`

本機測試不等於 Supabase 真實服務的端到端驗證。需完成專案設定後再驗證註冊信、Storage 上傳及跨裝置紀錄。詳見設定文件的現階段限制。

## 安全設定

已加入提交前金鑰掃描、私人素材排除、GitHub CI、受限上傳與安全標頭。上傳 GitHub 前請讀 [SECURITY.md](./SECURITY.md)。OpenAI key 僅從後端執行時環境讀取，避免打包進 Nuxt runtimeConfig。

## 工作日誌

開發進度、驗證結果與待辦事項見 [WORK_LOG.md](./WORK_LOG.md)。
