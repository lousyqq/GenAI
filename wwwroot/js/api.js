// === 全域變數：取代原本的 localStorage，達成真正的 DB 讀寫 ===

// ⭐️ ES Module imports：fetch 覆寫攔截 401/403 時會用到 logout()/customAlert()。
//    其餘 getter / 渲染函式皆透過 window.* 呼叫，毋須在此 import。
import { logout } from './auth.js?v=20260607k';
import { customAlert } from './ui/dialogs.js?v=20260607k';
import { appState } from './store.js?v=20260607k';


// ⭐️ IIS 子目錄部署自適應：把絕對路徑 URL 自動 prepend APP_BASE。
//   背景：所有 fetch('/api/...') / fetch('/Settings/...') 寫的是「以網域根目錄為起點」的絕對路徑。
//   本機 dotnet run 時 APP_BASE = "/" → 維持原行為
//   IIS 部署在虛擬目錄 (e.g. /GenAI_TEST) 時 APP_BASE = "/GenAI_TEST/" → 自動加前綴
//   appbase.js 已在 index.html 最前面載入並設定 window.APP_BASE。
//   邏輯：
//     - 非字串 URL (Request 物件) → 不動，由呼叫者自行處理
//     - URL 以 http(s):// 開頭 → 不動 (外部 API)
//     - URL 不以 / 開頭 → 不動 (相對路徑，瀏覽器自己解析)
//     - URL 以 base 路徑開頭 → 不動 (已經轉換過 / 開發者已手動處理)
//     - URL 以 / 開頭且 base 非 "/" → 改寫成 base + url
window.toAppUrl = function (url) {
    if (typeof url !== 'string') return url;
    const base = window.APP_BASE || '/';
    if (base === '/' || !url.startsWith('/')) return url;
    if (/^https?:\/\//i.test(url)) return url;
    // base 結尾固定有 /，url 開頭固定有 / → 去掉 base 的尾巴 / 後拼接
    if (url.startsWith(base)) return url;  // 已經帶 base
    return base.replace(/\/$/, '') + url;
};

// ⭐️ 全域 fetch 攔截器：處理 401 Unauthorized，強制退回登入畫面
const originalFetch = window.fetch;

// 套用 CSRF 防護標頭（X-Requested-With + X-CSRF-TOKEN）。
//   用「覆寫」語意（set / 直接指派）而非 append，重試時才不會重複附加多個 token。
function applyCsrfHeaders(opts) {
    opts.headers = opts.headers || {};
    if (opts.headers instanceof Headers) {
        opts.headers.set('X-Requested-With', 'XMLHttpRequest');
        if (window._csrfToken) opts.headers.set('X-CSRF-TOKEN', window._csrfToken);
    } else {
        opts.headers['X-Requested-With'] = 'XMLHttpRequest';
        if (window._csrfToken) opts.headers['X-CSRF-TOKEN'] = window._csrfToken;
    }
}

// 重新向後端索取 CSRF token。登入後使用者身分改變（antiforgery token 綁定登入者身分）、
//   或伺服器重啟 / DataProtection 金鑰更新時，頁面初次載入時取得的舊 token 會失效。
//   ⚠️ 一律走 originalFetch，避免遞迴觸發本攔截器。
async function refreshCsrfToken() {
    try {
        const r = await originalFetch(window.toAppUrl('/api/Auth/CsrfToken'), { credentials: 'same-origin' });
        if (r.ok) {
            const d = await r.json();
            if (d && d.token) { window._csrfToken = d.token; return true; }
        }
    } catch (e) { /* 靜默：失敗就維持舊 token，交給呼叫端處理 */ }
    return false;
}
window.refreshCsrfToken = refreshCsrfToken;

window.fetch = async function (...args) {
    const isString = args[0] && typeof args[0] === 'string';
    if (isString) {
        // IIS 虛擬目錄自動 prepend
        args[0] = window.toAppUrl(args[0]);

        if (!args[1]) args[1] = {};
        args[1].credentials = 'same-origin';
        applyCsrfHeaders(args[1]);
    }
    let response = await originalFetch.apply(this, args);

    // 🛡️ 自我修復：寫入請求若因 CSRF token 失效（400 + "Invalid Token"）被擋，
    //   重新取得 token 後自動重試一次。涵蓋「登入後身分改變舊 token 失效」與
    //   「伺服器重啟/金鑰更新」兩種情境，使用者不再看到「CSRF validation failed: Invalid Token」。
    if (isString && response.status === 400) {
        const method = String((args[1] && args[1].method) || 'GET').toUpperCase();
        if (method !== 'GET' && method !== 'HEAD') {
            let isCsrfInvalid = false;
            try {
                const txt = await response.clone().text();
                isCsrfInvalid = txt.includes('CSRF validation failed: Invalid Token');
            } catch (e) { /* 無法讀取 body 就不重試 */ }
            if (isCsrfInvalid && await refreshCsrfToken()) {
                applyCsrfHeaders(args[1]);   // 套用剛取得的新 token
                response = await originalFetch.apply(this, args);
            }
        }
    }

    const urlStr = isString ? args[0] : '';
    // 如果後端回傳 401 (未登入或 Cookie 失效)，自動觸發登出 (排除允許 401 的 API)
    //   ⚠️ /api/Auth/MyProfile 必須在排除清單內：它與 GetInitialData 在初載時「並行」發出
    //   （fetchInitialDataFromDB 頂部），未登入/cookie 過期時兩者都會 401 —— GetInitialData
    //   已排除、MyProfile 若不排除會在每次冷開頁觸發 logout()（連發 Logout 請求＋設
    //   umc_force_manual_login 旗標卡住 Windows 自動登入）＋彈「登入時效已過期」擾民視窗
    //   （2026-07-03 修正）。其 401 由呼叫端 `if (myProfileRes.ok)` 靜默處理即可。
    if (response.status === 401 && !urlStr.includes('/api/Auth/Login') && !urlStr.includes('/Settings/GetInitialData') && !urlStr.includes('/api/Auth/WhoAmI') && !urlStr.includes('/api/Auth/MyProfile')) {
        if (typeof window.tryAutoLogin === 'function') {
            window.tryAutoLogin();
        }
        if (typeof customAlert === 'function') {
            customAlert("您的登入時效已過期或無權限，請重新整理網頁或認證身份！");
        } else {
            alert("您的登入時效已過期或無權限，請重新整理網頁或認證身份！");
        }
    } else if (response.status === 403) {
        if (typeof customAlert === 'function') {
            customAlert("權限不足，拒絕存取！");
        } else {
            alert("權限不足，拒絕存取！");
        }
    }
    return response;
};
window.appState = window.appState || {
    menus: [],
    fabs: [],
    roles: [],
    accounts: [],
    apps: [],
    requests: []
};

// ⭐️ 終極保險：全域宣告讀取函式，保證任何地方呼叫都是抓取記憶體 (DB) 的資料
export function getCustomMenus() { return window.appState.menus || []; }
export function getFabs() { return window.appState.fabs || []; }
export function getRoles() { return window.appState.roles || []; }
export function getAccounts() { return window.appState.accounts || []; }
export function getAppItems() { return window.appState.apps || []; }
export function getRequests() { return window.appState.requests || []; }

// 覆寫至 window，霸道蓋掉舊版 localStorage 的設定
window.getCustomMenus = getCustomMenus;
window.getFabs = getFabs;
window.getRoles = getRoles;
window.getAccounts = getAccounts;
window.getAppItems = getAppItems;
window.getRequests = getRequests;

// ⭐️ 超強防呆工具：無差別讀取物件屬性 (完全無視大小寫、camelCase 或 PascalCase)
const getVal = (obj, key) => {
    if (!obj) return undefined;
    const lowerKey = key.toLowerCase();
    for (let k in obj) {
        if (k.toLowerCase() === lowerKey) return obj[k];
    }
    return undefined;
};

// ⭐️ 核心：從後端 API 獲取資料，並將 SQL 關聯表「組裝」回前端 UI 預期的結構
export async function fetchInitialDataFromDB() {
    try {
        // 🚀 並行：MyProfile 與 GetInitialData 互不相依（皆僅需 auth cookie），同時發出省 1 個 RTT；MyProfile 結果在 accounts 填好後才 await。
        //    ⚠️ .catch(() => null) 必留：GetInitialData 網路層失敗會先 throw 早退，此 promise 若同樣 reject
        //    且從未被 await → unhandled rejection console 噪音。消費端以 `myProfileRes && myProfileRes.ok` 判空。
        const myProfilePromise = fetch('/api/Auth/MyProfile').catch(() => null);
        const response = await fetch('/Settings/GetInitialData', { cache: 'no-store' });

        // 先擋掉非 200
        if (!response.ok) {
            console.warn('GetInitialData failed:', response.status);
            return false;
        }

        // 避免空 body/非 JSON 導致 response.json() 直接爆
        const text = await response.text();
        if (!text) {
            console.warn('GetInitialData empty response');
            return false;
        }

        let result;
        try {
            result = JSON.parse(text);
        } catch (e) {
            console.error('GetInitialData not JSON:', text.slice(0, 200));
            return false;
        }

        if (result.error) {
            console.error("後端回傳錯誤:", result.message);
            return false;
        }

        // 取得資料陣列 (無視大小寫)
        const menusData = getVal(result, 'Menus') || [];
        const mapMenuData = getVal(result, 'Map_Menu_Structure') || [];
        const mapMenuAllowData = getVal(result, 'Map_Menu_AllowAccount') || [];
        const mapMenuDenyData = getVal(result, 'Map_Menu_DenyAccount') || [];
        const accData = getVal(result, 'Accounts') || [];
        const mapAccRoleData = getVal(result, 'Map_Account_Role') || [];
        const mapAccMenuData = getVal(result, 'Map_Account_ManageMenu') || [];
        const mapAccPageData = getVal(result, 'Map_Account_DefaultPage') || [];
        const mapAccExtraData = getVal(result, 'Map_Account_ExtraMenu') || [];
        const mapAccDenyData = getVal(result, 'Map_Account_DenyMenu') || [];
        const roleData = getVal(result, 'Roles') || [];
        const mapRoleMenuData = getVal(result, 'Map_Role_Menu') || [];
        const fabData = getVal(result, 'Fabs') || [];
        const mapFabRoleData = getVal(result, 'Map_Fab_Role') || [];
        const appData = getVal(result, 'Apps') || [];
        const reqData = getVal(result, 'Requests') || [];

        // 1. 轉換 Menus (⭐️ 雙軌相容修復：同時讀取舊版欄位與新版關聯表)
        let mappedMenus = menusData.map(m => {
            let pId = getVal(m, 'ParentId') || getVal(m, 'parentId');
            if (pId === 'null' || pId === '') pId = null;

            let pIds = getVal(m, 'ParentIds') || getVal(m, 'parentIds');
            let parsedPIds = [];
            if (pIds && typeof pIds === 'string' && pIds !== 'null') {
                try { parsedPIds = JSON.parse(pIds); } catch (e) { parsedPIds = [pIds]; }
            } else if (Array.isArray(pIds)) {
                parsedPIds = [...pIds];
            }

            let pOrders = getVal(m, 'ParentOrders') || getVal(m, 'parentOrders');
            let parsedPOrders = {};
            if (pOrders && typeof pOrders === 'string' && pOrders !== 'null') {
                try { parsedPOrders = JSON.parse(pOrders); } catch (e) { }
            } else if (typeof pOrders === 'object' && pOrders !== null) {
                parsedPOrders = { ...pOrders };
            }

            return {
                id: String(getVal(m, 'MenuId') || getVal(m, 'id') || ''),
                name: String(getVal(m, 'SysName') || getVal(m, 'name') || ''),
                displayName: String(getVal(m, 'DisplayName') || getVal(m, 'displayName') || ''),
                menuMode: String(getVal(m, 'MenuMode') || getVal(m, 'menuMode') || 'link'),
                url: String(getVal(m, 'Url') || getVal(m, 'url') || ''),
                targetPage: String(getVal(m, 'TargetPage') || getVal(m, 'targetPage') || ''),
                target: String(getVal(m, 'OpenTarget') || getVal(m, 'target') || 'iframe'),
                icon: String(getVal(m, 'Icon') || getVal(m, 'icon') || ''),
                createdBy: String(getVal(m, 'CreatedBy') || getVal(m, 'createdBy') || 'admin'),
                // ⚠️ 不可用 `||`：當 DB 回 IsEnabled=false 時會被當成 falsy 而 fallback 到 undefined，
                // 解析回來反而變成 true，造成「狀態切換 OFF 看起來沒生效」。改用 `??` 只在 null/undefined 才 fallback。
                enabled: String(getVal(m, 'IsEnabled') ?? getVal(m, 'enabled')).toLowerCase() !== 'false',
                isPoolItem: String(getVal(m, 'IsPoolItem') || getVal(m, 'isPoolItem')).toLowerCase() === 'true',
                isEdited: String(getVal(m, 'IsEdited') || getVal(m, 'isEdited')).toLowerCase() === 'true',
                order: parseInt(getVal(m, 'GlobalOrder') || getVal(m, 'order') || 0),
                parentId: pId,
                parentIds: parsedPIds,
                parentOrders: parsedPOrders,
                // Menu 層級存取控制 — 下面從 Map_Menu_Allow/DenyAccount 補入
                allowedEmpIds: [],
                deniedEmpIds: []
            };
        });

        // 若有關聯表，則將其附加到剛才讀取的欄位上
        mapMenuData.forEach(rel => {
            let childId = String(getVal(rel, 'ChildMenuId') || '');
            let pId = String(getVal(rel, 'ParentMenuId') || '');
            let sortOrder = parseInt(getVal(rel, 'SortOrder') || 0);

            let child = mappedMenus.find(m => m.id === childId);
            if (child && pId) {
                if (!child.parentIds.includes(pId)) child.parentIds.push(pId);
                child.parentOrders[pId] = sortOrder;
                if (child.parentId === null) child.parentId = pId;
            }
        });

        // Menu-level ACL：白名單
        mapMenuAllowData.forEach(rel => {
            let mId = String(getVal(rel, 'MenuId') || '');
            let eId = String(getVal(rel, 'EmpId') || '');
            let menu = mappedMenus.find(m => m.id === mId);
            if (menu && eId && !menu.allowedEmpIds.includes(eId)) menu.allowedEmpIds.push(eId);
        });

        // Menu-level ACL：黑名單
        mapMenuDenyData.forEach(rel => {
            let mId = String(getVal(rel, 'MenuId') || '');
            let eId = String(getVal(rel, 'EmpId') || '');
            let menu = mappedMenus.find(m => m.id === mId);
            if (menu && eId && !menu.deniedEmpIds.includes(eId)) menu.deniedEmpIds.push(eId);
        });

        // 2. 轉換 Accounts (⭐️ 雙軌相容讀取)
        let mappedAccounts = accData.map(a => {
            let assigned = getVal(a, 'AssignedRoles') || getVal(a, 'assignedRoles');
            let parsedAssigned = [];
            if (assigned && typeof assigned === 'string' && assigned !== 'null') { try { parsedAssigned = JSON.parse(assigned); } catch (e) { } }
            else if (Array.isArray(assigned)) parsedAssigned = [...assigned];

            let manageable = getVal(a, 'ManageableMenus') || getVal(a, 'manageableMenus');
            let parsedManageable = [];
            if (manageable && typeof manageable === 'string' && manageable !== 'null') { try { parsedManageable = JSON.parse(manageable); } catch (e) { } }
            else if (Array.isArray(manageable)) parsedManageable = [...manageable];

            let defPages = getVal(a, 'DefaultPages') || getVal(a, 'defaultPages');
            let parsedDefPages = {};
            if (defPages && typeof defPages === 'string' && defPages !== 'null') { try { parsedDefPages = JSON.parse(defPages); } catch (e) { } }
            else if (typeof defPages === 'object' && defPages !== null) parsedDefPages = { ...defPages };

            return {
                empId: String(getVal(a, 'EmpId') || getVal(a, 'empId') || ''),
                name: String(getVal(a, 'Name') || getVal(a, 'name') || ''),
                department: String(getVal(a, 'Department') || getVal(a, 'department') || ''),
                roleLevel: String(getVal(a, 'RoleLevel') || getVal(a, 'roleLevel') || 'user'),
                canEditOthers: String(getVal(a, 'CanEditOthers') || getVal(a, 'canEditOthers')).toLowerCase() === 'true',
                manageableMenus: parsedManageable,
                assignedRoles: parsedAssigned,
                defaultPages: parsedDefPages,
                // per-fab 個別覆寫 — 由 Map_Account_ExtraMenu / Map_Account_DenyMenu 補入，形狀 { fabId: [menuId,...] }
                extraMenus: {},
                denyMenus: {},
                // 登入統計
                loginCount: parseInt(getVal(a, 'LoginCount') || getVal(a, 'loginCount') || 0) || 0,
                lastLoginTime: getVal(a, 'LastLoginTime') || getVal(a, 'lastLoginTime') || null
            };
        });

        mapAccRoleData.forEach(rel => {
            let acc = mappedAccounts.find(a => a.empId === String(getVal(rel, 'EmpId')));
            let rId = String(getVal(rel, 'RoleId'));
            if (acc && rId && !acc.assignedRoles.includes(rId)) acc.assignedRoles.push(rId);
        });

        mapAccMenuData.forEach(rel => {
            let acc = mappedAccounts.find(a => a.empId === String(getVal(rel, 'EmpId')));
            let mId = String(getVal(rel, 'MenuId'));
            if (acc && mId && !acc.manageableMenus.includes(mId)) acc.manageableMenus.push(mId);
        });

        mapAccPageData.forEach(rel => {
            let acc = mappedAccounts.find(a => a.empId === String(getVal(rel, 'EmpId')));
            let fId = String(getVal(rel, 'FabId')); let mId = String(getVal(rel, 'MenuId'));
            if (acc && fId && mId) acc.defaultPages[fId] = mId;
        });

        // per-fab 個別覆寫：額外開放（依 FabId 分組）
        mapAccExtraData.forEach(rel => {
            let acc = mappedAccounts.find(a => a.empId === String(getVal(rel, 'EmpId')));
            let fId = String(getVal(rel, 'FabId') || '');
            let mId = String(getVal(rel, 'MenuId'));
            if (acc && fId && mId) {
                if (!acc.extraMenus[fId]) acc.extraMenus[fId] = [];
                if (!acc.extraMenus[fId].includes(mId)) acc.extraMenus[fId].push(mId);
            }
        });

        // per-fab 個別覆寫：個別封鎖（依 FabId 分組）
        mapAccDenyData.forEach(rel => {
            let acc = mappedAccounts.find(a => a.empId === String(getVal(rel, 'EmpId')));
            let fId = String(getVal(rel, 'FabId') || '');
            let mId = String(getVal(rel, 'MenuId'));
            if (acc && fId && mId) {
                if (!acc.denyMenus[fId]) acc.denyMenus[fId] = [];
                if (!acc.denyMenus[fId].includes(mId)) acc.denyMenus[fId].push(mId);
            }
        });

        // 3. 轉換 Roles (⭐️ 雙軌相容讀取)
        let mappedRoles = roleData.map(r => {
            let allowed = getVal(r, 'AllowedMenuIds') || getVal(r, 'allowedMenuIds');
            let parsedAllowed = [];
            if (allowed && typeof allowed === 'string' && allowed !== 'null') { try { parsedAllowed = JSON.parse(allowed); } catch (e) { } }
            else if (Array.isArray(allowed)) parsedAllowed = [...allowed];

            return {
                id: String(getVal(r, 'RoleId') || getVal(r, 'id') || ''),
                groupName: String(getVal(r, 'GroupName') || getVal(r, 'groupName') || ''),
                allowedMenuIds: parsedAllowed
            };
        });

        mapRoleMenuData.sort((a, b) => parseInt(getVal(a, 'SortOrder') || 0) - parseInt(getVal(b, 'SortOrder') || 0))
            .forEach(rel => {
                let role = mappedRoles.find(r => r.id === String(getVal(rel, 'RoleId')));
                let mId = String(getVal(rel, 'MenuId'));
                if (role && mId && !role.allowedMenuIds.includes(mId)) role.allowedMenuIds.push(mId);
            });

        // 4. 轉換 Fabs (⭐️ 雙軌相容讀取)
        let mappedFabs = fabData.map(f => {
            let assigned = getVal(f, 'AssignedRoles') || getVal(f, 'assignedRoles');
            let parsedAssigned = [];
            if (assigned && typeof assigned === 'string' && assigned !== 'null') { try { parsedAssigned = JSON.parse(assigned); } catch (e) { } }
            else if (Array.isArray(assigned)) parsedAssigned = [...assigned];

            return {
                id: String(getVal(f, 'FabId') || getVal(f, 'id') || ''),
                fabName: String(getVal(f, 'FabName') || getVal(f, 'fabName') || ''),
                displayName: String(getVal(f, 'DisplayName') || getVal(f, 'displayName') || ''),
                defaultLang: String(getVal(f, 'DefaultLang') || getVal(f, 'defaultLang') || 'zh'),
                assignedRoles: parsedAssigned
            };
        });

        mapFabRoleData.forEach(rel => {
            let fab = mappedFabs.find(f => f.id === String(getVal(rel, 'FabId')));
            let rId = String(getVal(rel, 'RoleId'));
            if (fab && rId && !fab.assignedRoles.includes(rId)) fab.assignedRoles.push(rId);
        });

        // 5. 轉換 Apps
        let mappedApps = appData.map(a => ({
            id: String(getVal(a, 'AppId') || ''),
            menuId: String(getVal(a, 'MenuId') || ''),
            name: String(getVal(a, 'AppName') || getVal(a, 'name') || ''),
            appName: String(getVal(a, 'AppName') || getVal(a, 'name') || ''),
            url: String(getVal(a, 'Url') || ''),
            iconBase64: String(getVal(a, 'IconBase64') || ''),
            target: String(getVal(a, 'Target') || '_blank')
        }));

        // 6. 轉換 Requests
        let mappedReqs = reqData.map(r => ({
            id: String(getVal(r, 'RequestId') || ''),
            empId: String(getVal(r, 'EmpId') || ''),
            empName: String(getVal(r, 'EmpName') || ''),
            reqType: String(getVal(r, 'ReqType') || ''),
            fab: String(getVal(r, 'Fab') || ''),
            reason: String(getVal(r, 'Reason') || ''),
            timestamp: String(getVal(r, 'Timestamp') || ''),
            status: String(getVal(r, 'Status') || ''),
            withdrawReason: String(getVal(r, 'WithdrawReason') || ''),
            reply: String(getVal(r, 'Reply') || '')
        }));

        // ⭐️ 更新全域狀態
        window.appState.menus = mappedMenus;
        window.appState.accounts = mappedAccounts;
        window.appState.roles = mappedRoles;
        window.appState.fabs = mappedFabs;
        window.appState.apps = mappedApps;
        window.appState.requests = mappedReqs;

        // ⭐ 7. 解析 PersonalSettings（後端非 admin 已只回自己這一列；admin 雖回全量，
        //       但本機只需快取「登入者自己」的版面，避免把他人個人版面寫進本機 localStorage）。
        //       實際 localStorage 寫入延後到取得登入者 empId 之後（見下方 MyProfile 區塊）。
        const psData = getVal(result, 'PersonalSettings') || [];
        const psByEmp = {};
        psData.forEach(row => {
            const eId = String(getVal(row, 'EmpId') || '');
            const mId = String(getVal(row, 'MenuId') || '');
            if (!eId || !mId) return;
            if (!psByEmp[eId]) psByEmp[eId] = {};
            const rawOrder = getVal(row, 'SortOrder');
            psByEmp[eId][mId] = {
                hidden: String(getVal(row, 'IsHidden')).toLowerCase() === 'true',
                target: String(getVal(row, 'OpenTarget') || ''),
                icon: String(getVal(row, 'Icon') || ''),
                order: (rawOrder != null && rawOrder !== '' && !isNaN(rawOrder))
                    ? parseInt(rawOrder) : undefined
            };
        });

        // console.log("資料庫載入與轉換完成:", window.appState);

        // ⭐️ 終極霸道覆寫：在資料確實抵達記憶體後，強行覆寫系統中所有的讀取函式！
        // 這能確保無論 config.js 怎麼寫，最終都會被這段程式碼攔截，強制讀取 DB 資料。
        window.getCustomMenus = function () { return window.appState.menus || []; };
        window.getFabs = function () { return window.appState.fabs || []; };
        window.getRoles = function () { return window.appState.roles || []; };
        window.getAccounts = function () { return window.appState.accounts || []; };
        window.getAppItems = function () { return window.appState.apps || []; };
        window.getRequests = function () { return window.appState.requests || []; };

        // 🛡️ Lazy Loading：向後端取得登入者自身的詳細權限 (因為 InitialData 已剔除全量權限)
        let myEmpId = '';
        try {
            const myProfileRes = await myProfilePromise;
            if (myProfileRes && myProfileRes.ok) {
                const myProfile = await myProfileRes.json();
                myEmpId = String(myProfile.empId || '');
                let myAcc = window.appState.accounts.find(a => String(a.empId) === String(myProfile.empId));
                if (myAcc) {
                    myAcc.assignedRoles = myProfile.assignedRoles || [];
                    myAcc.manageableMenus = myProfile.manageableMenus || [];
                    // canEditOthers 現由 MyProfile 直接帶回（自足來源）；僅在後端有提供時覆寫，否則保留 GetInitialData 解析值（向後相容）。
                    if (typeof myProfile.canEditOthers === 'boolean') myAcc.canEditOthers = myProfile.canEditOthers;
                    // per-fab 形狀 { fabId: [menuId,...] }
                    myAcc.extraMenus = myProfile.extraMenus || {};
                    myAcc.denyMenus = myProfile.denyMenus || {};
                    myAcc.defaultPages = myProfile.defaultPages || {};
                }
            }
        } catch (e) {
            console.error("無法取得個人權限", e);
        }

        // ⭐ O3：只把「登入者自己」的個人版面寫進 localStorage（始終覆寫成 DB 真實值）。
        //    舊版會把 psByEmp 內所有人的版面都寫進本機，既無用又會殘留他人資料；
        //    現在只快取自己這一份，且每次載入都對齊 DB（含「DB 已清空 → 本機也清空」）。
        if (!myEmpId) myEmpId = String(appState.currentUser?.id || '');
        if (myEmpId) {
            localStorage.setItem('umc_personal_menus_' + myEmpId, JSON.stringify(psByEmp[myEmpId] || {}));
        }

        // ⭐️ 超級覆寫：確保不論在這裡之後才呼叫 initDashboardUI()，也不會因為載入順序而讀到靜態設定
        if (typeof window.renderSidebarMenus === 'function') {
            window.renderSidebarMenus();
        }

        // 如果目前使用者正停留在任何管理表格頁面，安全地替他刷新表格以反映背景同步回來的資料
        if (typeof window.renderAccountTable === 'function' && document.getElementById('page-account-manage') && document.getElementById('page-account-manage').classList.contains('active')) {
            window.renderAccountTable();
        }
        if (typeof window.renderRoleTable === 'function' && document.getElementById('page-role-manage') && document.getElementById('page-role-manage').classList.contains('active')) {
            window.renderRoleTable();
        }
        if (typeof window.renderFabTable === 'function' && document.getElementById('page-fab-manage') && document.getElementById('page-fab-manage').classList.contains('active')) {
            window.renderFabTable();
        }
        if (typeof window.renderApplyTable === 'function' && document.getElementById('page-apply') && document.getElementById('page-apply').classList.contains('active')) {
            window.renderApplyTable();
        }

        return true;

    } catch (error) {
        console.error("載入資料庫失敗:", error);
        return false;
    }
}

// 取得當前網頁資料，轉換為符合 C# API 所需的 JSON 物件
export function getDatabasePayload() {
    const menus = window.getCustomMenus(); const fabs = window.getFabs(); const roles = window.getRoles();
    const accs = window.getAccounts(); const apps = window.getAppItems(); const reqs = window.getRequests();
    let payload = {};

    const safeStr = (val, maxLen) => String(val || '').trim().substring(0, maxLen);
    const safeLongStr = (val) => String(val || '').trim();

    // ⭐️ 雙軌相容寫入：同時將原本拆去關聯表的 ParentId 加回 Menus，以防 SQL 尚未升級新表
    payload.Menus = menus.map(m => {
        let pIdsStr = null;
        if (m.parentIds && m.parentIds.length > 0) pIdsStr = JSON.stringify(m.parentIds);
        let pOrdersStr = null;
        if (m.parentOrders && Object.keys(m.parentOrders).length > 0) pOrdersStr = JSON.stringify(m.parentOrders);

        return {
            MenuId: safeStr(m.id, 50), SysName: safeStr(m.name, 100), DisplayName: safeStr(m.displayName, 100),
            MenuMode: safeStr(m.menuMode, 20) || 'link', Url: safeLongStr(m.url), TargetPage: safeStr(m.targetPage, 100),
            OpenTarget: safeStr(m.target, 20), Icon: safeLongStr(m.icon), CreatedBy: safeStr(m.createdBy, 50) || 'admin',
            IsEnabled: m.enabled !== false, IsPoolItem: m.isPoolItem === true, IsEdited: m.isEdited === true, GlobalOrder: m.order || 0,
            ParentId: m.parentId ? String(m.parentId) : null,
            ParentIds: pIdsStr,
            ParentOrders: pOrdersStr
        };
    });

    payload.Fabs = fabs.map(f => {
        let assignedStr = null;
        if (f.assignedRoles && f.assignedRoles.length > 0) assignedStr = JSON.stringify(f.assignedRoles);
        return {
            FabId: safeStr(f.id, 50), FabName: safeStr(f.fabName, 50),
            DisplayName: safeStr(f.displayName, 100), DefaultLang: safeStr(f.defaultLang, 10) || 'zh',
            AssignedRoles: assignedStr
        };
    });

    payload.Roles = roles.map(r => {
        let allowedStr = null;
        if (r.allowedMenuIds && r.allowedMenuIds.length > 0) allowedStr = JSON.stringify(r.allowedMenuIds);
        return {
            RoleId: safeStr(r.id, 50), GroupName: safeStr(r.groupName, 100),
            AllowedMenuIds: allowedStr
        };
    });

    payload.Accounts = accs.map(a => {
        let assignedStr = null; if (a.assignedRoles && a.assignedRoles.length > 0) assignedStr = JSON.stringify(a.assignedRoles);
        let manStr = null; if (a.manageableMenus && a.manageableMenus.length > 0) manStr = JSON.stringify(a.manageableMenus);
        let defStr = null; if (a.defaultPages && Object.keys(a.defaultPages).length > 0) defStr = JSON.stringify(a.defaultPages);
        return {
            EmpId: safeStr(a.empId, 50), Name: safeStr(a.name, 100), Department: safeStr(a.department, 100),
            RoleLevel: safeStr(a.roleLevel, 20) || 'user', CanEditOthers: a.canEditOthers === true,
            AssignedRoles: assignedStr, ManageableMenus: manStr, DefaultPages: defStr,
            // 保留登入統計欄位，避免全量覆寫時被洗掉
            LoginCount: (typeof a.loginCount === 'number' ? a.loginCount : (parseInt(a.loginCount) || 0)),
            LastLoginTime: a.lastLoginTime || null
        };
    });

    payload.Apps = apps.map(a => ({
        AppId: safeStr(a.id, 50), MenuId: safeStr(a.menuId, 50), AppName: safeStr(a.appName, 100),
        Url: safeLongStr(a.url), IconBase64: safeLongStr(a.iconBase64), Target: safeStr(a.target, 20) || 'iframe'
    }));

    payload.Requests = reqs.map(r => ({
        RequestId: safeStr(r.id, 50), EmpId: safeStr(r.empId, 50), EmpName: safeStr(r.empName, 100),
        ReqType: safeStr(r.reqType, 50), Fab: safeStr(r.fab, 50), Reason: safeLongStr(r.reason),
        Timestamp: safeStr(r.timestamp, 50), Status: safeStr(r.status, 20),
        WithdrawReason: safeLongStr(r.withdrawReason), Reply: safeLongStr(r.reply)
    }));

    // ⚠️ PersonalSettings 刻意「不」併入此 payload：
    //   它是 per-user 自訂版面，一律走 RESTful /api/PersonalSettings（per-user delete+insert）。
    //   後端 SaveDataAsync 的 TableNames 也已移除 PersonalSettings，故此 payload 即使帶了它也不會被寫入。
    //   舊版用 admin 自己 localStorage 重建整張表，會用過時快照洗掉所有人的個人版面 → 移除。

    // 組裝關聯表 (當後端升級為新版結構時，這些關聯表將自動發揮作用)
    payload.Map_Fab_Role = []; fabs.forEach(f => { if (f.assignedRoles) f.assignedRoles.forEach(rId => payload.Map_Fab_Role.push({ FabId: String(f.id), RoleId: String(rId) })); });
    payload.Map_Account_Role = []; accs.forEach(a => { if (a.assignedRoles) a.assignedRoles.forEach(rId => payload.Map_Account_Role.push({ EmpId: String(a.empId), RoleId: String(rId) })); });
    payload.Map_Account_ManageMenu = []; accs.forEach(a => { if (a.manageableMenus) a.manageableMenus.forEach(mId => payload.Map_Account_ManageMenu.push({ EmpId: String(a.empId), MenuId: String(mId) })); });
    payload.Map_Role_Menu = []; roles.forEach(r => { if (r.allowedMenuIds) r.allowedMenuIds.forEach((mId, idx) => payload.Map_Role_Menu.push({ RoleId: String(r.id), MenuId: String(mId), SortOrder: idx * 10 })); });
    payload.Map_Menu_Structure = []; menus.forEach(m => { if (m.parentIds && m.parentIds.length > 0) { m.parentIds.forEach(pId => payload.Map_Menu_Structure.push({ ParentMenuId: String(pId), ChildMenuId: String(m.id), SortOrder: m.parentOrders ? (m.parentOrders[pId] || 0) : 0 })); } else if (m.parentId) { payload.Map_Menu_Structure.push({ ParentMenuId: String(m.parentId), ChildMenuId: String(m.id), SortOrder: m.order || 0 }); } });
    payload.Map_Account_DefaultPage = []; accs.forEach(a => { if (a.defaultPages) { for (let fab in a.defaultPages) { payload.Map_Account_DefaultPage.push({ EmpId: String(a.empId), FabId: String(fab), MenuId: String(a.defaultPages[fab]) }); } } });
    // per-fab 個別覆寫：extraMenus / denyMenus 形狀為 { fabId: [menuId,...] }，逐廠區攤平成 {EmpId, FabId, MenuId}
    payload.Map_Account_ExtraMenu = []; accs.forEach(a => { if (a.extraMenus && typeof a.extraMenus === 'object') { for (let fab in a.extraMenus) { if (!fab) continue; (a.extraMenus[fab] || []).forEach(mId => payload.Map_Account_ExtraMenu.push({ EmpId: String(a.empId), FabId: String(fab), MenuId: String(mId) })); } } });
    payload.Map_Account_DenyMenu = []; accs.forEach(a => { if (a.denyMenus && typeof a.denyMenus === 'object') { for (let fab in a.denyMenus) { if (!fab) continue; (a.denyMenus[fab] || []).forEach(mId => payload.Map_Account_DenyMenu.push({ EmpId: String(a.empId), FabId: String(fab), MenuId: String(mId) })); } } });
    // Menu 層級存取控制
    payload.Map_Menu_AllowAccount = []; menus.forEach(m => { if (m.allowedEmpIds) m.allowedEmpIds.forEach(eId => payload.Map_Menu_AllowAccount.push({ MenuId: String(m.id), EmpId: String(eId) })); });
    payload.Map_Menu_DenyAccount = []; menus.forEach(m => { if (m.deniedEmpIds) m.deniedEmpIds.forEach(eId => payload.Map_Menu_DenyAccount.push({ MenuId: String(m.id), EmpId: String(eId) })); });

    return payload;
}

// 將前端資料同步寫入後端 DB 的核心功能
// showFeedback=true 時會顯示 loading 遮罩與成功訊息（手動觸發匯入時用）；
// 一般 CRUD 操作走 showFeedback=false（靜默同步，避免干擾使用者）。
export async function syncDataToDB(showFeedback) {
    const payload = getDatabasePayload();

    let loadingOverlay = null;
    if (showFeedback === true) {
        loadingOverlay = document.createElement('div');
        loadingOverlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:9999; display:flex; flex-direction:column; justify-content:center; align-items:center; color:white; font-family:sans-serif;';
        loadingOverlay.innerHTML = '<div class="spinner-border text-info mb-3" style="width: 3rem; height: 3rem;"></div><h2>正在同步資料庫...</h2><p class="text-secondary">請勿關閉網頁</p>';
        document.body.appendChild(loadingOverlay);
    }

    try {
        const response = await fetch('/Settings/SaveData', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();

        if (loadingOverlay) loadingOverlay.remove();

        if (result.success) {
            appState.hasUnsavedChanges = false;
            if (showFeedback === true && typeof customAlert === 'function') {
                customAlert(result.message || "資料已成功同步至資料庫！");
            }
        } else {
            if (typeof customAlert === 'function') customAlert("寫入失敗: " + result.message);
            else alert("寫入失敗: " + result.message);
        }
    } catch (error) {
        if (loadingOverlay) loadingOverlay.remove();
        console.error("同步失敗:", error);
        if (showFeedback === true && typeof customAlert === 'function') {
            customAlert("網路錯誤或伺服器無回應，請確認 C# 後端是否正常運作。");
        }
    }
}

window.syncToDB = syncDataToDB;
window.syncDataToDB = syncDataToDB;

// ==========================================
// RESTful API 呼叫區 (逐步淘汰 syncDataToDB)
// ==========================================

export async function saveFabAPI(isNew, fabData) {
    const url = isNew ? '/api/Fabs' : `/api/Fabs/${encodeURIComponent(fabData.id)}`;
    const method = isNew ? 'POST' : 'PUT';

    try {
        const res = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fabData)
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(err || `伺服器回傳錯誤: ${res.status}`);
        }

        return { success: true };
    } catch (error) {
        console.error("儲存廠區失敗:", error);
        return { success: false, message: error.message };
    }
}
window.saveFabAPI = saveFabAPI;

export async function deleteFabAPI(id) {
    try {
        const res = await fetch(`/api/Fabs/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(err || `伺服器回傳錯誤: ${res.status}`);
        }
        return { success: true };
    } catch (error) {
        console.error("刪除廠區失敗:", error);
        return { success: false, message: error.message };
    }
}
window.deleteFabAPI = deleteFabAPI;

export async function saveRoleAPI(isNew, roleData) {
    const url = isNew ? '/api/Roles' : `/api/Roles/${encodeURIComponent(roleData.id)}`;
    const method = isNew ? 'POST' : 'PUT';

    try {
        const res = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(roleData)
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(err || `伺服器回傳錯誤: ${res.status}`);
        }

        return { success: true };
    } catch (error) {
        console.error("儲存權限群組失敗:", error);
        return { success: false, message: error.message };
    }
}
window.saveRoleAPI = saveRoleAPI;

export async function deleteRoleAPI(id) {
    try {
        const res = await fetch(`/api/Roles/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(err || `伺服器回傳錯誤: ${res.status}`);
        }
        return { success: true };
    } catch (error) {
        console.error("刪除權限群組失敗:", error);
        return { success: false, message: error.message };
    }
}
window.deleteRoleAPI = deleteRoleAPI;

export async function saveAccountAPI(isNew, accountData) {
    const url = isNew ? '/api/Accounts' : `/api/Accounts/${encodeURIComponent(accountData.empId)}`;
    const method = isNew ? 'POST' : 'PUT';

    try {
        const res = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(accountData)
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(err || `伺服器回傳錯誤: ${res.status}`);
        }

        return { success: true };
    } catch (error) {
        console.error("儲存帳號失敗:", error);
        return { success: false, message: error.message };
    }
}
window.saveAccountAPI = saveAccountAPI;

export async function deleteAccountAPI(id) {
    try {
        const res = await fetch(`/api/Accounts/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(err || `伺服器回傳錯誤: ${res.status}`);
        }
        return { success: true };
    } catch (error) {
        console.error("刪除帳號失敗:", error);
        return { success: false, message: error.message };
    }
}
window.deleteAccountAPI = deleteAccountAPI;

export async function saveMenuAPI(isNew, menuData) {
    const url = isNew ? '/api/Menus' : `/api/Menus/${encodeURIComponent(menuData.id)}`;
    const method = isNew ? 'POST' : 'PUT';

    try {
        const res = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(menuData)
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(err || `伺服器回傳錯誤: ${res.status}`);
        }

        return { success: true };
    } catch (error) {
        console.error("儲存選單失敗:", error);
        return { success: false, message: error.message };
    }
}
window.saveMenuAPI = saveMenuAPI;

export async function deleteMenuAPI(id) {
    try {
        const res = await fetch(`/api/Menus/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(err || `伺服器回傳錯誤: ${res.status}`);
        }
        return { success: true };
    } catch (error) {
        console.error("刪除選單失敗:", error);
        return { success: false, message: error.message };
    }
}
window.deleteMenuAPI = deleteMenuAPI;

export async function batchSaveMenusAPI(menusData) {
    try {
        const res = await fetch('/api/Menus/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(menusData)
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(err || `伺服器回傳錯誤: ${res.status}`);
        }
        return { success: true };
    } catch (error) {
        console.error("批次儲存選單失敗:", error);
        return { success: false, message: error.message };
    }
}
window.batchSaveMenusAPI = batchSaveMenusAPI;

export async function batchDeleteMenusAPI(ids) {
    try {
        const res = await fetch('/api/Menus/batch', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(ids)
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(err || `伺服器回傳錯誤: ${res.status}`);
        }
        return { success: true };
    } catch (error) {
        console.error("批次刪除選單失敗:", error);
        return { success: false, message: error.message };
    }
}
window.batchDeleteMenusAPI = batchDeleteMenusAPI;

export async function saveAppAPI(isNew, appData) {
    const url = isNew ? '/api/Apps' : `/api/Apps/${encodeURIComponent(appData.id)}`;
    const method = isNew ? 'POST' : 'PUT';

    try {
        const res = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(appData)
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(err || `伺服器回傳錯誤: ${res.status}`);
        }

        return { success: true };
    } catch (error) {
        console.error("儲存應用項目失敗:", error);
        return { success: false, message: error.message };
    }
}
window.saveAppAPI = saveAppAPI;

export async function deleteAppAPI(id) {
    try {
        const res = await fetch(`/api/Apps/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(err || `伺服器回傳錯誤: ${res.status}`);
        }
        return { success: true };
    } catch (error) {
        console.error("刪除應用項目失敗:", error);
        return { success: false, message: error.message };
    }
}
window.deleteAppAPI = deleteAppAPI;

// ⭐️ 暴露給 HTML inline handler（onclick=...）使用。
//    其餘 getter / CRUD 函式已於上方各自宣告後就近 window.* 賦值，
//    這裡僅補上唯二未在上方暴露的兩支（給 main.js / auth.js 以外的呼叫端備用）。
window.fetchInitialDataFromDB = fetchInitialDataFromDB;
window.getDatabasePayload = getDatabasePayload;

