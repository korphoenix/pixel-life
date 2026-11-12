# 接上 Supabase：第一次設定

程式已加入雲端功能，實際使用前請完成以下設定。不要把 OpenAI 金鑰、資料庫密碼或 Supabase secret / service_role 金鑰貼到聊天或前端。

## 1. 建立專案

前往 https://supabase.com/dashboard ，登入後選 New project。選擇自己的組織、專案名稱（例如 life-pixel）與合適方案，設定資料庫密碼。等待專案建立完成。

## 2. 建立資料表與私人儲存空間

開啟專案的 SQL Editor → New query，將 `supabase/migrations/202611100001_world.sql` 全部貼入並執行一次，再執行 `supabase/migrations/202611100002_security.sql`。這是針對全新專案的 migration；已執行成功後不要重複執行。

建立內容：

- worlds：自己目前的角色、世界圖及版本。
- generations：生成狀態、候選圖、文字及 API 回報用量。
- entries：已確認的生活紀錄，每筆都連回原始照片與當時的世界圖。
- life-pixel 私人 Storage bucket，照片只允許自己的登入帳號讀取。
- 私人資料權限與交易函式，防止舊版本覆蓋、重複確認與超過每日生成次數。

不要將 bucket 改成 Public。SQL 執行失敗時請保留錯誤文字，先處理錯誤再繼續。

## 3. 填入兩個連線值

從專案 Connect 對話框或 Settings 裡的 API 設定取得 Project URL 與 publishable key。若專案提供舊版 anon key，也可以使用。

在專案 `.env` 內填入這兩個欄位，保留原本的 OpenAI 金鑰不變：

```dotenv
NUXT_PUBLIC_SUPABASE_URL=https://你的專案.supabase.co
NUXT_PUBLIC_SUPABASE_ANON_KEY=你的publishable或anon公開金鑰
```

這個欄位名稱雖然叫 ANON_KEY，也接受新的 publishable key。不要填 secret 或 service_role。

## 4. 設定信箱與密碼註冊（不寄驗證信）

在 Authentication → URL Configuration 設定：

- 本機 Site URL：`http://127.0.0.1:3000`
- Redirect URLs 加入 `http://127.0.0.1:3000` 與 `http://localhost:3000`。

在 Authentication 的 Email provider 設定中，保持 Email 登入啟用，關閉 Confirm email 並儲存。此版本使用信箱＋密碼註冊，成功後直接取得登入狀態，不需要點驗證信。介面位置可能隨 Supabase 更新而不同。

只能檢查信箱格式，無法確認信箱存在或屬於本人。請填寫自己的常用信箱，以便未來使用密碼重設。上述 Site URL／Redirect URLs 可保留供後續帳號流程使用。

## 5. 重啟並測試

重新啟動 `npm run dev -- --host 127.0.0.1 --port 3000`，開啟 http://127.0.0.1:3000 。

1. 使用信箱與密碼註冊，確認可直接登入。
2. 上傳自己的照片，生成角色；點確認後建立世界版本 1。
3. 上傳生活照片、填日期和文字，生成候選圖。
4. 候選圖尚未確認時重新整理：應可讀回候選圖，不必重畫。
5. 點確認後，世界版本增加，下方出現原照與像素圖對照。
6. 登出再登入，或在另一個裝置登入相同帳號，檢查已確認的紀錄。
7. 另一個帳號應看不到你的照片與世界。

生成會呼叫付費 AI；登入、看紀錄與再次確認存檔不會呼叫生圖。生活圖每天最多 3 次、角色 5 次，UTC 午夜重置；失敗與逾時也計入次數，避免連續重試造成支出。原始照片上限 5 MB，雲端圖片上限 10 MB。

## 現階段限制

- 尚未實際連上你的 Supabase 專案；需要以上設定完成後做雲端端到端驗證。
- 原本 IndexedDB 的本機角色仍保留，但不會自動上傳或同步到帳號；雲端首次登入需建立角色。
- 圖片透過一小時有效的私人連結顯示，久置後可按「重新載入雲端」。
- 世界延續參考最新確認圖、角色與最近七筆文字，較早的回憶保留在歷史紀錄，但尚未做長期記憶摘要或單獨元素管理。
- 未採用的候選圖及失敗時已上傳的部分檔案暫時保留，尚未實作清理、刪除帳號及資料匯出介面；正式公開前需補上。
- usage 是模型回報資訊，前端顯示不是正式帳單；請以 OpenAI 帳務頁為準。
- 正式環境生圖仍停用。部署前需完成內容檢查、背景工作/逾時處理與雲端驗證。Vercel 部署時也要設定同名環境變數與正式驗證信網址。

官方參考：https://supabase.com/docs/guides/storage/security/access-control 與 https://supabase.com/docs/reference/javascript/auth-getuser 。

## 上線安全設定

請先讀 SECURITY.md。依目前需求關閉 Confirm email，並為公開註冊配置 CAPTCHA 與 Auth rate limits、啟用管理員 MFA，並確認 Storage bucket 私人。若曾執行舊版 SQL，請補執行 `202611100002_security.sql`；不要重複執行初始建表檔。
