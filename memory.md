# GenAI 專案記憶與核心規範 (Memory)

本檔案與 `CLAUDE.md` 同步維護，記載 GenAI 專案目前的架構概況、核心設計決策以及 C# / MSSQL 開發與命名規範。

---

## 1. 當前專案架構與定位概況
- **專案定位**：ASP.NET Core (.NET 9.0) 網頁系統，為 12A 專用的 GenAI 應用整合與部門網頁目錄入口。
- **免登入與 Windows 認證 (`/api/Auth/WhoAmI`)**：進站自動以 Windows Negotiate 認證並剝除網域前綴 (`UMC\`)；API 遇到 401 會自動重新驗證身分而不需要手動登入/登出。
- **本機除錯模擬 (`SimulatedWindowsAccount`)**：於 `appsettings.Development.json` 設定 `Auth:SimulatedWindowsAccount`（如 `UMC\00058897` 或 `UMC\user`），可隨時於本地 F5 重整測試不同帳號與委派管理權限。
- **自動開戶與人事資料連動 (`AutoProvisionWindowsAccounts=true`)**：系統偵測到未註冊工號時，自動開立帳號並指派預設群組 (`role_1`)。且於新增、載入 (`FindAccountAsync`) 或查詢 (`LookupPerson`) 帳號時，自動至 `[WEB].[dbo].[notes_person]` 比對 `EMPNO`，自動將 `DEPTNAME` (部門) 與 `NAME` (姓名) 填入。
- **Cookie 權限即時雙向驗證 (`OnValidatePrincipal`)**：於 `Program.cs` 註冊 Cookie 驗證事件，每次 HTTP 請求隨時檢查 `Accounts` 資料表與 `AccountOverrides` 設定，若權限異動即時刷新 `ClaimsPrincipal` 並更新 Cookie。
- **單一 12A 廠區與主選單全開放**：系統版面固定為 `12A` (`role_1`)，UI 移除語言/廠區切換。主選單預設 `m_df1`~`m_tf6` (16 個資料夾) 對全體有效帳號開放瀏覽 (`GetVisibleMenuIdsAsync`)。
- **純瀏覽者 (`isPureViewer()`) 與委派管理**：
  - **純瀏覽者**：非管理員且無委派選單權限者。可瀏覽全系統網頁項目與看板，但自動隱藏系統設定與編輯/新增/刪除操作按鈕。
  - **委派管理員**：由 admin 指定特定管理選單範圍 (`Map_Account_ManageMenu`) 與允許修改他人內容 (`CanEditOthers`) 後，可自主於授權目錄下建立與維護子選單或獨立網頁。

---

## 2. C# 開發規範與命名原則
- **命名空間**：一律採用 `GenAI.*`（包含 `GenAI.Controllers`、`GenAI.Services`、`GenAI.Models`、`GenAI.Data`）。
- **目錄與職責分層**：
  - `Controllers/`：Web API 介面，類別命名結尾為 `Controller` (如 `AccountsController`, `StatsController`)，路由採用 `[Route("api/[controller]")]`。
  - `Services/`：商業邏輯，命名結尾為 `Service` (如 `AccountService`, `MenuAuthService`)。其中 `SchemaBootstrap.cs` 負責啟動時 DB 檢查。
  - `Models/` 與 `Data/`：EF Core 資料實體 (`Entities`) 與資料庫上下文 `AppDbContext`。
- **命名原則**：
  - 類別、介面、屬性、非同步方法一律使用 **PascalCase** (`EmpId`, `FindAccountAsync`)。
  - 非同步 I/O 與 DB 操作方法一律採用 `async/await`，且方法命名**必須以 `Async` 結尾**。
  - 私有欄位 (Private Fields) 採用底線開頭搭配 **camelCase** (`_dbContext`, `_accountService`)。
- **DI 註冊**：一律於 `Program.cs` 註冊為 `Scoped` 或 `Singleton`，採用建構子注入。

---

## 3. MSSQL 資料庫開發規範與命名原則
- **資料庫伺服器與連線**：連線字串鍵值 `ConnectionStrings:GenAI`，目標為 **Server=Sariel, Database=GenAI**（切勿連接舊有 `EQDashboardV2` 庫）。
- **禁走 Migrations (`SchemaBootstrap` 模式)**：
  - **嚴禁使用 EF Core Migrations (`dotnet ef migrations`)**。
  - 系統每次啟動由 `SchemaBootstrap.cs` (`CheckAndBootstrapDatabaseAsync`) 自動檢查，若缺少資料表、長度或索引則動態補足與初始化種子資料。
- **資料表與外鍵關聯命名**：
  - 實體主表：單數名詞或複合詞 (`Accounts`, `MenuConfig`, `Fab`, `Role`)。
  - 主鍵 (PK)：一般命名為 `Id` 或實體代識 (`EmpId`, `MenuId`)。
  - **多對多關聯對照表 (Mapping Tables)**：一律以 **`Map_`** 為前綴命名，接關聯實體單數詞（例如 `Map_Account_Role`、`Map_Account_ManageMenu`、`Map_Account_DefaultPage`、`Map_Fab_Role`、`Map_Role_Menu`）。
- **Schema 文件權威與同步更新**：
  - **`DB_Table.md` 為資料庫結構定義唯一標準**。
  - 修改資料表或欄位時，必須同時修改 `DB_Table.md` 中的「完整建置 SQL」區塊以及文件尾端的「5. 架構變更歷程」附加 SQL `ALTER/CREATE` 腳本。

---

## 4. 目前待辦事項與後續規劃 (TODOs)
- [ ] **審核流程定位確認**：目前一般使用者的「需求申請」功能在 UI 仍保留，但審核管理頁面 `page-audit-manage` 已隱藏。需確認後續專案流程是否完全改走委派授權管理，或要重構此申請與審核機制。
- [ ] **部門選單應用充實**：依各部門特殊管理員之操作需求，持續在 `DF1`~`TF6` 等 16 項目錄下建立子選單與網頁應用集合。
- [ ] **DataTables 效能監測與優化**：針對「網站使用率與流量統計」下的「進站同仁詳細紀錄 (`dtStatsDetail`)」，目前為純前端載入全月資料後使用 DataTables 過濾分頁；若未來進站資料頻度極高（大於萬筆），評估改用 Server-side Paging。

---

## 5. 架構修改與對齊歷史 (Modification History)
- **2026-07-18 (DB Schema 對齊與增量 SQL)**：
  - **檢查結果**：經由 SQL 查詢與 Code/Model 交叉驗證，發現遠端 Sariel 伺服器已建立並運行 `SiteVisitorDailyStats` 表（共 19 張表），但先前的 `DB_Table.md` SQL 檔僅記錄了 18 張表，遺漏 `SiteVisitorDailyStats` 及索引 `IX_SiteVisitorDailyStats_EmpId`。
  - **增量更新 (`DB_Table.md`)**：依據冪等不破壞既有資料規則，在 `DB_Table.md` 末端的「5. 架構變更歷程（增量 ALTER）」加入了 `[2026-07-18]` 專屬的 `CREATE TABLE dbo.SiteVisitorDailyStats` (附 `IF OBJECT_ID IS NULL`) 與非叢集索引建立 SQL 腳本；並同步將完整 SQL 區塊及表格一覽總數自 18 張升級至 19 張。
