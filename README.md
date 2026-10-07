# 鬍子泳隊｜隊史紀錄資料庫 v2

## 已完成
- 公開隊史查詢
- 長池 / 短池
- 隊員資料與個人 PB
- 隊史保持人
- 教練登入（Supabase Auth）
- 教練新增成績
- 新成績自動寫入 PB 歷史
- 自動判斷是否刷新隊史
- RLS 權限：一般訪客只讀；coach/admin 才能修改
- 手機響應式介面
- 初始資料來自提供的三份 Excel
- 姓名已統一「潘沅駿」

## 啟用正式雲端版
1. 建立 Supabase 專案。
2. 在 SQL Editor 執行 `supabase_schema.sql`。
3. 在 Authentication > Users 建立教練帳號。
4. 將該 User UUID 寫入 `profiles`：
   `insert into public.profiles(id, display_name, role) values ('USER_UUID','教練','admin');`
5. 把 Supabase Project URL 與 anon key 填入 `config.js`。
6. 將 `index.html`、`config.js` 部署到任何靜態網站主機（例如 Vercel / Netlify / GitHub Pages）。

## 注意
目前套件內嵌 Excel 初始資料，尚未自動把這些資料寫入你的 Supabase 專案；需要在你的 Supabase 專案執行一次資料匯入。這樣做是刻意的，避免把你的資料偷偷送到未知的雲端。
