# 安全狀態與上傳 GitHub 前檢查

檢查日期：2026-11-10。這是程式碼層級的安全加固與測試紀錄，不是完整滲透測試，也不代表所有風險已排除。

## 已實作

- 升級至 Nuxt 4.6.4，對齊 Vue Router 5；保留原始專案目錄結構。修補 Nuxt 開發伺服器私密 runtimeConfig 外洩等官方已知漏洞。
- OpenAI key 僅在 server API 執行時讀取，不放 public 或 private runtimeConfig。`.env` 檔案權限設成僅擁有者可讀寫；沒有印出金鑰。
- Nuxt 啟動前檢查 public Supabase key，若誤填 sb_secret / service_role 則阻止啟動。
- `.gitignore`、`.vercelignore` 與 `.dockerignore` 排除憑證、環境檔、私人素材、資料庫與生成產物。原先兩張示範圖片移至 `private-assets/`，不再公開提供或作為 AI 參考。
- AI 生圖需要有效的信箱／密碼帳號登入（不要求信箱所有權驗證）；後端呼叫 Supabase getUser，資料庫只依 auth.uid 判斷所有權。
- worlds / entries / generations 啟用 RLS、撤銷直接寫入權限。交易函式固定 search_path、驗證所有權，明確撤銷 public / anon / authenticated 預設權限後，只開放必要函式給 authenticated。
- 私人 Storage 只能讀自己圖片；上傳必須對應自己已預約、仍在 reserved 狀態的生成紀錄與固定檔名。不開放覆寫或刪除。
- 圖片大小、簽章、日期、文字與版本驗證；multipart 串流上限 6 MB，照片本體最多 5 MB。拒絕重複及未知欄位；上傳讀取超過 30 秒會取消。
- 每位使用者每日生成額度、確認交易鎖定世界版本、防止舊版本覆寫；重複確認不會再產生紀錄或 AI 請求。
- API 禁止跨網站請求並設定 no-store。加入 nosniff、禁嵌入框架、禁止 referrer、相機／麥克風／定位等權限限制。正式環境另加 HSTS 與基礎 CSP，client/server sourcemap 與 devtools 關閉。
- 開發伺服器預設只綁 127.0.0.1，限制 Vite 讀取憑證、私人素材及後端／開發伺服器產物。
- 提交前掃描讀取 Git 暫存區的實際內容，偵測常見秘密與本機已知金鑰；不將匹配的內容印出。GitHub CI 執行掃描、型別、測試、建置及 npm audit，權限只有 contents:read；Dependabot 每週檢查。
- 正式環境付費生圖仍停用，避免尚未驗證的公開服務產生費用。

## Git 操作

本機 pre-commit hook 使用 `.githooks/pre-commit`。新 clone 的 Git 不會自動啟用 hooks，請執行：

```sh
npm run security:install
npm run security:check
```

不要使用 `git add -f .env`，不要使用 `git commit --no-verify` 略過檢查。檢查器可被刻意繞過，也無法識別所有秘密；GitHub push protection 及審查仍需要啟用。

若密鑰曾經貼到公開處或 push 過，刪除檔案或加 .gitignore 不會撤銷已外洩的金鑰：必須在供應商後台撤銷並重新建立，必要時清理 Git 歷史。目前尚未設定 GitHub remote，也沒有進行 push；不能據此證明其他位置從未外洩。

## 套件掃描結果

本次 `npm audit`：0 critical、0 high、0 moderate、7 low。七項 low 來自同一個 deepmerge 4.3.1 原型污染公告及其依賴鏈；上游當時未提供已修補的 4.x 版本。沒有為了清空掃描結果而降級到已知有其他漏洞的舊框架。

- Nuxt 官方公告：https://github.com/nuxt/nuxt/security/advisories/GHSA-648h-gw55-m2g7
- deepmerge：https://github.com/advisories/GHSA-gcqx-w48m-w2h4
- glob 固定修補版 14.0.4、minimatch 固定修補版 11.0.5（package overrides）；已以型別、測試及建置驗證。依賴掃描結果會隨公告更新。

## 尚需實際環境完成

- Supabase 專案尚未設定。請執行兩份 SQL migration 後，驗證真實 Auth / Storage / RLS；本機模擬 PostgreSQL 測試不能取代雲端驗證。
- Supabase 管理員與 GitHub 管理員 MFA、Auth rate limits、公開註冊 CAPTCHA、正式郵件服務、備份與復原，以及 GitHub secret scanning / push protection / 分支保護，需在各服務後台配置；目前沒有替你更改這些帳號設定。
- 目前僅有每使用者額度，還需平台層級的全站支出上限、分散式速率限制與濫用監控；不能只靠每帳號額度阻擋大量註冊。正式生圖保持停用。
- CSP 為相容 Nuxt SSR bootstrap 仍允許 inline script/style；若要更嚴格防 XSS，需完成 nonce/hash 型 CSP 並測試部署。前端內容使用 Vue escaping，未使用 v-html。
- 尚未接入正式內容審查、病毒／惡意檔案掃描、圖片重新編碼去除 EXIF、背景任務、完整刪除／保留期限介面、備份恢復演練或第三方滲透測試。
- session 由 Supabase SDK 存於瀏覽器；需要持續防 XSS。私人圖片的簽名連結一小時有效，取得連結的人在有效期內也能看，勿公開分享。
- 本機安全掃描只能檢查此專案，不能保證你其他資料夾、既有 GitHub repository、帳號或裝置已安全。

## 本次驗證紀錄

- 型別檢查、正式建置與 4 組安全／資料庫測試通過。
- GET `/`：200；`/.env`：404；私人示範圖：404。
- Vite 直接讀取環境檔：403；已知開發伺服器 bundle 路徑未提供內容。
- 跨網站 API POST：403，帶 no-store。
- 檢查 280 個當時的建置／快取檔案，沒有匹配本機目前的 OpenAI 金鑰（檢查過程不輸出值）。
- `.env` 權限 0600。Git check-ignore 確認環境檔與兩張私人圖片會被忽略。
- 本機 Git 已初始化為 main，提交前 hook 已啟用。未建立 commit、未設定 remote、未 push。

## 註冊需求更新

依使用者要求，改為信箱＋密碼註冊後直接登入；Supabase 需關閉 Confirm email。後端仍以 getUser 驗證登入並阻擋匿名帳號，不再要求 email_confirmed_at。信箱格式檢查無法確認地址存在或所有權；未驗證信箱增加冒用與大量註冊風險，公開上線前仍須配置防濫用限制。此設定尚未在 Supabase 後台套用。
