# GenAI 專案狀態快照 (memory)

> 最精簡的專案現況，供模型快速載入。詳細規範見 `CLAUDE.md`；DB schema 權威見 `DB_Table.md`；模組與資料流見 `系統架構.md`。

## 專案定位
ASP.NET Core (.NET 9.0) + 純靜態前端（原生 JS 模組）。12A 專用 GenAI 整合入口與部門應用目錄平台。DB：`Sariel/GenAI`（19 張表，無 EF Migrations，啟動由 SchemaBootstrap 冪等補齊）。

## 核心機制（一行版）
- **登入**：Windows Negotiate 自動登入（`/api/Auth/WhoAmI`）→ 自動開戶（user/`role_1`）→ notes_person 補姓名部門；本機以 `Auth:SimulatedWindowsAccount` 模擬（熱重載）。
- **權限**：Cookie + `OnValidatePrincipal` 每請求同步 DB；三層級 = admin / 委派管理員（`Map_Account_ManageMenu`+`CanEditOthers`）/ 純瀏覽者（`isPureViewer()`，只能看）。
- **選單**：單一 12A 版面，16 個主目錄 `m_df1`~`m_tf6` 全員可見；委派者僅能管理委派子樹（前後端閘門對齊：`MenuAuthService` ⇄ `sidebar.js`）。
- **統計**：`Stats/Ping`（身分只信 Claim）→ `SiteVisitorDailyStats`；查詢/匯出 API 鎖 admin；文案一律「進站人數/瀏覽次數」不用 UV/PV。
- **稽核**：Middleware → Queue → HostedService 寫 `UserActivityLogs`，每日自動清理。

## 鐵律
- 禁連舊庫 `EQDashboardV2`；DB 變更必同步 `DB_Table.md`（完整 SQL + 增量歷程，只增不刪）。
- EmpId 查詢等值比對即可，勿用 `.ToLower()`（CI 定序，LOWER 毀索引）。
- 改前端 JS/CSS 必 bump `?v=` 版本且全站同模組單一版本 URL。
- 非同步方法 `Async` 結尾、禁 `.Result`/`.Wait()`；多對多表 `Map_` 前綴。

## 目前待辦
1. 需求申請/審核流程去留確認（審核頁已隱藏）。
2. 部門選單（DF1~TF6）內容持續擴充。
3. Stats Daily 明細若單月破萬筆再評估 server-side paging。
4. UI/UX 殘留：主選單依前綴分組排序、導覽列預設固定+記憶偏好、動畫節制（reduced-motion / 背景動畫暫停）。
