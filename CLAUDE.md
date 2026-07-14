# GenAI

ASP.NET Core (net9.0) 網頁專案。前身為 EQDashboard.V2.Web（2026-07-14 自其他目錄複製後改名），改造為 12A 專用的 GenAI 入口網頁（減量使用原框架，操作功能不變）。

## 2026-07-14 減量改造（重要設計決策）
- **免登入頁**：進站即以 Windows Negotiate 自動偵測（`/api/Auth/WhoAmI`），工號剝除任意網域前綴（`UMC\00058897`→`00058897`、`SARIEL\yu-tinglin`→`yu-tinglin`）。登入 overlay 僅在 Windows 驗證完全失敗時作為 fallback。
- **人人可瀏覽**：`Auth:AutoProvisionWindowsAccounts=true` — 工號不在 Accounts 表時自動建立 user 帳號並指派 `Auth:DefaultRoleIds`（目前 `role_1`）。
- **權限卡控**：`Auth:AccountOverrides` 每次登入強制套用指定工號的 RoleLevel/CanEditOthers（目前卡 `yu-tinglin` = admin；要測 user+委派就改 RoleLevel=user、CanEditOthers=true）。
- **廠區固定 12A**：DB 仍保留 Fabs/Map_Fab_Role 架構（僅一筆 `fab_12a`/`12A`），但前端已移除廠區切換與語言切換 UI（index.html navbar）、`appState.currentFab` 固定 `'12A'`、語言固定繁中；系統設定選單已隱藏「廠區管理」頁（頁面與 JS 保留未刪）。
- **選單可見性鏈**（連 admin 也適用）：Fab(12A) ↔ Map_Fab_Role ↔ Role ↔ Map_Role_Menu ↔ Menu；使用者需經 Map_Account_Role 擁有該 Role 才看得到選單。新選單要顯示必須掛進 `role_1` 的允許清單（權限管理頁拖曳即可）。
- **主選單**：已種 16 個 folder 目錄 m_df1~m_tf6（DF1-4, ET1-4, LT3-4, TF1-6），子選單由管理者於 UI 自行新增。
- **委派管理**：帳號管理 → 編輯 → 啟用委派管理（需先勾可視群組）→ 勾選管理目錄（Map_Account_ManageMenu），維持原框架功能。
- 右上角顯示登入者工號（`renderUserDropdown` 寫入 `#user-name`）。注意：`renderHomeDashboard` 原由 `changeLanguage()` 兼職觸發，語言固定後改由 `initDashboardUI`（main.js）直接呼叫。
- **已移除的 UI（頁面/JS 保留、僅入口隱藏）**：系統/自訂版面切換（navbar toggle，固定 system 模式）、個人頁面管理、申請審核管理（page-audit-manage）、資料庫與同步（page-config-manage，Excel 匯入/匯出）、權限群組頁的「新增群組」按鈕（僅維護單一 role_1）。⚠️ 一般 user 的「需求申請」入口仍在，但審核頁已隱藏 — 若不需要申請流程可一併移除。
- **可視群組版面自動化**：帳號編輯 modal 的「可視群組版面」區塊隱藏（modals.html），`renderAccRoleCheckboxes` 一律自動勾選全部群組（僅 role_1）→ 儲存時自動指派；「登入預設首頁」照常可指定。既有帳號已 SQL 回填 role_1。
- **純瀏覽者模式**：`window.isPureViewer()`（sidebar.js）= 非 admin && !canEditOthers && 無 manageableMenus。純瀏覽者：看得到所有選單頁面、`#btn-system-settings` 完全隱藏（renderSidebarMenus 內控制）、應用集合（renderAppGrid, tables.js）不顯示 編輯/X/新增 APP 只能點選開啟。自動開帳號的新使用者即為純瀏覽者。

## 專案結構
- `GenAI.sln` / `GenAI.csproj` — 方案與專案檔（原 EQDashboard.V2.Web.*，namespace 已全面改為 `GenAI.*`）
- `Program.cs` — 啟動設定（Serilog、Swagger、Cookie 認證、Windows Negotiate、健康檢查 `/health/ready`）
- `Controllers/` — Web API controllers（Auth、Accounts、Menus、Roles、Fabs、Requests、Apps、Settings、ActivityLogs…）
- `Services/` — 商業邏輯；`SchemaBootstrap.cs` 啟動時補 DB 欄位/索引/種子帳號（**不建全新資料表**）
- `Data/` — EF Core `AppDbContext` 與 `Configurations/`（無 Migrations）
- `Models/` — Entity 模型
- `wwwroot/` — 純靜態前端（index.html + JS）
- `scratch/` — Puppeteer UI 測試腳本

## 資料庫
- **Server=Sariel、Database=GenAI**（同 server 上另有舊庫 EQDashboardV2，勿再使用）
- 連線字串 key：`ConnectionStrings:GenAI`（Production 用環境變數 `ConnectionStrings__GenAI`）
- Schema 文件：**DB_Table.md** — 修改 DB 架構時必須同步更新該文件
- 無 EF Migrations；全新 DB 需手動建表（見 DB_Table.md 說明）

## 常用指令
- 建置：`dotnet build GenAI.csproj`
- 執行：`dotnet run --project GenAI.csproj`（Development，http://localhost:5242）
- 健康檢查：`GET /health/ready`

## 開發登入（Development）
appsettings.json `Auth:TestAccounts` 啟用中：admin/admin（管理員）、user/user 等。Production 覆寫檔會全部關閉。

## 文件同步規則（使用者要求）
- 專案有變動 → 同步更新 CLAUDE.md 與 memory
- DB 架構有變動 → 同步更新 DB_Table.md，**包含其中「完整建置 SQL」一節**：新表加 CREATE TABLE、既有表調整在腳本尾端「5. 架構變更歷程」附加 ALTER/CREATE 增量指令（遠端主機以該腳本重建/升級 GenAI DB）
