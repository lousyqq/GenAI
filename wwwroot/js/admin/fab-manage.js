// === admin/fab-manage.js - 廠區管理 CRUD ===

import { getCustomMenus, getFabs } from '../config.js?v=20260607k';


import { hideModalSafely, showModalSafely } from './modal-utils.js?v=20260607k';
import { deleteFabAPI, fetchInitialDataFromDB, saveFabAPI } from '../api.js?v=20260607k';
import { renderFabTable } from '../render/tables.js?v=20260607k';
import { customAlert, customConfirm } from '../ui/dialogs.js?v=20260607k';
import { appState } from '../store.js?v=20260607k';


// === 權限檢查輔助 ===
export function canManageFolderStructure(folderId) {
    if (!appState.currentUser) return false;
    if (appState.currentUser.roleLevel === 'admin') return true;
    if (!folderId) return true;

    const menus = getCustomMenus();
    const fNode = menus.find(m => window.cleanId(m.id) === window.cleanId(folderId));
    if (!fNode) return true;

    if (window.cleanId(fNode.createdBy) === window.cleanId(appState.currentUser.id)) return true;
    if (appState.currentUser.manageableMenus && appState.currentUser.manageableMenus.some(m => window.cleanId(m) === window.cleanId(folderId))) return true;

    let isUnderDelegated = false;
    let queue = [window.cleanId(folderId)];
    let visited = new Set();
    while (queue.length > 0) {
        let curr = queue.shift();
        if (appState.currentUser.manageableMenus && appState.currentUser.manageableMenus.some(m => window.cleanId(m) === curr)) { isUnderDelegated = true; break; }
        visited.add(curr);
        let m = menus.find(x => window.cleanId(x.id) === curr);
        if (m) {
            let pId = window.cleanId(m.parentId);
            if (pId && pId !== 'null' && !visited.has(pId)) queue.push(pId);
            if (m.parentIds) m.parentIds.forEach(p => {
                let cPid = window.cleanId(p);
                if (cPid && cPid !== 'null' && !visited.has(cPid)) queue.push(cPid);
            });
        }
    }
    return isUnderDelegated;
}

// === Fabs 廠區管理 ===
export function openAddFabModal() {
    try {
        document.getElementById('fabForm').reset();
        document.getElementById('editFabId').value = '';
        document.getElementById('fabNameInput').disabled = false;
        if (typeof renderFabRoleCheckboxes === 'function') renderFabRoleCheckboxes([]);
        showModalSafely('fabModal');
    } catch (e) { console.error("[openAddFabModal] 錯誤:", e); }
}

export function editFab(id) {
    try {
        const fab = getFabs().find(f => window.cleanId(f.id) === window.cleanId(id));
        if (!fab) { console.error("找不到對應的廠區資料 (ID: " + id + ")"); return; }

        document.getElementById('editFabId').value = fab.id;
        document.getElementById('fabNameInput').value = fab.fabName;
        document.getElementById('fabNameInput').disabled = true;
        document.getElementById('fabDisplayNameInput').value = fab.displayName || '';
        document.getElementById('fabLangSelect').value = fab.defaultLang || 'zh';
        if (typeof renderFabRoleCheckboxes === 'function') renderFabRoleCheckboxes(fab.assignedRoles || []);
        showModalSafely('fabModal');
    } catch (e) { console.error("[editFab] 錯誤:", e); }
}

export async function saveFabItem(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    else if (window.event && typeof window.event.preventDefault === 'function') window.event.preventDefault();

    try {
        const id = document.getElementById('editFabId').value;
        const fabName = document.getElementById('fabNameInput').value.trim();
        const displayName = document.getElementById('fabDisplayNameInput').value.trim();
        const lang = document.getElementById('fabLangSelect').value;

        // 一個廠區限選一個群組（radio 單選）；「無」選項 value="" 需過濾掉 → assignedRoles 為 0 或 1 個
        let assignedRoles = [];
        document.querySelectorAll('.fab-role-cb:checked').forEach(cb => { if (cb.value) assignedRoles.push(cb.value); });

        let isNew = !id;
        let fabId = id || ('fab_' + Date.now());

        if (isNew) {
            let fabs = getFabs();
            if (fabs.some(f => window.cleanId(f.fabName) === window.cleanId(fabName))) {
                customAlert('廠區名稱已存在！'); 
                return false; 
            }
        }

        const payload = {
            id: fabId,
            fabName: fabName,
            displayName: displayName || fabName,
            defaultLang: lang,
            assignedRoles: assignedRoles
        };

        const result = await saveFabAPI(isNew, payload);
        if (!result.success) {
            customAlert("儲存失敗: " + result.message);
            return false;
        }

        // 儲存成功後，重新從後端拉取全部資料以更新前端記憶體
        await window.fetchInitialDataFromDB();

        hideModalSafely('fabModal');
        if (typeof renderFabTable === 'function') renderFabTable();
        if (typeof renderFabSwitcher === 'function') renderFabSwitcher();
    } catch (error) { console.error("[saveFabItem] 錯誤:", error); }
    return false;
}

export async function deleteFab(id) {
    try {
        customConfirm('確定要刪除此廠區嗎？', async () => {
            const result = await deleteFabAPI(id);
            if (!result.success) {
                customAlert("刪除失敗: " + result.message);
                return;
            }

            // 儲存成功後，重新從後端拉取全部資料以更新前端記憶體
            await window.fetchInitialDataFromDB();

            if (typeof renderFabTable === 'function') renderFabTable();
            if (typeof renderFabSwitcher === 'function') renderFabSwitcher();
        });
    } catch (e) { console.error("[deleteFab] 錯誤:", e); }
}

// Expose for HTML inline handlers
window.canManageFolderStructure = canManageFolderStructure;
window.openAddFabModal = openAddFabModal;
window.editFab = editFab;
window.saveFabItem = saveFabItem;
window.deleteFab = deleteFab;

