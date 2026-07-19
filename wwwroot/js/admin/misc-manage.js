// === admin/misc-manage.js - AppGrid + 需求申請 + 審核 + Excel 匯出 + 圖示工具 ===

import { getAppItems, getCustomMenus, getFabs, getPersonalSettings, getRoles, savePersonalSettings } from '../config.js?v=20260719';


import { hideModalSafely, showModalSafely } from './modal-utils.js?v=20260607k';
import { batchSaveMenusAPI, deleteAppAPI, fetchInitialDataFromDB, saveAppAPI, syncDataToDB } from '../api.js?v=20260607k';
import { initDashboardUI } from '../main.js?v=20260719';
import { renderSidebarMenus } from '../render/sidebar.js?v=20260719';
import { renderAppGrid, renderMenuConfigTable, renderPersonalMenuManage, renderWebpageTable } from '../render/tables.js?v=20260719';
import { customAlert, customConfirm, updateSyncButtonUI } from '../ui/dialogs.js?v=20260607k';
import { navTo } from '../ui/navigation.js?v=20260719';
import { appState } from '../store.js?v=20260607k';


// === 拖曳全域輔助 (表格重新排序使用) ===
export function handleDragStart(e, id, parentId) {
    if (e.target.closest('button') || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') { e.preventDefault(); return; }
    appState.dragSrcEl = e.target.closest('tr'); if (!appState.dragSrcEl) return;
    appState.dragSrcId = id; appState.dragSrcParentId = parentId;
    e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id);
    setTimeout(() => { if (appState.dragSrcEl) appState.dragSrcEl.classList.add('dragging'); }, 0);
}
export function handleDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; const tr = e.target.closest('tr'); if (tr && tr !== appState.dragSrcEl && tr.classList.contains('draggable-row')) tr.classList.add('drag-over'); return false; }
export function handleDragLeave(e) { const tr = e.target.closest('tr'); if (tr) tr.classList.remove('drag-over'); }
export function handleDrop(e, targetId, targetParentId, mode) {
    e.stopPropagation(); const tr = e.target.closest('tr'); if (tr) tr.classList.remove('drag-over');
    if (appState.dragSrcEl) appState.dragSrcEl.classList.remove('dragging');
    if (appState.dragSrcId === targetId) return false;

    if (mode === 'system') reorderSystemMenu(appState.dragSrcId, targetId, targetParentId);
    else if (mode === 'webpage') reorderWebpageMenu(appState.dragSrcId, targetId);
    else if (mode === 'personal') reorderPersonalMenu(appState.dragSrcId, targetId, targetParentId);
    return false;
}

export async function reorderSystemMenu(srcId, targetId, parentId) {
    const pId = (!parentId || parentId === 'null') ? null : parentId;
    let menus = getCustomMenus();

    // ⭐️ 核心修復：精準比對，當拖曳的是主選單(Root)時，需採用與 Table 相同的過濾邏輯
    let siblings = [];
    if (pId === null) {
        siblings = menus.filter(m => {
            if (String(m.isPoolItem).toLowerCase() === 'true') return false;
            let hasValidParent = menus.some(pNode => pNode.id !== m.id && (window.isParentMatch(m.parentId, pNode) || (m.parentIds || []).some(pid => window.isParentMatch(pid, pNode))));
            return !hasValidParent;
        });
    } else {
        siblings = menus.filter(m => String(m.isPoolItem).toLowerCase() !== 'true' && (window.cleanId(m.parentId) === window.cleanId(pId) || (m.parentIds && m.parentIds.some(pid => window.cleanId(pid) === window.cleanId(pId)))));
    }

    siblings.sort((a, b) => (a.parentOrders?.[pId] ?? a.order ?? 0) - (b.parentOrders?.[pId] ?? b.order ?? 0));

    const srcIdx = siblings.findIndex(m => window.cleanId(m.id) === window.cleanId(srcId));
    const targetIdx = siblings.findIndex(m => window.cleanId(m.id) === window.cleanId(targetId));
    if (srcIdx > -1 && targetIdx > -1) {
        const [movedItem] = siblings.splice(srcIdx, 1);
        siblings.splice(targetIdx, 0, movedItem);
        const affected = [];
        siblings.forEach((s, idx) => {
            const realMenu = menus.find(x => window.cleanId(x.id) === window.cleanId(s.id));
            if (realMenu) {
                if (pId === null) realMenu.order = idx * 10;
                else {
                    if (!realMenu.parentOrders) realMenu.parentOrders = {};
                    realMenu.parentOrders[pId] = idx * 10;
                }
                affected.push(realMenu);
            }
        });

        // ⭐️ H1 修復：系統版面是「全域共用」設定，拖曳順序只送「異動的看板」走 batch API。
        //    禁止再呼叫 syncDataToDB() 全量覆寫 —— 那會用 admin 過時的 localStorage 快照
        //    把整張 PersonalSettings 表洗掉，導致其他人同時間調整的個人版面遺失。
        //    BatchUpdateMenus 會從 dto 重建 SortOrder 與（admin）ACL，故黑白名單完整保留。
        // 樂觀渲染：先呈現新順序，失敗再重抓 DB 回滾。
        if (typeof renderMenuConfigTable === 'function') renderMenuConfigTable();
        if (typeof renderSidebarMenus === 'function') renderSidebarMenus();

        const result = await batchSaveMenusAPI(affected);
        if (!result || !result.success) {
            if (typeof customAlert === 'function') customAlert('儲存看板順序失敗，已還原為伺服器最新狀態');
            await fetchInitialDataFromDB();
            if (typeof renderMenuConfigTable === 'function') renderMenuConfigTable();
            if (typeof renderSidebarMenus === 'function') renderSidebarMenus();
        }
    }
}

// =====================================================================
// 個人頁面拖曳：兩段式 (Pending → Save)
//   - 拖曳只更新「待儲存」記憶體狀態，不碰 localStorage，不重畫上方導覽列
//   - 右上「儲存變更」按鈕亮起，點下去才呼叫 savePersonalSettings 寫 DB 並重畫 sidebar
//   - 「放棄」按鈕直接清掉 pending 回到 localStorage 既有狀態
//   - 切到別頁再回來、pending 仍會保留（只在分頁關閉或 refresh 時才會清掉）
//
//   getEffectivePersonalSettings(empId)：renderPersonalMenuManage 用此 helper 讀取，
//   有 pending 就用 pending；沒有就退回 localStorage。
// =====================================================================

window._personalPendingPSets = null;     // 待儲存的 pSets 物件 (整份 snapshot)
window._personalPendingDirty = false;    // 是否有未儲存的拖曳變更

window.getEffectivePersonalSettings = function (empId) {
    if (window._personalPendingDirty && window._personalPendingPSets) {
        return window._personalPendingPSets;
    }
    return getPersonalSettings(empId);
};

window.updatePersonalSaveButton = function () {
    const saveBtn = document.getElementById('btn-per-save-pending');
    const discardBtn = document.getElementById('btn-per-discard-pending');
    const countEl = document.getElementById('btn-per-pending-count');
    if (!saveBtn) return;

    if (window._personalPendingDirty) {
        saveBtn.classList.remove('d-none');
        if (discardBtn) discardBtn.classList.remove('d-none');
        // 簡單計算「待儲存改動數」= pending 中跟 localStorage 不同的 order 欄位數
        try {
            const saved = getPersonalSettings(appState.currentUser?.id || '');
            const pending = window._personalPendingPSets || {};
            let diff = 0;
            const keys = new Set([...Object.keys(saved), ...Object.keys(pending)]);
            keys.forEach(k => {
                const a = saved[k]?.order;
                const b = pending[k]?.order;
                if (a !== b) diff++;
            });
            if (countEl) countEl.innerText = diff;
        } catch (e) { /* 計數失敗不要擋住按鈕顯示 */ }
    } else {
        saveBtn.classList.add('d-none');
        if (discardBtn) discardBtn.classList.add('d-none');
    }
};

export function reorderPersonalMenu(srcId, targetId, parentId) {
    const pId = (!parentId || parentId === 'null' || parentId === '') ? null : parentId;

    // 從 effective (pending 或 localStorage) 起手，深拷一份避免污染
    const basePSets = window.getEffectivePersonalSettings(appState.currentUser.id);
    let pSets = JSON.parse(JSON.stringify(basePSets));
    let menus = getCustomMenus();

    let siblings;
    if (pId === null) {
        siblings = menus.filter(m =>
            String(m.isPoolItem || m.IsPoolItem).toLowerCase() !== 'true' &&
            !m.parentId &&
            (!m.parentIds || m.parentIds.length === 0)
        );
    } else {
        siblings = menus.filter(m =>
            window.cleanId(m.parentId) === window.cleanId(pId) ||
            (m.parentIds && m.parentIds.some(pid => window.cleanId(pid) === window.cleanId(pId)))
        );
    }

    siblings.forEach(s => {
        const personalOrder = pSets[s.id] && pSets[s.id].order;
        s.tempOrder = (personalOrder != null) ? personalOrder : (s.order || 999);
    });
    siblings.sort((a, b) => a.tempOrder - b.tempOrder);

    const srcIdx = siblings.findIndex(m => window.cleanId(m.id) === window.cleanId(srcId));
    const targetIdx = siblings.findIndex(m => window.cleanId(m.id) === window.cleanId(targetId));
    if (srcIdx === -1 || targetIdx === -1) return;

    const [movedItem] = siblings.splice(srcIdx, 1);
    siblings.splice(targetIdx, 0, movedItem);
    siblings.forEach((m, idx) => {
        if (!pSets[m.id]) pSets[m.id] = {};
        pSets[m.id].order = idx * 10;
    });

    // 寫入 pending、不碰 localStorage、不重畫 sidebar (上方導覽列保留舊順序)
    window._personalPendingPSets = pSets;
    window._personalPendingDirty = true;

    if (typeof window.updatePersonalSaveButton === 'function') window.updatePersonalSaveButton();
    if (typeof renderPersonalMenuManage === 'function') renderPersonalMenuManage();
    // ⚠️ 故意不呼叫 renderSidebarMenus — 拖曳暫態不要影響上方導覽列
}

// 「儲存變更」按鈕：把 pending 真正寫進 localStorage + DB + 重畫上方導覽列
window.commitPersonalPendingOrder = async function () {
    if (!window._personalPendingDirty || !window._personalPendingPSets) return;
    const pSets = window._personalPendingPSets;

    // ⭐️ H2 修復：savePersonalSettings 現在回傳成功/失敗（不再 throw）。
    //    DB 寫入失敗時保留 pending、提示使用者，避免假報成功又清掉未存的拖曳。
    const ok = await savePersonalSettings(appState.currentUser.id, pSets);
    if (!ok) {
        if (typeof customAlert === 'function') customAlert('儲存失敗，請稍後再試');
        return;
    }

    window._personalPendingPSets = null;
    window._personalPendingDirty = false;

    if (typeof window.updatePersonalSaveButton === 'function') window.updatePersonalSaveButton();
    if (typeof renderPersonalMenuManage === 'function') renderPersonalMenuManage();
    if (typeof renderSidebarMenus === 'function') renderSidebarMenus();

    if (typeof customAlert === 'function') customAlert('已儲存個人版面順序，並同步到上方導覽列');
};

// 「放棄」按鈕：清掉 pending、回到 localStorage 既有狀態
window.discardPersonalPendingOrder = function () {
    if (!window._personalPendingDirty) return;
    if (typeof customConfirm === 'function') {
        customConfirm('放棄這次的拖曳變更？', () => {
            window._personalPendingPSets = null;
            window._personalPendingDirty = false;
            if (typeof window.updatePersonalSaveButton === 'function') window.updatePersonalSaveButton();
            if (typeof renderPersonalMenuManage === 'function') renderPersonalMenuManage();
        });
    } else {
        window._personalPendingPSets = null;
        window._personalPendingDirty = false;
        if (typeof window.updatePersonalSaveButton === 'function') window.updatePersonalSaveButton();
        if (typeof renderPersonalMenuManage === 'function') renderPersonalMenuManage();
    }
};

export async function reorderWebpageMenu(srcId, targetId) {
    let menus = getCustomMenus();
    const srcIdx = menus.findIndex(m => window.cleanId(m.id) === window.cleanId(srcId));
    const targetIdx = menus.findIndex(m => window.cleanId(m.id) === window.cleanId(targetId));
    if (srcIdx > -1 && targetIdx > -1) {
        // 拖曳前先快照各看板的舊 order，事後只送真正異動的看板
        const oldOrderMap = new Map(menus.map(m => [m.id, m.order]));

        const [movedItem] = menus.splice(srcIdx, 1);
        menus.splice(targetIdx, 0, movedItem);
        menus.forEach((m, idx) => m.order = idx * 10);

        const affected = menus.filter(m => oldOrderMap.get(m.id) !== m.order);

        // ⭐️ H1 修復：同系統版面，只送異動看板走 batch API，不再 syncDataToDB() 全量覆寫
        //    （避免用過時 localStorage 洗掉所有人的 PersonalSettings）。
        // 樂觀渲染：先呈現新順序，失敗再重抓 DB 回滾。
        if (typeof renderWebpageTable === 'function') renderWebpageTable();
        if (typeof renderMenuConfigTable === 'function') renderMenuConfigTable();
        if (typeof renderSidebarMenus === 'function') renderSidebarMenus();

        if (affected.length > 0) {
            const result = await batchSaveMenusAPI(affected);
            if (!result || !result.success) {
                if (typeof customAlert === 'function') customAlert('儲存看板順序失敗，已還原為伺服器最新狀態');
                await fetchInitialDataFromDB();
                if (typeof renderWebpageTable === 'function') renderWebpageTable();
                if (typeof renderMenuConfigTable === 'function') renderMenuConfigTable();
                if (typeof renderSidebarMenus === 'function') renderSidebarMenus();
            }
        }
    }
}

// === App Grid ===
export function openAppGridPage(menuId, title, element) {
    appState.currentAppGridMenuId = menuId;
    document.getElementById('app-grid-title').innerText = title || '應用集合';
    if (typeof navTo === 'function') navTo('page-app-grid', element, title);
    const apps = getAppItems().filter(a => window.cleanId(a.menuId) === window.cleanId(menuId));
    if (typeof renderAppGrid === 'function') renderAppGrid('app-grid-container', apps);
}

export function openAppGridModal(id = null) {
    try {
        document.getElementById('appForm').reset();
        document.getElementById('appIdInput').value = id || '';
        document.getElementById('appIconPreview').style.display = 'none';
        document.getElementById('appIconPreview').src = '';

        if (id) {
            const app = getAppItems().find(a => window.cleanId(a.id) === window.cleanId(id));
            if (app) {
                document.getElementById('appName').value = app.name;
                document.getElementById('appUrl').value = app.url;
                document.getElementById('appTarget').value = app.target || '_blank';
                if (app.iconBase64) {
                    document.getElementById('appIconPreview').style.display = 'block';
                    document.getElementById('appIconPreview').src = app.iconBase64;
                }
            }
        }
        showModalSafely('appGridModal');
    } catch (e) { console.error("[openAppGridModal] 錯誤:", e); }
}

export async function saveAppItem(e) {
    // ⭐️ 核心防重整
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    else if (window.event && typeof window.event.preventDefault === 'function') window.event.preventDefault();

    try {
        const id = document.getElementById('appIdInput').value;
        const name = document.getElementById('appName').value.trim();
        const url = document.getElementById('appUrl').value.trim();
        const target = document.getElementById('appTarget').value;
        const iconSrc = document.getElementById('appIconPreview').src;
        const finalIcon = document.getElementById('appIconPreview').style.display === 'block' ? iconSrc : '';

        let apps = getAppItems();
        let appData;
        let isNew = false;
        
        if (id) {
            let idx = apps.findIndex(a => window.cleanId(a.id) === window.cleanId(id));
            if (idx > -1) { 
                apps[idx].name = name; apps[idx].appName = name; apps[idx].AppName = name;
                apps[idx].url = url; apps[idx].Url = url;
                apps[idx].target = target; apps[idx].Target = target;
                apps[idx].iconBase64 = finalIcon; apps[idx].IconBase64 = finalIcon; 
                appData = apps[idx];
            }
        } else {
            isNew = true;
            appData = { 
                id: 'app_' + Date.now(), AppId: 'app_' + Date.now(),
                menuId: appState.currentAppGridMenuId, MenuId: appState.currentAppGridMenuId,
                name: name, appName: name, AppName: name,
                url: url, Url: url,
                target: target, Target: target,
                iconBase64: finalIcon, IconBase64: finalIcon 
            };
            apps.push(appData);
        }

        // App 一律走 RESTful saveAppAPI（靜態 import，必為 function）；不再有 syncDataToDB 全量覆寫後備。
        if (appData) {
            let result = await saveAppAPI(isNew, appData);
            if (!result.success) {
                if (typeof customAlert === 'function') customAlert("儲存失敗: " + result.message);
                else alert("儲存失敗: " + result.message);
                return false;
            }
        }

        hideModalSafely('appGridModal');
        try { await window.fetchInitialDataFromDB(); } catch (e) { console.error('fetchInitialDataFromDB 失敗', e); }
        if (appState.currentAppGridMenuId && typeof renderAppGrid === 'function') renderAppGrid('app-grid-container', getAppItems().filter(a => window.cleanId(a.menuId) === window.cleanId(appState.currentAppGridMenuId)));

    } catch (error) { console.error("[saveAppItem] 錯誤:", error); }
    return false;

}

export function deleteAppItem(id) {
    try {
        customConfirm('確定要刪除此 APP 嗎？', async () => {
            let apps = getAppItems().filter(a => window.cleanId(a.id) !== window.cleanId(id));
            window.appState.apps = apps;

            // App 刪除一律走 RESTful deleteAppAPI（靜態 import，必為 function）；不再有 syncDataToDB 後備。
            let result = await deleteAppAPI(id);
            if (!result.success) {
                if (typeof customAlert === 'function') customAlert("刪除失敗: " + result.message);
                else alert("刪除失敗: " + result.message);
                return false;
            }

            try { await window.fetchInitialDataFromDB(); } catch (e) { console.error('fetchInitialDataFromDB 失敗', e); }
            if (appState.currentAppGridMenuId && typeof renderAppGrid === 'function') renderAppGrid('app-grid-container', getAppItems().filter(a => window.cleanId(a.menuId) === window.cleanId(appState.currentAppGridMenuId)));
        });
    } catch (e) { console.error("[deleteAppItem] 錯誤:", e); }
}

export function handleAppIconUpload(e) {
    const file = e.target.files[0];
    if (file) {
        compressImageFile(file, function (base64Str) {
            if (base64Str.length > 190000) {
                customAlert("圖檔過於龐大或複雜，壓縮後仍超過資料庫與快取安全大小 (190KB)，請更換較簡單的圖標或選用較小尺寸。");
                document.getElementById('appIconPreview').style.display = 'none';
                e.target.value = '';
            } else {
                document.getElementById('appIconPreview').src = base64Str;
                document.getElementById('appIconPreview').style.display = 'block';
            }
        });
    }
}



// === Excel 匯出備份（對齊 TEST_20260429.html:2186-2259）===
// ⚠️ O3 重構後 getAccounts()（appState.accounts）只回呼叫者自己一列，無法用來匯出全部帳號。
//    故帳號相關 sheet 一律改打 admin-only 的 GET /api/Accounts/export 取完整明細（async）。
export async function createWorkbookData() {
    if (typeof XLSX === 'undefined') { customAlert('SheetJS 套件未載入'); return null; }
    const wb = XLSX.utils.book_new();

    const appendSafeData = (data, sheetName) => {
        if (!data || data.length === 0) {
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{}]), sheetName);
            return;
        }
        const safeData = data.map(item => {
            let processed = {};
            for (let key in item) {
                let val = item[key];
                let finalStr = (typeof val === 'object' && val !== null) ? JSON.stringify(val) : (val !== undefined ? String(val) : '');
                if (finalStr.length > 32700) {
                    processed[key] = finalStr.startsWith('data:image') ? '' : (finalStr.substring(0, 32700) + '...');
                } else {
                    processed[key] = finalStr;
                }
            }
            return processed;
        });
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(safeData), sheetName);
    };

    const menus = getCustomMenus();
    const fabs = getFabs();
    const roles = getRoles();
    // 帳號清單走 server-side 全量匯出端點（admin-only）；含 assignedRoles/manageableMenus/defaultPages/canEditOthers。
    let accs = [];
    try {
        const resp = await fetch('/api/Accounts/export', { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        accs = await resp.json();
        if (!Array.isArray(accs)) accs = [];
    } catch (e) {
        console.error('[createWorkbookData] 取得帳號匯出資料失敗:', e);
        if (typeof customAlert === 'function') customAlert('取得帳號清單失敗，匯出已取消：' + (e.message || e));
        return null;
    }
    const apps = getAppItems();

    appendSafeData(menus.map(m => ({ MenuId: m.id, SysName: m.name, DisplayName: m.displayName, MenuMode: m.menuMode, Url: m.url || '', TargetPage: m.targetPage || '', OpenTarget: m.target || '', Icon: m.icon || '', CreatedBy: m.createdBy || 'admin', IsEnabled: m.enabled !== false, IsPoolItem: m.isPoolItem === true, IsEdited: m.isEdited === true, GlobalOrder: m.order || 0 })), "Menus");
    appendSafeData(fabs.map(f => ({ FabId: f.id, FabName: f.fabName, DisplayName: f.displayName, DefaultLang: f.defaultLang || 'zh' })), "Fabs");
    appendSafeData(roles.map(r => ({ RoleId: r.id, GroupName: r.groupName })), "Roles");
    appendSafeData(accs.map(a => ({ EmpId: a.empId, Name: a.name, Department: a.department || '', RoleLevel: a.roleLevel || 'user', CanEditOthers: a.canEditOthers === true })), "Accounts");
    appendSafeData(apps.map(a => ({ AppId: a.id, MenuId: a.menuId, AppName: a.name, Url: a.url || '', IconBase64: a.iconBase64 || '', Target: a.target || '_blank' })), "Apps");

    let mapFabRole = []; fabs.forEach(f => { if (f.assignedRoles) f.assignedRoles.forEach(rId => mapFabRole.push({ FabId: f.id, RoleId: rId })); });
    appendSafeData(mapFabRole.length ? mapFabRole : [{ FabId: '', RoleId: '' }], "Map_Fab_Role");

    let mapAccRole = []; accs.forEach(a => { if (a.assignedRoles) a.assignedRoles.forEach(rId => mapAccRole.push({ EmpId: a.empId, RoleId: rId })); });
    appendSafeData(mapAccRole.length ? mapAccRole : [{ EmpId: '', RoleId: '' }], "Map_Account_Role");

    let mapAccMenu = []; accs.forEach(a => { if (a.manageableMenus) a.manageableMenus.forEach(mId => mapAccMenu.push({ EmpId: a.empId, MenuId: mId })); });
    appendSafeData(mapAccMenu.length ? mapAccMenu : [{ EmpId: '', MenuId: '' }], "Map_Account_ManageMenu");

    let mapRoleMenu = []; roles.forEach(r => { if (r.allowedMenuIds) r.allowedMenuIds.forEach((mId, idx) => mapRoleMenu.push({ RoleId: r.id, MenuId: mId, SortOrder: idx * 10 })); });
    appendSafeData(mapRoleMenu.length ? mapRoleMenu : [{ RoleId: '', MenuId: '', SortOrder: '' }], "Map_Role_Menu");

    let mapMenuStruct = []; menus.forEach(m => {
        if (m.parentIds && m.parentIds.length > 0) {
            m.parentIds.forEach(pId => mapMenuStruct.push({ ParentMenuId: pId, ChildMenuId: m.id, SortOrder: m.parentOrders ? (m.parentOrders[pId] || 0) : 0 }));
        } else if (m.parentId) {
            mapMenuStruct.push({ ParentMenuId: m.parentId, ChildMenuId: m.id, SortOrder: m.order || 0 });
        }
    });
    appendSafeData(mapMenuStruct.length ? mapMenuStruct : [{ ParentMenuId: '', ChildMenuId: '', SortOrder: '' }], "Map_Menu_Structure");

    let mapAccDefPage = []; accs.forEach(a => { if (a.defaultPages) { for (let fab in a.defaultPages) { mapAccDefPage.push({ EmpId: a.empId, FabId: fab, MenuId: a.defaultPages[fab] }); } } });
    appendSafeData(mapAccDefPage.length ? mapAccDefPage : [{ EmpId: '', FabId: '', MenuId: '' }], "Map_Account_DefaultPage");

    // ⚠️ 不再匯出 PersonalSettings sheet：自訂版面已是 per-user RESTful-only（/api/PersonalSettings），
    //    不在 Excel 全量覆寫的 round-trip 內 —— 匯入端 processAndSaveWorkbook 也從不讀此 sheet。
    //    O3 後 localStorage 只快取登入者自己一份，硬匯出只會得到「殘缺＋無法還原」的 admin 個人版面，
    //    純屬誤導，故移除。個人版面備份/還原請走 DB（PersonalSettings 表）。

    return wb;
}

// admin 從 SSMS 直接改 DB 後，按這顆讓後端立刻清掉 InitialData 60 秒快取
//   實際刷新 = 清快取 + 強制 fetchInitialDataFromDB() 重新拉，appState 立刻換成 DB 最新值
export async function refreshServerCache() {
    if (!appState.currentUser || String(appState.currentUser.roleLevel || '').toLowerCase() !== 'admin') {
        if (typeof customAlert === 'function') customAlert('僅管理員可執行此操作');
        return;
    }
    try {
        const resp = await fetch('/Settings/RefreshCache', { method: 'POST' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = await resp.json();
        if (!data.success) throw new Error(data.message || '後端拒絕');

        // 立刻重抓最新資料 + 重渲染（不需要使用者手動 F5）
        if (typeof window.fetchInitialDataFromDB === 'function') {
            await window.fetchInitialDataFromDB();
        }
        if (typeof initDashboardUI === 'function') initDashboardUI();
        if (typeof customAlert === 'function') {
            customAlert('已清空快取並重新載入。<br><span class="small text-muted">⚠️ 若改了 RoleLevel，使用者需登出再登入才會生效。</span>', true);
        }
    } catch (e) {
        if (typeof customAlert === 'function') customAlert('清快取失敗：' + (e.message || e));
    }
}
window.refreshServerCache = refreshServerCache;

export async function exportConfig() {
    try {
        const wb = await createWorkbookData();
        if (!wb) return;
        XLSX.writeFile(wb, "GenAI_Setting.xlsx");
    } catch (e) {
        console.error("[exportConfig] 錯誤:", e);
        if (typeof customAlert === 'function') customAlert("匯出 Excel 失敗：" + e.message);
    }
}
window.exportConfig = exportConfig;
window.createWorkbookData = createWorkbookData;

// === Icon Helpers ===
export function handleIconSelectChange(prefix) {
    const sel = document.getElementById(prefix + 'Icon');
    const fileInput = document.getElementById(prefix + 'IconFile');
    if (sel.value === 'custom') { fileInput.style.display = 'block'; } else { fileInput.style.display = 'none'; }
}

export function getSelectedIconVal(prefix) {
    let val = document.getElementById(prefix + 'Icon').value;
    if (val === 'custom') { return document.getElementById(prefix + 'CustomIconBase64').value || ''; }
    return val;
}

export function setIconValToModal(prefix, iconVal) {
    // 自訂圖（custom）= data: URI（剛上傳）或任何含 '/' 的路徑（/images/icons/... 實體檔、舊 icon/...）；FA class 永不含 '/'
    if (iconVal && (iconVal.startsWith('data:') || iconVal.includes('/'))) {
        document.getElementById(prefix + 'Icon').value = 'custom';
        document.getElementById(prefix + 'IconFile').style.display = 'block';
        document.getElementById(prefix + 'CustomIconBase64').value = iconVal;
    } else {
        document.getElementById(prefix + 'Icon').value = iconVal || '';
        document.getElementById(prefix + 'IconFile').style.display = 'none';
        document.getElementById(prefix + 'CustomIconBase64').value = '';
    }
}

export function compressImageFile(file, callback) {
    if (!file) { if (callback) callback(''); return; }
    const reader = new FileReader();
    reader.onload = function (e) {
        const rawBase64 = e.target.result || '';
        // ⭐️ 智慧判定：若是 SVG 向量圖、ICO 系統圖標，或小於 100KB 的小型透明圖，直接使用原始 Base64（保持完美向量畫質與圓角去背）
        if (file.type === 'image/svg+xml' || file.type === 'image/x-icon' || (file.size < 100000 && (file.type === 'image/png' || file.type === 'image/webp'))) {
            if (callback) callback(rawBase64);
            return;
        }
        const img = new Image();
        img.onload = function () {
            try {
                const canvas = document.createElement('canvas');
                // ⭐️ 提升最大長寬至 256px：確保高解析投影屏、大螢幕顯示極致清晰無鋸齒，且 Base64 體積依然小巧
                const MAX_SIZE = 256;
                let width = img.width || MAX_SIZE;
                let height = img.height || MAX_SIZE;
                if (width > height) {
                    if (width > MAX_SIZE) { height = Math.round(height * (MAX_SIZE / width)); width = MAX_SIZE; }
                } else {
                    if (height > MAX_SIZE) { width = Math.round(width * (MAX_SIZE / height)); height = MAX_SIZE; }
                }
                canvas.width = Math.max(1, width);
                canvas.height = Math.max(1, height);
                const ctx = canvas.getContext('2d');

                // ⭐️ 透明度去背保留：
                // 若為 PNG/WebP/GIF 等透明圖格式，切勿填白色背景，並改以 image/webp (或 image/png) 輸出，保持圓角去背不變黑
                const isTransparent = file.type.includes('png') || file.type.includes('webp') || file.type.includes('gif');
                let outputType = 'image/jpeg';
                let quality = 0.82;

                if (isTransparent) {
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    outputType = 'image/webp'; // WebP 支援完整透明度且體積比 PNG 節省 40%~60%
                } else {
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                }

                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                let compressed = canvas.toDataURL(outputType, quality);
                // 如果瀏覽器把 WebP 轉得比預計大（或者不支援 WebP 轉成了 PNG/JPEG），做尺寸與品質保險
                if (isTransparent && compressed.length > 190000 && outputType === 'image/webp') {
                    compressed = canvas.toDataURL('image/png');
                }
                // 最終保險：若壓縮後字串反而比原始 Base64 還長，取較小值輸出
                const finalStr = (compressed.length < rawBase64.length && compressed.length > 50) ? compressed : rawBase64;
                if (callback) callback(finalStr);
            } catch (err) {
                console.warn('[compressImageFile] Canvas 壓縮發生異常，降級回傳原始 Base64:', err);
                if (callback) callback(rawBase64);
            }
        };
        img.onerror = function () {
            console.warn('[compressImageFile] 圖片物件載入失敗，直接回傳原始 Base64');
            if (callback) callback(rawBase64);
        };
        img.src = rawBase64;
    };
    reader.onerror = function () {
        console.error('[compressImageFile] 讀取檔案失敗');
        if (callback) callback('');
    };
    reader.readAsDataURL(file);
}

// === Excel 手動匯入與解析 ===
export async function importConfig() {
    const fileInput = document.getElementById('configFile'); const file = fileInput.files[0];
    if (!file) return customAlert("請先選擇 Excel 檔案！");

    // ⚠️ O-extra：Excel 匯入會以檔案內容「全量覆寫」DB（DELETE→INSERT 大部分資料表），
    //    為不可逆的破壞性操作，匯入前必須二次確認，避免誤點。
    customConfirm('匯入 Excel 會以檔案內容「全量覆寫」資料庫設定（看板、廠區、角色、帳號等），此動作無法復原。確定要繼續嗎？', () => {
        runImportConfig(fileInput, file);
    });
}

// 實際執行匯入流程（已通過二次確認後才呼叫）
function runImportConfig(fileInput, file) {
    // 立即顯示載入中遮罩，防止 UI 卡死
    let loadingOverlay = document.getElementById('importLoadingOverlay');
    if (!loadingOverlay) {
        loadingOverlay = document.createElement('div');
        loadingOverlay.id = 'importLoadingOverlay';
        loadingOverlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:9999; display:flex; flex-direction:column; justify-content:center; align-items:center; color:white; font-family:sans-serif;';
        loadingOverlay.innerHTML = '<div class="spinner-border text-info mb-3" style="width: 3rem; height: 3rem;"></div><h2>正在讀取 Excel...</h2><p class="text-secondary">檔案較大時可能需要幾秒鐘，請稍候</p>';
        document.body.appendChild(loadingOverlay);
    }

    // 利用 setTimeout 讓瀏覽器有時間把 Loading 畫面畫出來，再進行高 CPU 耗時的 XLSX 讀取
    setTimeout(() => {
        const reader = new FileReader();
        reader.onload = async function (e) {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });

                // 讀取完畢後，切換文字為「準備同步...」，接著 processAndSaveWorkbook 內部會呼叫 syncDataToDB 並自帶它的 loading 畫面
                if(loadingOverlay) loadingOverlay.querySelector('h2').innerText = '準備同步...';
                
                await processAndSaveWorkbook(workbook, true);

                fileInput.value = '';
                if(loadingOverlay) loadingOverlay.remove();
                
                // 匯入完畢後，提示並在背景重新載入最新資料，避免畫面閃爍
                customAlert("匯入成功！系統即將無縫載入新資料。");
                setTimeout(async () => {
                    try {
                        if (typeof window.fetchInitialDataFromDB === 'function') {
                            await window.fetchInitialDataFromDB();
                            if (typeof window.initDashboardUI === 'function') window.initDashboardUI(true);
                        } else {
                            location.reload();
                        }
                    } catch (e) {
                        location.reload();
                    }
                }, 1000);
            } catch (err) {
                console.error(err);
                if(loadingOverlay) loadingOverlay.remove();
                customAlert("匯入失敗，格式錯誤或網路異常。");
            }
        };
        reader.readAsArrayBuffer(file);
    }, 50);
}

export async function processAndSaveWorkbook(workbook, isManualImport = false) {
    const getSheetData = (sheetName) => {
        if (!workbook.Sheets[sheetName]) return [];
        // 移除 defval: '' 以避免 SheetJS 強制輸出數百萬筆幽靈空列，並進一步過濾全空列
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
        return rows.filter(row => Object.values(row).some(v => v !== null && v !== undefined && String(v).trim() !== ''));
    };

    const rawMenus = getSheetData("Menus"); const rawFabs = getSheetData("Fabs"); const rawRoles = getSheetData("Roles");
    const rawAccs = getSheetData("Accounts"); const rawApps = getSheetData("Apps"); const rawReqs = getSheetData("Requests");

    // 判斷是否為 V2 格式：檢查任意一個 V2 專有欄位 (例如 Menus 的 MenuId 或 Accounts 的 EmpId)
    const isV2Format = (rawAccs.length > 0 && rawAccs[0].hasOwnProperty("EmpId")) || 
                       (rawMenus.length > 0 && rawMenus[0].hasOwnProperty("MenuId")) ||
                       (rawRoles.length > 0 && rawRoles[0].hasOwnProperty("RoleId"));

    if (isV2Format) {
        const mapFabRole = getSheetData("Map_Fab_Role"); const mapAccRole = getSheetData("Map_Account_Role");
        const mapAccMenu = getSheetData("Map_Account_ManageMenu"); const mapRoleMenu = getSheetData("Map_Role_Menu");
        const mapMenuStruct = getSheetData("Map_Menu_Structure"); const mapAccDefPage = getSheetData("Map_Account_DefaultPage");

        const finalAccs = rawAccs.filter(r => r.EmpId).map(row => {
            let empId = String(row.EmpId); let defPages = {};
            mapAccDefPage.filter(m => window.cleanId(m.EmpId) === window.cleanId(empId) && m.FabId && m.MenuId).forEach(m => { defPages[String(m.FabId)] = String(m.MenuId); });
            return {
                empId: empId, name: row.Name || '', department: row.Department || '',
                roleLevel: (row.RoleLevel || 'user').toLowerCase(),
                canEditOthers: String(row.CanEditOthers).toLowerCase() === 'true',
                defaultPages: defPages,
                assignedRoles: mapAccRole.filter(m => window.cleanId(m.EmpId) === window.cleanId(empId) && m.RoleId).map(m => String(m.RoleId)),
                manageableMenus: mapAccMenu.filter(m => window.cleanId(m.EmpId) === window.cleanId(empId) && m.MenuId).map(m => String(m.MenuId))
            };
        });

        const finalFabs = rawFabs.filter(r => r.FabId).map(row => {
            let fabId = String(row.FabId);
            return { id: fabId, fabName: row.FabName || fabId, displayName: row.DisplayName || '', defaultLang: (row.DefaultLang || 'zh').toLowerCase(), assignedRoles: mapFabRole.filter(m => window.cleanId(m.FabId) === window.cleanId(fabId) && m.RoleId).map(m => String(m.RoleId)) };
        });

        const finalRoles = rawRoles.filter(r => r.RoleId).map(row => {
            let roleId = String(row.RoleId);
            let allowed = mapRoleMenu.filter(m => window.cleanId(m.RoleId) === window.cleanId(roleId) && m.MenuId).sort((a, b) => parseInt(a.SortOrder || 0) - parseInt(b.SortOrder || 0)).map(m => String(m.MenuId));
            return { id: roleId, groupName: row.GroupName || '', allowedMenuIds: allowed };
        });

        const finalMenus = rawMenus.filter(r => r.MenuId).map(row => {
            let mId = String(row.MenuId);
            let m = { id: mId, name: row.SysName || '', displayName: row.DisplayName || '', menuMode: row.MenuMode || 'link', url: row.Url || '', targetPage: row.TargetPage || '', target: row.OpenTarget || 'iframe', icon: row.Icon || '', createdBy: row.CreatedBy || 'admin', enabled: String(row.IsEnabled).toLowerCase() !== 'false', isPoolItem: String(row.IsPoolItem).toLowerCase() === 'true', isEdited: String(row.IsEdited).toLowerCase() === 'true', order: parseInt(row.GlobalOrder || 0), parentId: null, parentIds: [], parentOrders: {} };
            let parents = mapMenuStruct.filter(s => window.cleanId(s.ChildMenuId) === window.cleanId(mId) && s.ParentMenuId);
            if (parents.length > 0) { m.parentId = String(parents[0].ParentMenuId); m.parentIds = parents.map(p => String(p.ParentMenuId)); parents.forEach(p => { m.parentOrders[String(p.ParentMenuId)] = parseInt(p.SortOrder || 0); }); }
            return m;
        });

        let finalApps = [];
        if (rawApps.length > 0) {
            finalApps = rawApps.filter(r => r.AppId || r.id).map(row => ({
                id: String(row.AppId || row.id || ''), menuId: String(row.MenuId || row.menuId || ''),
                name: row.AppName || row.name || '', url: row.Url || row.url || '',
                iconBase64: row.IconBase64 || row.iconBase64 || '', target: row.Target || row.target || '_blank'
            }));
        }

        let finalReqs = [];
        if (rawReqs.length > 0) {
            finalReqs = rawReqs.filter(r => r.RequestId || r.id).map(row => ({
                id: String(row.RequestId || row.id), empId: String(row.EmpId || row.empId),
                empName: row.EmpName || row.empName || '', reason: row.Reason || row.reason || '',
                timestamp: row.Timestamp || row.timestamp, status: row.Status || row.status || 'unreplied',
                withdrawReason: row.WithdrawReason || row.withdrawReason || '', reply: row.Reply || row.reply || ''
            }));
        }

        if (typeof window.appState !== 'undefined') {
            window.appState.accounts = finalAccs;
            window.appState.fabs = finalFabs;
            window.appState.roles = finalRoles;
            window.appState.menus = finalMenus;
            window.appState.apps = finalApps;
            window.appState.requests = finalReqs;
        }

    } else {
        const parseVal = (val) => {
            if (typeof val === 'string' && (val.startsWith('[') || val.startsWith('{'))) { try { return JSON.parse(val); } catch (err) { return val; } }
            else if (val === 'true' || val === 'TRUE') return true;
            else if (val === 'false' || val === 'FALSE') return false;
            return val;
        };

        const oldMenus = rawMenus.filter(r => r.id).map(row => { let p = {}; for (let k in row) p[k] = parseVal(row[k]); return p; });
        const oldFabs = rawFabs.filter(r => r.id).map(row => { let p = {}; for (let k in row) p[k] = parseVal(row[k]); return p; });
        const oldRoles = rawRoles.filter(r => r.id).map(row => { let p = {}; for (let k in row) p[k] = parseVal(row[k]); return p; });
        const oldAccs = rawAccs.filter(r => r.empId).map(row => { let p = {}; for (let k in row) p[k] = parseVal(row[k]); return p; });
        const oldApps = rawApps.filter(r => r.id).map(row => { let p = {}; for (let k in row) p[k] = parseVal(row[k]); return p; });
        const oldReqs = rawReqs.filter(r => r.id).map(row => { let p = {}; for (let k in row) p[k] = parseVal(row[k]); return p; });

        if (typeof window.appState !== 'undefined') {
            window.appState.menus = oldMenus;
            window.appState.fabs = oldFabs;
            window.appState.roles = oldRoles;
            window.appState.accounts = oldAccs;
            window.appState.apps = oldApps;
            window.appState.requests = oldReqs;
        }
    }

    if (isManualImport) {
        appState.hasUnsavedChanges = false;
        if (typeof updateSyncButtonUI === 'function') updateSyncButtonUI();

        if (typeof syncDataToDB === 'function') {
            await syncDataToDB(true); // Excel 匯入時要顯示 loading 與完成訊息
            if (typeof initDashboardUI === 'function') initDashboardUI(true);
        }
    } else {
        appState.hasUnsavedChanges = false;
        if (typeof updateSyncButtonUI === 'function') updateSyncButtonUI();
    }
}

// Expose for HTML inline handlers
window.handleDragStart = handleDragStart;
window.handleDragOver = handleDragOver;
window.handleDragLeave = handleDragLeave;
window.handleDrop = handleDrop;
window.reorderSystemMenu = reorderSystemMenu;
window.reorderPersonalMenu = reorderPersonalMenu;
window.reorderWebpageMenu = reorderWebpageMenu;
// removed dup
window.openAppGridPage = openAppGridPage;
window.openAppGridModal = openAppGridModal;
window.saveAppItem = saveAppItem;
window.deleteAppItem = deleteAppItem;
window.handleAppIconUpload = handleAppIconUpload;
window.createWorkbookData = createWorkbookData;
window.refreshServerCache = refreshServerCache;
window.exportConfig = exportConfig;
window.handleIconSelectChange = handleIconSelectChange;
window.getSelectedIconVal = getSelectedIconVal;
window.setIconValToModal = setIconValToModal;
window.compressImageFile = compressImageFile;
window.importConfig = importConfig;
window.processAndSaveWorkbook = processAndSaveWorkbook;

