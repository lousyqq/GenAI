// === admin/account-manage.js - 帳號管理 CRUD ===

import { hideModalSafely, showModalSafely } from './modal-utils.js?v=20260607k';
import { deleteAccountAPI, fetchInitialDataFromDB, saveAccountAPI } from '../api.js?v=20260607k';
import { renderAccDefaultPagesUI, renderAccManageMenuCheckboxes, renderAccRoleCheckboxes } from '../render/account-ui.js?v=20260607k';
import { renderSidebarMenus } from '../render/sidebar.js?v=20260607k';
import { renderAccountTable } from '../render/tables.js?v=20260607k';
import { customAlert, customConfirm } from '../ui/dialogs.js?v=20260607k';
import { appState } from '../store.js?v=20260607k';


// === Accounts 帳號管理 ===
export function openAddAccountModal() {
    try {
        document.getElementById('accForm').reset();
        document.getElementById('editAccMode').value = '';

        // ⭐️ 修復 1：工號欄位狀態還原，確保新增時可輸入 (解除 readOnly 與 disabled)
        document.getElementById('accEmpId').readOnly = false;
        document.getElementById('accEmpId').disabled = false;

        document.getElementById('accRoleLevel').value = 'user';
        document.getElementById('accRoleLevel').disabled = false;
        document.getElementById('accEnableDelegation').checked = false;

        // 新增情境：把「管理層級」、「委派管理」兩個區段重新顯示（清除上次編輯 admin 留下的隱藏狀態）
        const lvlGroup = document.getElementById('accRoleLevelGroup');
        if (lvlGroup) lvlGroup.style.display = '';

        // ⭐️ 修復 2：移除這行舊版的 HTML 覆寫，它會因為找不到舊容器而導致程式報錯中斷！
        // document.getElementById('accRoleCheckboxesContainer').innerHTML = '<div id="accRoleCheckboxes" class="d-flex flex-wrap gap-1 mt-1"></div>';

        appState.tempDefaultPages = {};

        // ⭐️ 修復 3：重置時連同委派細節區塊一併還原/收起
        if (typeof toggleAccDelegationUI === 'function') toggleAccDelegationUI();
        if (typeof toggleDelegationDetails === 'function') toggleDelegationDetails();

        if (typeof renderAccRoleCheckboxes === 'function') renderAccRoleCheckboxes([]);
        if (typeof renderAccManageMenuCheckboxes === 'function') renderAccManageMenuCheckboxes([]);
        if (typeof renderAccDefaultPagesUI === 'function') renderAccDefaultPagesUI();
        // 個別覆寫 (per-fab，新增模式：全空)
        appState.tempExtraMenus = {};
        appState.tempDenyMenus = {};
        appState.overrideFab = '';
        if (typeof window.renderAccOverridePanel === 'function') window.renderAccOverridePanel();

        showModalSafely('accModal');
    } catch (e) { console.error("[openAddAccountModal] 錯誤:", e); }
}

export async function editAccount(empId) {
    try {
        // 🛡️ Lazy Loading：帳號清單（getAccounts）O3 重構後只剩「呼叫者自己一列」，
        //   故編輯任何帳號（含自己）一律向後端 GET /api/Accounts/{id} 取單帳號完整明細
        //   （含 manageableMenus / extraMenus / denyMenus / defaultPages），不可再依賴 getAccounts()。
        //   ⚠️ empId 必須 encodeURIComponent：Windows 網域工號含反斜線（SARIEL\yu-tinglin），
        //      未編碼時瀏覽器會把路徑中的「\」正規化成「/」→ 變成兩段路徑 → 路由不匹配 404
        //      → 整個編輯/儲存流程拿到殘缺資料。/api/Accounts/{id} 為 admin-only，與本頁 authz 一致。
        let acc;
        try {
            const res = await fetch(`/api/Accounts/${encodeURIComponent(empId)}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
            if (!res.ok) { console.error(`無法取得帳號 ${empId} 的明細 (HTTP ${res.status})`); return; }
            acc = await res.json();
        } catch (err) {
            console.error("Fetch account details failed:", err);
            return;
        }
        if (!acc || !acc.empId) { console.error("帳號明細回傳格式異常 (工號: " + empId + ")"); return; }

        document.getElementById('editAccMode').value = 'edit';
        document.getElementById('accEmpId').value = acc.empId; document.getElementById('accEmpId').disabled = true;
        document.getElementById('accName').value = acc.name || ''; document.getElementById('accDept').value = acc.department || '';
        document.getElementById('accRoleLevel').value = acc.roleLevel || 'user';

        // 編輯 admin 帳號 → 隱藏「管理層級」整個區段（系統預設 admin 是全域管理者，無法降級）
        // 其他被賦予 admin 的帳號仍可顯示層級選單，以便收回權限
        const isSuperAdmin = window.cleanId(acc.empId) === 'admin';
        const lvlGroup = document.getElementById('accRoleLevelGroup');
        if (lvlGroup) lvlGroup.style.display = isSuperAdmin ? 'none' : '';
        document.getElementById('accRoleLevel').disabled = isSuperAdmin;

        document.getElementById('accEnableDelegation').checked = (acc.manageableMenus && acc.manageableMenus.length > 0);
        document.getElementById('accCanEditOthers').checked = acc.canEditOthers || false;

        appState.tempDefaultPages = JSON.parse(JSON.stringify(acc.defaultPages || {}));
        if (typeof renderAccDefaultPagesUI === 'function') renderAccDefaultPagesUI();
        if (typeof renderAccRoleCheckboxes === 'function') renderAccRoleCheckboxes(acc.assignedRoles || []);
        if (typeof renderAccManageMenuCheckboxes === 'function') renderAccManageMenuCheckboxes(acc.manageableMenus || []);
        // 個別覆寫 (per-fab，編輯模式：帶入現有值；後端回傳為 { 廠區名: [menuId] })
        appState.tempExtraMenus = JSON.parse(JSON.stringify(acc.extraMenus || {}));
        appState.tempDenyMenus = JSON.parse(JSON.stringify(acc.denyMenus || {}));
        appState.overrideFab = '';
        if (typeof window.renderAccOverridePanel === 'function') window.renderAccOverridePanel();
        toggleAccDelegationUI(); toggleDelegationDetails();

        showModalSafely('accModal');
    } catch (e) { console.error("[editAccount] 錯誤:", e); }
}

export async function saveAccountItem(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    else if (window.event && typeof window.event.preventDefault === 'function') window.event.preventDefault();

    try {
        const mode = document.getElementById('editAccMode').value; 
        const empId = document.getElementById('accEmpId').value.trim();
        const name = document.getElementById('accName').value.trim(); 
        const dept = document.getElementById('accDept').value.trim();
        const lvl = document.getElementById('accRoleLevel').value;

        let assigned = []; document.querySelectorAll('.acc-role-cb:checked').forEach(cb => assigned.push(cb.value));
        let manageable = []; let canEditOthers = false;
        if (lvl === 'user' && document.getElementById('accEnableDelegation').checked) {
            document.querySelectorAll('.acc-menu-cb:checked').forEach(cb => manageable.push(cb.value));
            canEditOthers = document.getElementById('accCanEditOthers').checked;
        }

        // 個別覆寫 (per-fab)：先把目前畫面廠區的勾選落回 temp，再以「可存取廠區」過濾、剔除空陣列
        if (typeof window.__persistAccOverrideDom === 'function') window.__persistAccOverrideDom();
        const accessibleFabs = (typeof window.__getAccessibleOverrideFabs === 'function')
            ? window.__getAccessibleOverrideFabs().map(window.cleanId)
            : null;
        const pruneOverride = (src) => {
            const out = {};
            if (!src || typeof src !== 'object') return out;
            for (const fab in src) {
                if (!fab) continue;
                if (accessibleFabs && !accessibleFabs.includes(window.cleanId(fab))) continue; // 廠區已不可存取 → 丟棄
                const list = Array.from(new Set((src[fab] || []).filter(Boolean)));
                if (list.length > 0) out[fab] = list;
            }
            return out;
        };
        let extraMenus = pruneOverride(appState.tempExtraMenus);
        let denyMenus = pruneOverride(appState.tempDenyMenus);

        // 工號唯一性改由後端 CreateAccountAsync 把關（回 400「帳號工號已存在」）：
        //   帳號清單 O3 後只剩自己一列、無法本地查重，故移除舊的 getAccounts().some() 前端查重。
        let isNew = (mode !== 'edit');

        const payload = {
            empId: empId,
            name: name,
            department: dept,
            roleLevel: lvl,
            canEditOthers: canEditOthers,
            assignedRoles: assigned,
            manageableMenus: manageable,
            extraMenus: extraMenus,
            denyMenus: denyMenus,
            defaultPages: JSON.parse(JSON.stringify(appState.tempDefaultPages))
        };

        const result = await saveAccountAPI(isNew, payload);
        if (!result.success) {
            customAlert("儲存失敗: " + result.message);
            return false;
        }

        // 儲存成功後，重新從後端拉取全部資料以更新前端記憶體
        await window.fetchInitialDataFromDB();

        hideModalSafely('accModal');
        if (typeof renderAccountTable === 'function') renderAccountTable();

        if (appState.currentUser && window.cleanId(appState.currentUser.id) === window.cleanId(empId)) {
            appState.currentUser.name = name; appState.currentUser.department = dept; appState.currentUser.roleLevel = lvl;
            appState.currentUser.assignedRoles = assigned; appState.currentUser.manageableMenus = manageable;
            appState.currentUser.canEditOthers = canEditOthers; appState.currentUser.defaultPages = JSON.parse(JSON.stringify(appState.tempDefaultPages));
            // 個別覆寫改到自己 → 同步 currentUser，讓 sidebar 立即套用本廠區的 extra/deny
            appState.currentUser.extraMenus = JSON.parse(JSON.stringify(extraMenus));
            appState.currentUser.denyMenus = JSON.parse(JSON.stringify(denyMenus));
            localStorage.setItem('umc_current_user', JSON.stringify(appState.currentUser));

            // 修改到自己的可視群組版面時，立即刷新右上角廠區下拉與側邊欄
            if (typeof renderFabSwitcher === 'function') renderFabSwitcher();
            if (typeof renderSidebarMenus === 'function') renderSidebarMenus();
        }
    } catch (error) { console.error("[saveAccountItem] 錯誤:", error); }
    return false;
}

export async function deleteAccount(empId) {
    try {
        if (window.cleanId(empId) === 'admin') { customAlert('系統預設管理員無法刪除！'); return; }
        customConfirm('確定要刪除此帳號嗎？', async () => {
            const result = await deleteAccountAPI(empId);
            if (!result.success) {
                customAlert("刪除失敗: " + result.message);
                return;
            }

            // 儲存成功後，重新從後端拉取全部資料以更新前端記憶體
            await window.fetchInitialDataFromDB();

            if (typeof renderAccountTable === 'function') renderAccountTable();
        });
    } catch (e) { console.error("[deleteAccount] 錯誤:", e); }
}

export function pickDefaultMenu(menuId) {
    const fab = document.getElementById('pickingForFab').value;
    appState.tempDefaultPages[fab] = menuId;
    if (typeof renderAccDefaultPagesUI === 'function') renderAccDefaultPagesUI();
    const drawerEl = document.getElementById('menuSelectDrawer');
    if (drawerEl) {
        const instance = bootstrap.Offcanvas.getInstance(drawerEl) || bootstrap.Offcanvas.getOrCreateInstance(drawerEl);
        if (instance) instance.hide();
    }
}

export function clearDefaultMenu(fabName) {
    delete appState.tempDefaultPages[fabName];
    if (typeof renderAccDefaultPagesUI === 'function') renderAccDefaultPagesUI();
}

export function toggleAccDelegationUI() {
    const lvl = document.getElementById('accRoleLevel').value;
    const grp = document.getElementById('accDelegationGroup');
    if (grp) grp.style.display = lvl === 'user' ? 'block' : 'none';
}

export function toggleDelegationDetails() {
    const checked = document.getElementById('accEnableDelegation').checked;
    const det = document.getElementById('accDelegationDetails');
    if (det) det.style.display = checked ? 'block' : 'none';
}

// Expose for HTML inline handlers
window.openAddAccountModal = openAddAccountModal;
window.editAccount = editAccount;
window.saveAccountItem = saveAccountItem;
window.deleteAccount = deleteAccount;
window.pickDefaultMenu = pickDefaultMenu;
window.clearDefaultMenu = clearDefaultMenu;
window.toggleAccDelegationUI = toggleAccDelegationUI;
window.toggleDelegationDetails = toggleDelegationDetails;

