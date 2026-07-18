# GenAI 專案開發規範與系統概況

ASP.NET Core (.NET 9.0) 網頁專案。為 12A 專用的 GenAI 整合入口與部門應用目錄展示平台。

## 當前專案架構與系統概況
- **免登入與 Windows 自動驗證**：進站以 Windows Negotiate 自動驗證 (`/api/Auth/WhoAmI`)，自動剝除網域前綴 (`UMC\`) 並直接登入；遇到 401 自動重新驗證。若為本機除錯可於 `appsettings.Development.json` 透過 `Auth:SimulatedWindowsAccount` 模擬不同桌機帳號登入。
- **自動開戶與人事資料連動**：`Auth:AutoProvisionWindowsAccounts=true`。當 Windows 登入帳號不在 `Accounts` 表時，自動建立 user 帳號並預設指派 `role_1`。建立或載入帳號 (`FindAccountAsync` / `LookupPerson`) 時，會自動至 `[WEB].[dbo].[notes_person]` 比對 `EMPNO` 寫入姓名與部門。
- **Cookie 權限即時雙向同步**：`Program.cs` 註冊 `OnValidatePrincipal`，每次請求自動檢查 DB (`Accounts`) 與設定 (`AccountOverrides`)，及時刷新與驗證 Cookie 權限。
- **單一 12A 版面與主選單架構**：專案固定為單一系統版面 (`12A` / `fab_12a` / `role_1`)，已移除 UI 廠區/語言切換（固定繁中）。預設已建 16 個主選單目錄（`m_df1`~`m_tf6`），開放全體使用者瀏覽全系統主選單與看板 (`GetVisibleMenuIdsAsync`)。
- **純瀏覽者與委派管理機制**：
  - **純瀏覽者**：`window.isPureViewer()` = 非 admin 且無委派權限。可觀看所有選單與看板，但隱藏右上角系統設定與編輯/新增/刪除功能。
  - **委派管理**：特定使用者被授予「委派管理選單 (`Map_Account_ManageMenu`)」與「允許變更他人內容 (`CanEditOthers`)」權限後，可在自己負責的選單目錄下新增、編輯、刪除子選單與網頁項目，無需透過 admin 介入。

---

## C# 開發規範與命名原則
1. **命名空間與目錄分層**：專案命名空間統一為 `GenAI.*`。遵循清晰的 Layered Architecture：
   - `Controllers/` — Web API 控制器，類別結尾為 `Controller` (如 `AccountsController`)，路由採用 `[Route("api/[controller]")]`。
   - `Services/` — 商業邏輯層，類別結尾為 `Service` (如 `AccountService`)；`SchemaBootstrap.cs` 負責啟動時資料庫自我檢查與建表。
   - `Models/` — EF Core Entity 模型，直接對應資料表名稱。
   - `Data/` — EF Core 資料庫上下文 `AppDbContext` 及組態。
2. **方法與變數命名 (PascalCase / camelCase)**：
   - 類別、介面、屬性、方法一律採用 **PascalCase** (`EmpId`, `GetAccountsPagedAsync`)。
   - 私有成員變數一律以底線開頭搭配 **camelCase** (`_dbContext`, `_accountService`, `_logger`)。
   - 區域變數與方法參數採用 **camelCase** (`account`, `manageableMenus`)。
3. **非同步開發原則 (Async/Await)**：
   - 所有資料庫操作 (`EF Core`) 及 I/O 呼叫皆需使用 `async/await`，且方法名稱一律以 `Async` 結尾 (`FindAccountAsync`)。
   - 避免在非同步方法中使用 `.Result` 或 `.Wait()`，造成 Thread Starvation 或 Deadlock。
4. **相依性注入 (DI)**：
   - 服務一律在 `Program.cs` 透過 `builder.Services.AddScoped<T>()` (與 request 生命週期綁定) 或 `AddSingleton<T>()` 註冊。
   - 一律採用建構子注入 (Constructor Injection)。

---

## MSSQL 資料庫開發規範與命名原則
1. **資料庫與伺服器連線**：
   - 連線目標：`Server=Sariel`，資料庫：`Database=GenAI`（環境變數：`ConnectionStrings__GenAI`）。絕對禁止連接或修改舊有資料庫 `EQDashboardV2`。
2. **無 Migrations 與 SchemaBootstrap 原則**：
   - 本專案 **不使用 EF Core Migrations (`dotnet ef migrations`)**。
   - 程式啟動時由 `SchemaBootstrap.cs` (`CheckAndBootstrapDatabaseAsync`) 動態檢查並補齊缺失的表結構、欄位長度與索引。
3. **資料表與外鍵命名原則**：
   - 實體主表以單數名詞或清晰複合詞命名 (如 `Accounts`, `MenuConfig`, `Fab`, `Role`)。
   - 主鍵 (PK) 命名為主表 ID 或特定實體標識 (如 `Id`, `EmpId`, `MenuId`)。
   - **多對多外鍵對照表 (Mapping Tables)**：一律以 **`Map_`** 為前綴命名，並以單數詞串接關聯實體（例如 `Map_Account_Role`、`Map_Account_ManageMenu`、`Map_Account_DefaultPage`、`Map_Fab_Role`、`Map_Role_Menu`）。
4. **文件權威來源 (`DB_Table.md`) 與同步規則**：
   - `DB_Table.md` 是資料庫 Schema 的唯一權威來源。
   - 任何資料表結構、欄位增刪修改，**必須同步修改 `DB_Table.md` 中的「完整建置 SQL」與文件末端的「5. 架構變更歷程」**（附加增量 `ALTER/CREATE` 指令），以便遠端部署重建時完全吻合。

---

## 專案目錄結構
- `Program.cs` — 啟動組態（Serilog、Swagger、Cookie Auth、OnValidatePrincipal、`/health/ready`）
- `Controllers/` — AuthController, AccountsController, MenusController, StatsController...
- `Services/` — AccountService, MenuAuthService, SchemaBootstrap...
- `Data/` / `Models/` — AppDbContext 與 Entity Entities
- `wwwroot/` — 純靜態前端入口與 JavaScript 渲染模組 (`index.html`, `js/admin/*`, `js/render/*`, `css/*`)

---

## 目前待辦事項 (TODOs)
- [ ] **審核與流程去留確認**：目前一般使用者的「需求申請」入口仍保留於 UI，但「需求審核管理 (`page-audit-audit`)」已隱藏；待確認業務情境是否完全改由委派直接管理，或將申請流程重構整合。
- [ ] **部門選單與網頁應用持續擴充**：依各部門委派管理員的實際操作反饋，持續優化並在主選單 (`DF1`~`TF6`) 下加入子選單與網頁項目連結。
- [ ] **高並發進站明細查詢效能監測**：目前網站使用率統計的「進站同仁詳細紀錄 (`dtStatsDetail`)」採用 DataTables 純前端分頁與搜尋。若日後歷史單月進站訪客紀錄龐大（如大於萬筆），可評估將 API 改為 Server-side Paged DataTable 查詢。

---

## 修改與架構對齊歷史 (Modification History)
- **2026-07-18 (DB Schema 對齊與增量 SQL 升級)**：
  - **檢查與比對結果**：經連線遠端伺服器 `Sariel/GenAI` 查詢及 C# `AppDbContext`/`SchemaBootstrap` 程式交叉驗證，確認真實 DB 已運行 19 張資料表（新增 `SiteVisitorDailyStats` 表與索引 `IX_SiteVisitorDailyStats_EmpId`），而先前的 `DB_Table.md` SQL 僅有 18 張表。
  - **冪等增量升級 (`DB_Table.md`)**：依據「嚴禁刪表重建、僅採冪等增量修改」的維護規則，於 `DB_Table.md` 結尾的「5. 架構變更歷程（增量 ALTER）」加入了日期 `[2026-07-18]` 專屬的增量 SQL (`IF OBJECT_ID IS NULL CREATE TABLE ...` 與 `CREATE NONCLUSTERED INDEX ...`)，方便遠端主機依序執行；並同步將「完整建置 SQL」與「資料表一覽」總數由 18 張表升級為 19 張。
