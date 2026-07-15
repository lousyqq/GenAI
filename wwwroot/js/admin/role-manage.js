// === admin/role-manage.js - 群組管理 CRUD ===

import { getCustomMenus, getRoles } from '../config.js?v=20260607k';


import { hideModalSafely, showModalSafely } from './modal-utils.js?v=20260607k';
import { deleteRoleAPI, fetchInitialDataFromDB, saveRoleAPI } from '../api.js?v=20260607k';
import { renderSidebarMenus } from '../render/sidebar.js?v=20260607k';
import { renderAccountTable, renderFabTable, renderRoleTable } from '../render/tables.js?v=20260607k';
import { customAlert, customConfirm } from '../ui/dialogs.js?v=20260607k';

// === Roles 群組管理 ===
export function openAddRoleModal() {
    try {
        document.getElementById('roleForm').reset();
        document.getElementById('editRoleId').value = '';
        const nameEl = document.getElementById('roleName');
        if (nameEl) nameEl.disabled = false;
        if (typeof renderRoleMenuCheckboxes === 'function') renderRoleMenuCheckboxes([]);
        showModalSafely('roleModal');
    } catch (e) { console.error("[openAddRoleModal] 錯誤:", e); }
}

export function editRole(id) {
    try {
        const role = getRoles().find(r => window.cleanId(r.id) === window.cleanId(id));
        if (!role) { console.error("找不到對應的群組資料 (ID: " + id + ")"); return; }

        const isMaster = window.cleanId(role.id) === 'role_1' || (role.groupName || '').includes('12A') || (role.groupName || '').includes('主模組');
        document.getElementById('editRoleId').value = role.id;
        const nameEl = document.getElementById('roleName');
        if (nameEl) {
            nameEl.value = isMaster ? '12A主模組' : role.groupName;
            nameEl.disabled = isMaster;
        }
        if (typeof renderRoleMenuCheckboxes === 'function') renderRoleMenuCheckboxes(role.allowedMenuIds || []);
        showModalSafely('roleModal');
    } catch (e) { console.error("[editRole] 錯誤:", e); }
}

export function toggleRoleMenuSelection(el) {
    const cb = el.querySelector('.role-menu-cb');
    cb.checked = !cb.checked;
    const icon = el.querySelector('.role-check-icon');

    if (cb.checked) {
        el.classList.remove('bg-white', 'text-secondary', 'border-secondary');
        el.classList.add('bg-primary', 'text-white', 'border-primary');
        if (icon) {
            icon.classList.remove('far', 'fa-circle', 'opacity-50');
            icon.classList.add('fas', 'fa-check-circle');
        }
    } else {
        el.classList.remove('bg-primary', 'text-white', 'border-primary');
        el.classList.add('bg-white', 'text-secondary', 'border-secondary');
        if (icon) {
            icon.classList.remove('fas', 'fa-check-circle');
            icon.classList.add('far', 'fa-circle', 'opacity-50');
        }
    }
}

// ⭐️ 核心修復：補回遺失的群組看板渲染邏輯與拖曳排序功能
let rmDragSrcId = null;
let rmDragSrcEl = null;

window.renderRoleMenuCheckboxes = function (selectedIds) {
    if (!selectedIds || !Array.isArray(selectedIds)) selectedIds = [];
    const container = document.getElementById('roleMenuCheckboxes');
    if (!container) return;
    container.innerHTML = '';

    // 過濾出可供綁定的「最上層 (root) 選單」(排除已被停用、或是歸類為池中項目的選單)
    // ⭐ 拖曳排序的結果會顯示在「上方導覽列」，上方只放最上層選單項目；
    //    凡是掛在其他選單底下的子項目 (如 ZE 強化防禦群組底下的 WL子群組、12M EAS 底下的 N-Sys/xHelp) 一律不可出現於此。
    //    注意：DB 的 Menus 表無 ParentId 欄位，api.js 對「有父節點」者只會填 parentIds(陣列) 而非 parentId(常為 undefined)，
    //    故 root 判定必須同時檢查 parentId 與 parentIds，只靠 parentId 會把子項目誤判為 root。
    const menus = getCustomMenus().filter(m => {
        const pid = window.cleanId(m.parentId || m.ParentMenuId || '');
        const pids = (m.parentIds || m.ParentIds || []).map(window.cleanId).filter(x => x && x !== '');
        return (m.enabled !== false && m.IsEnabled !== false) &&
            String(m.isPoolItem || m.IsPoolItem).toLowerCase() !== 'true' &&
            (!pid || pid === '') && pids.length === 0;
    });

    let sortedMenus = [];
    // 1. 已被勾選的按照排序放在最前面
    selectedIds.forEach(id => {
        let m = menus.find(x => window.cleanId(x.id || x.MenuId) === window.cleanId(id));
        if (m) sortedMenus.push(m);
    });
    // 2. 未被勾選的接在後面
    menus.forEach(m => {
        if (!selectedIds.includes(window.cleanId(m.id || m.MenuId))) sortedMenus.push(m);
    });

    let html = [];
    sortedMenus.forEach(m => {
        const mId = window.cleanId(m.id || m.MenuId || '');
        const mDName = m.displayName || m.DisplayName || '';
        const isSelected = selectedIds.includes(mId);

        const bgClass = isSelected ? 'bg-primary text-white border-primary' : 'bg-white text-secondary border-secondary';
        const chkClass = isSelected ? 'fas fa-check-circle' : 'far fa-circle opacity-50';

        html.push(`
            <div class="role-menu-item d-inline-flex align-items-center border rounded px-2 py-1 cursor-pointer shadow-sm ${bgClass}" 
                 style="transition: all 0.2s; font-size: 0.95rem;" draggable="true" 
                 ondragstart="window.rmDragStart(event, '${mId}')" ondragover="window.rmDragOver(event)" ondragleave="window.rmDragLeave(event)" ondrop="window.rmDrop(event, '${mId}')"
                 onclick="toggleRoleMenuSelection(this)">
                <i class="fas fa-grip-vertical me-2 opacity-50" title="拖曳排序" onclick="event.stopPropagation()"></i>
                <i class="role-check-icon ${chkClass} me-1"></i>
                <span class="fw-bold tracking-wide">${mDName}</span>
                <input type="checkbox" class="d-none role-menu-cb" value="${mId}" ${isSelected ? 'checked' : ''}>
            </div>
        `);
    });
    container.innerHTML = html.join('');
};

window.rmDragStart = function (e, id) {
    rmDragSrcId = id;
    rmDragSrcEl = e.target.closest('.role-menu-item');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id); // ⭐️ 必須加上這行，否則現代瀏覽器會直接取消拖曳
    setTimeout(() => { if (rmDragSrcEl) rmDragSrcEl.classList.add('dragging'); }, 0);
};
window.rmDragOver = function (e) {
    e.preventDefault();
    const item = e.target.closest('.role-menu-item');
    if (item && item !== rmDragSrcEl) item.style.borderLeft = '4px solid #dc3545';
};
window.rmDragLeave = function (e) {
    const item = e.target.closest('.role-menu-item');
    if (item) item.style.borderLeft = '';
};
window.rmDrop = function (e, targetId) {
    e.preventDefault();
    e.stopPropagation();
    document.querySelectorAll('.role-menu-item').forEach(el => { el.classList.remove('dragging'); el.style.borderLeft = ''; });
    if (!rmDragSrcId || rmDragSrcId === targetId) return;

    const container = document.getElementById('roleMenuCheckboxes');
    const items = Array.from(container.children);
    const srcEl = items.find(el => window.cleanId(el.querySelector('.role-menu-cb').value) === window.cleanId(rmDragSrcId));
    const targetEl = items.find(el => window.cleanId(el.querySelector('.role-menu-cb').value) === window.cleanId(targetId));

    if (srcEl && targetEl) {
        const srcIdx = items.indexOf(srcEl);
        const tgtIdx = items.indexOf(targetEl);
        if (srcIdx < tgtIdx) targetEl.after(srcEl);
        else targetEl.before(srcEl);
    }
    rmDragSrcId = null;
};

export async function saveRoleItem(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    else if (window.event && typeof window.event.preventDefault === 'function') window.event.preventDefault();

    try {
        const id = document.getElementById('editRoleId').value;
        const name = document.getElementById('roleName').value.trim();

        let allowed = [];
        document.querySelectorAll('.role-menu-item').forEach(el => {
            const cb = el.querySelector('.role-menu-cb');
            if (cb && cb.checked) allowed.push(cb.value);
        });

        let isNew = !id;
        let roleId = id || ('role_' + Date.now());

        const payload = {
            id: roleId,
            groupName: name,
            allowedMenuIds: allowed
        };

        const result = await saveRoleAPI(isNew, payload);
        if (!result.success) {
            customAlert("儲存失敗: " + result.message);
            return false;
        }

        // 儲存成功後，重新從後端拉取全部資料以更新前端記憶體
        await window.fetchInitialDataFromDB();

        hideModalSafely('roleModal');
        if (typeof renderRoleTable === 'function') renderRoleTable();
        if (typeof renderSidebarMenus === 'function') renderSidebarMenus();
    } catch (error) { console.error("[saveRoleItem] 錯誤:", error); }
    return false;
}

export async function deleteRole(id) {
    try {
        if (window.cleanId(id) === 'role_1') {
            customAlert("此為系統固定主選單配置群組 (12A主模組)，不可刪除！");
            return;
        }
        customConfirm('確定要刪除此群組嗎？(若有廠區或帳號綁定此群組將自動解除)', async () => {
            const result = await deleteRoleAPI(id);
            if (!result.success) {
                customAlert("刪除失敗: " + result.message);
                return;
            }

            // 儲存成功後，重新從後端拉取全部資料以更新前端記憶體
            await window.fetchInitialDataFromDB();

            if (typeof renderRoleTable === 'function') renderRoleTable();
            if (typeof renderFabTable === 'function') renderFabTable();
            if (typeof renderAccountTable === 'function') renderAccountTable();
        });
    } catch (e) { console.error("[deleteRole] 錯誤:", e); }
}

// Expose for HTML inline handlers
window.openAddRoleModal = openAddRoleModal;
window.editRole = editRole;
window.toggleRoleMenuSelection = toggleRoleMenuSelection;
window.saveRoleItem = saveRoleItem;
window.deleteRole = deleteRole;

