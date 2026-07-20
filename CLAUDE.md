# GenAI 專案開發規範與系統概況

ASP.NET Core (.NET 9.0) 網頁專案。為 12A 專用的 GenAI 整合入口與部門應用目錄展示平台。

## 核心文件地圖（四份，職責不重疊）
| 文件 | 職責 |
|---|---|
| `CLAUDE.md`（本檔） | 開發規範、系統概況、目前待辦 — **開發行為的權威來源** |
| `memory.md` | 供模型快速載入的最精簡專案狀態快照 |
| `DB_Table.md` | DB Schema **唯一權威來源**；變更歷程只增不刪（遠端靠它增量升級） |
| `系統架構.md` | 模組清單與資料流向 |

## 當前專案架構與系統概況
- **免登入 Windows 自動驗證**：進站以 Negotiate 自動驗證（`/api/Auth/WhoAmI`），剝除網域前綴（`UMC\`）直接登入；401 自動重新驗證。本機除錯可於 `appsettings.Development.json` 設 `Auth:SimulatedWindowsAccount` 模擬任意帳號（設定熱重載，改完重整頁面即切換身分）。
- **自動開戶與人事連動**：`Auth:AutoProvisionWindowsAccounts=true`；帳號不存在時自動建立（user / `role_1`），並至 `[WEB].[dbo].[notes_person]` 以 `EMPNO` 比對補姓名/部門。
- **Cookie 權限即時同步**：`Program.cs` 的 `OnValidatePrincipal` 每請求比對 DB（`Accounts`）與 `AccountOverrides`，權限異動即時生效（⚠️ 查詢一律等值比對 EmpId，勿用 `.ToLower()` — CI 定序已不分大小寫，`LOWER()` 會使索引失效）。
- **單一 12A 版面**：固定 `12A` / `fab_12a` / `role_1`，無廠區/語言切換（固定繁中）。16 個主選單目錄（`m_df1`~`m_tf6`）對全體使用者開放瀏覽（`GetVisibleMenuIdsAsync`，含 ETag 快取）。
- **三種權限層級**（前後端閘門必須對齊，`MenuAuthService` ⇄ `sidebar.js getMenuPermissions`）：
  - **admin**：全功能，系統設定六項（看板網頁/選單配置/權限/帳號/操作紀錄/使用率統計）。
  - **委派管理員**：`Map_Account_ManageMenu` + `CanEditOthers`；可於委派目錄下增刪改子選單與網頁，也可建立頂層項目（以自己為建立者）；系統設定僅見「看板網頁管理」「選單配置管理」且清單只列可管理項目（頁面有委派範圍提示）。ACL 欄位僅 admin 有效（後端強制清空、前端開窗即隱藏）。
  - **純瀏覽者**（`window.isPureViewer()`）：可看所有選單與看板，隱藏系統設定與全部編輯功能；空狀態文案引導至意見箱。
- **統計與稽核**：`Stats/Ping` 心跳寫入 `SiteVisitorDailyStats`（身分只信 Cookie Claim，防偽冒）；`Summary/Daily/Monthly/Export` 鎖 `[Authorize(Roles="admin")]`；CSV 匯出經 `CsvField()`（RFC 4180 + 防公式注入）。活動紀錄走 Middleware → Channel Queue → HostedService 非同步落盤，另有每日清理。
- **前端術語規範**：使用者可見文案不用 UV/PV 等術語，一律「進站人數 / 瀏覽次數」；程式內部欄位仍為 uv/pv。
- **前端快取版本**：靜態 JS/CSS 以 `?v=YYYYMMDD` 做 cache-busting；**修改任一模組必須同步 bump 所有引用處的版本號且全站同一模組只能有一個版本 URL**（多版本並存會產生多個 module 實例）。

## C# 開發規範
1. **命名空間/分層**：`GenAI.*`；`Controllers/`（`*Controller`、`[Route("api/[controller]")]`）、`Services/`（`*Service`）、`Models/`（EF Entity）、`Data/`（`AppDbContext`）。
2. **命名**：類別/屬性/方法 PascalCase；私有欄位 `_camelCase`；區域變數/參數 camelCase。
3. **非同步**：DB 與 I/O 一律 `async/await`，方法以 `Async` 結尾；禁用 `.Result` / `.Wait()`。
4. **DI**：`Program.cs` 註冊（Scoped/Singleton），一律建構子注入。

## MSSQL 開發規範
1. **連線**：`Server=Sariel; Database=GenAI`（`ConnectionStrings__GenAI`）。**絕對禁止**連接或修改舊庫 `EQDashboardV2`。
2. **無 Migrations**：啟動時 `SchemaBootstrap.cs` 冪等補齊欄位/索引/種子；全新 DB 用 `DB_Table.md` 完整建置 SQL。
3. **命名**：主表單數/複合詞（`Accounts`, `Menus`）；PK 為 `Id`/`EmpId`/`MenuId`；多對多一律 `Map_` 前綴（`Map_Account_Role` 等）。
4. **同步規則**：任何 schema 變更**必須**同步更新 `DB_Table.md` 的「完整建置 SQL」**並**在「5. 架構變更歷程」附加增量 `ALTER/CREATE`（只增不刪，遠端靠歷程增量升級，嚴禁刪表重建）。

## 專案目錄結構
- `Program.cs` — 啟動組態（Serilog、Swagger、Cookie+Negotiate、OnValidatePrincipal、CSRF、Rate Limit、Production Guard、`/health/ready`）
- `Controllers/` — Auth, Accounts, Menus, Apps, Fabs, Roles, Settings, PersonalSettings, Stats, ActivityLogs
- `Services/` — Account, Auth, Menu, MenuAuth, Settings, IconStorage, SchemaBootstrap, ActivityLog*（Queue/Processor/Purge）, CacheInvalidation
- `Data/` / `Models/` — `AppDbContext` 與 Entities（對應 `DB_Table.md` 19 張表）
- `Middleware/` — ActivityLoggingMiddleware；`Helpers/` — ClientIpHelper
- `wwwroot/` — 靜態前端（`index.html`、`partials/modals.html`、`js/{main,api,auth,config,store}.js`、`js/admin/*`、`js/render/*`、`js/ui/*`、`css/*`）

## 目前待辦事項 (TODOs)
- [ ] **審核與流程去留確認**：一般使用者「需求申請」入口仍在 UI，「需求審核管理（`page-audit-audit`）」已隱藏；待確認改由委派直接管理或重構申請流程。
- [ ] **部門選單與網頁應用持續擴充**：依委派管理員反饋，於 `DF1`~`TF6` 下持續加入子選單與網頁項目。
- [ ] **高並發進站明細查詢效能監測**：`/api/Stats/Daily` 現回傳單月全量明細（前端 DataTables 分頁）；若單月超過約萬筆造成變慢，再評估 Server-side Paged 查詢。
- [ ] **UI/UX 殘留優化**（依效益排序）：(1) 主選單依廠區前綴分組排序（現況 DF/ET/LT/TF 交錯，源自 `Map_Role_Menu` 順序）；(2) 導覽列預設「固定」並將偏好存入 PersonalSettings；(3) 動畫節制（支援 `prefers-reduced-motion`、分頁不可見時暫停背景動畫）。
