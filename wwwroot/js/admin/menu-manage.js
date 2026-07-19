// === admin/menu-manage.js - 個人選單 + 看板管理 + 選單結構樹 ===

import { getCustomMenus, getPersonalSettings, savePersonalSettings, t } from '../config.js?v=20260719';


import { getSelectedIconVal, setIconValToModal } from './misc-manage.js?v=20260607k';
import { hideModalSafely, showModalSafely } from './modal-utils.js?v=20260607k';
import { batchDeleteMenusAPI, batchSaveMenusAPI, deleteMenuAPI, fetchInitialDataFromDB, saveMenuAPI } from '../api.js?v=20260607k';
import { renderSidebarMenus } from '../render/sidebar.js?v=20260719';
import { renderMenuConfigTable, renderPersonalMenuManage, renderWebpageTable } from '../render/tables.js?v=20260719';
import { customAlert, customConfirm } from '../ui/dialogs.js?v=20260607k';
import { appState } from '../store.js?v=20260607k';


// 共用工具：把 ACL textarea 內容切行、trim、過濾空字串、去重
window.__parseAclTextarea = function (txt) {
    if (!txt) return [];
    return txt.split(/[\n,;]+/)             // 容忍逗號 / 分號 / 換行
              .map(s => s.trim())
              .filter(Boolean)
              .filter((v, i, a) => a.indexOf(v) === i);
};

// === Personal Menus 個人選單（對齊 TEST_20260429.html:3744-3771）===
export function togglePerMenuExpand(id) {
    if (appState.expandedPerMenuIds.has(id)) appState.expandedPerMenuIds.delete(id);
    else appState.expandedPerMenuIds.add(id);
    appState.isPerAllExpanded = false;
    if (typeof renderPersonalMenuManage === 'function') renderPersonalMenuManage();
}

export function togglePerAllMenus() {
    const menusData = getCustomMenus().filter(m =>
        String(m.isPoolItem || m.IsPoolItem).toLowerCase() !== 'true'
    );
    const menusWithChildren = menusData.filter(m =>
        menusData.some(child => child.parentId === m.id || (child.parentIds && child.parentIds.includes(m.id)))
    );

    const btn = document.getElementById('btn-per-toggle-all');
    if (appState.isPerAllExpanded) {
        appState.expandedPerMenuIds.clear();
        appState.isPerAllExpanded = false;
        if (btn) btn.innerHTML = '<i class="fas fa-expand-arrows-alt me-1"></i> 全部展開';
    } else {
        menusWithChildren.forEach(m => appState.expandedPerMenuIds.add(m.id));
        appState.isPerAllExpanded = true;
        if (btn) btn.innerHTML = '<i class="fas fa-compress-arrows-alt me-1"></i> 全部收合';
    }
    if (typeof renderPersonalMenuManage === 'function') renderPersonalMenuManage();
}

export function restoreDefaultPersonalMenu() {
    customConfirm('確定要還原成預設系統版面嗎？您所有的個人自訂排序與隱藏設定將會被清除（包含未儲存的拖曳變更）。', async () => {
        // 清掉本地 + pending；DB 端透過 savePersonalSettings([]) 改成空 list 即可同步
        localStorage.removeItem('umc_personal_menus_' + appState.currentUser.id);
        window._personalPendingPSets = null;
        window._personalPendingDirty = false;

        try { await savePersonalSettings(appState.currentUser.id, {}); } catch (e) { console.error('還原預設版面同步 DB 失敗', e); }

        if (typeof window.updatePersonalSaveButton === 'function') window.updatePersonalSaveButton();
        if (typeof renderPersonalMenuManage === 'function') renderPersonalMenuManage();
        if (typeof renderSidebarMenus === 'function') renderSidebarMenus();
        if (typeof customAlert === 'function') customAlert('已成功還原為預設版面！');
    });
}

export function editPersonalMenu(id) {
    try {
        const menu = getCustomMenus().find(m => window.cleanId(m.id) === window.cleanId(id));
        if (!menu) { console.error("找不到對應的選單資料 (ID: " + id + ")"); return; }

        const pSets = getPersonalSettings(appState.currentUser.id);
        const pSet = pSets[id] || {};

        document.getElementById('editPersonalMenuId').value = menu.id;
        document.getElementById('personalMenuName').value = menu.displayName;
        document.getElementById('personalMenuVisible').checked = !(pSet.hidden === true);
        setIconValToModal('personalMenu', pSet.icon || '');

        const targetGrp = document.getElementById('personalTargetGroup');
        if (menu.menuMode === 'folder') targetGrp.style.display = 'none';
        else {
            targetGrp.style.display = 'block';
            document.getElementById('personalMenuTarget').value = pSet.target || '';
        }
        showModalSafely('personalMenuModal');
    } catch (e) { console.error("[editPersonalMenu] 錯誤:", e); }
}

export async function savePersonalMenu(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    else if (window.event && typeof window.event.preventDefault === 'function') window.event.preventDefault();

    try {
        const id = document.getElementById('editPersonalMenuId').value;
        let pSets = getPersonalSettings(appState.currentUser.id);
        if (!pSets[id]) pSets[id] = {};

        pSets[id].hidden = !document.getElementById('personalMenuVisible').checked;
        pSets[id].icon = getSelectedIconVal('personalMenu');
        pSets[id].Icon = pSets[id].icon;

        const target = document.getElementById('personalMenuTarget').value;
        if (target) pSets[id].target = target; else delete pSets[id].target;

        // 同上：必須 await + 不需要再 fetchInitialDataFromDB (localStorage 為個人設定的單一事實來源)
        // 否則會有 race 把剛改的 hidden/icon/target 順手洗掉
        await savePersonalSettings(appState.currentUser.id, pSets);

        hideModalSafely('personalMenuModal');
        if (typeof renderPersonalMenuManage === 'function') renderPersonalMenuManage();
        if (typeof renderSidebarMenus === 'function') renderSidebarMenus();
    } catch (error) { console.error("[savePersonalMenu] 錯誤:", error); }
    return false;
}

// === Webpages 看板管理 ===
export function toggleWebpageMode() {
    const isAppGrid = document.getElementById('wpModeAppGrid').checked;
    const urlGrp = document.getElementById('wpUrlGroup');
    const targetGrp = document.getElementById('wpTargetGroup');
    if (isAppGrid) {
        urlGrp.style.display = 'none'; targetGrp.style.display = 'none';
        document.getElementById('wpTarget').value = 'iframe';
        document.getElementById('wpUrl').value = 'page-app-grid';
    } else {
        urlGrp.style.display = 'block'; targetGrp.style.display = 'block';
    }
}

export function openAddWebpageModal(id = null) {
    try {
        document.getElementById('wpForm').reset();
        document.getElementById('editWpId').value = id || '';
        document.getElementById('wpModeLink').checked = true;
        toggleWebpageMode();
        setIconValToModal('wp', '');

        // ACL textarea：新建時清空，編輯時帶入既有
        const wpAllowTA = document.getElementById('wpAllowedEmpIds');
        const wpDenyTA = document.getElementById('wpDeniedEmpIds');
        if (wpAllowTA) wpAllowTA.value = '';
        if (wpDenyTA) wpDenyTA.value = '';

        if (id) {
            const m = getCustomMenus().find(x => window.cleanId(x.id) === window.cleanId(id));
            if (m) {
                if (m.menuMode === 'app_grid') document.getElementById('wpModeAppGrid').checked = true;
                else document.getElementById('wpModeLink').checked = true;
                toggleWebpageMode();

                document.getElementById('wpSysName').value = m.name;
                document.getElementById('wpDisplayName').value = m.displayName;
                document.getElementById('wpUrl').value = m.url || m.targetPage || '';
                document.getElementById('wpTarget').value = m.target || 'iframe';
                setIconValToModal('wp', m.icon || '');

                if (wpAllowTA) wpAllowTA.value = (m.allowedEmpIds || []).join('\n');
                if (wpDenyTA) wpDenyTA.value = (m.deniedEmpIds || []).join('\n');
            }
        }
        showModalSafely('webpageModal');
    } catch (e) { console.error("[openAddWebpageModal] 錯誤:", e); }
}

export async function saveWebpageItem(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    else if (window.event && typeof window.event.preventDefault === 'function') window.event.preventDefault();

    try {
        const id = document.getElementById('editWpId').value;
        const isAppGrid = document.getElementById('wpModeAppGrid').checked;
        let menus = getCustomMenus();

        let mObj;
        if (id) {
            mObj = menus.find(x => window.cleanId(x.id) === window.cleanId(id));
        } else {
            mObj = {
                id: 'm_' + Date.now(),
                isPoolItem: true,
                createdBy: appState.currentUser.id,
                parentId: null,
                parentIds: [],
                parentOrders: {}
            };
        }

        mObj.name = document.getElementById('wpSysName').value.trim();
        mObj.displayName = document.getElementById('wpDisplayName').value.trim();
        mObj.menuMode = isAppGrid ? 'app_grid' : 'link';
        mObj.icon = getSelectedIconVal('wp');
        mObj.Icon = mObj.icon;
        if (!id) mObj.enabled = true;
        mObj.isEdited = true;
        if (id) mObj.isPoolItem = true;

        if (isAppGrid) {
            mObj.targetPage = 'page-app-grid'; mObj.url = ''; mObj.target = 'iframe';
        } else {
            let inputUrl = document.getElementById('wpUrl').value.trim();
            if (inputUrl.startsWith('page-')) { mObj.targetPage = inputUrl; mObj.url = ''; }
            else { mObj.url = inputUrl; mObj.targetPage = 'page-iframe'; }
            mObj.target = document.getElementById('wpTarget').value;
        }

        // 收 ACL textareas → 切行、trim、過濾空字串、去重
        mObj.allowedEmpIds = window.__parseAclTextarea(document.getElementById('wpAllowedEmpIds')?.value || '');
        mObj.deniedEmpIds = window.__parseAclTextarea(document.getElementById('wpDeniedEmpIds')?.value || '');

        if (!id) {
            mObj.order = -1;
            menus.push(mObj);
            const poolMenus = menus.filter(x => x.isPoolItem === true);
            poolMenus.sort((a, b) => (a.order || 0) - (b.order || 0));
            poolMenus.forEach((p, idx) => { p.order = idx * 10; });
        }

        const result = await saveMenuAPI(!id, mObj);
        if (!result.success) {
            customAlert("儲存失敗: " + (result.message || '未知錯誤'));
            return false; // ← 失敗時不關 modal、不刷新，保留輸入讓使用者重試
        }

        // 成功 → 刷新資料 + 關 modal + 重畫；任一階段若噴錯也不能讓畫面卡住
        try { await window.fetchInitialDataFromDB(); } catch (e) { console.error('fetch 失敗', e); }
        try { hideModalSafely('webpageModal'); } catch (e) { console.error('hideModal 失敗', e); }
        try {
            if (typeof renderWebpageTable === 'function') renderWebpageTable();
            if (typeof renderMenuConfigTable === 'function') renderMenuConfigTable();
            if (typeof renderSidebarMenus === 'function') renderSidebarMenus();
        } catch (e) { console.error('render 失敗', e); }
    } catch (error) {
        console.error("[saveWebpageItem] 錯誤:", error);
        // 最外層噴錯也要彈訊息 + 確保 modal 不會永遠卡住
        try { customAlert("儲存發生未預期錯誤：" + (error?.message || error)); } catch (_) { }
    }
    return false;
}

export async function deleteWebpageItem(id) {
    try {
        customConfirm('確定要刪除此看板嗎？', async () => {
            let menus = getCustomMenus().filter(m => window.cleanId(m.id) !== window.cleanId(id));

            const delResult = await deleteMenuAPI(id);

            if (!delResult.success) {
                customAlert("刪除失敗");
                return;
            }

            await window.fetchInitialDataFromDB();

            if (typeof renderWebpageTable === 'function') renderWebpageTable();
            if (typeof renderMenuConfigTable === 'function') renderMenuConfigTable();
            if (typeof renderSidebarMenus === 'function') renderSidebarMenus();
        });
    } catch (e) { console.error("[deleteWebpageItem] 錯誤:", e); }
}

// === Menus 結構管理 (巢狀樹狀編輯器) ===
export function toggleNodeMode() {
    const isFolder = document.getElementById('nodeModeFolder').checked;
    document.getElementById('nodeUrlGroup').style.display = isFolder ? 'none' : 'block';
    document.getElementById('nodeTargetGroup').style.display = isFolder ? 'none' : 'block';
    document.getElementById('treeBuilderSection').style.display = isFolder ? 'block' : 'none';
}

export function getLinkOptionsHtml(selectedId) {
    let menus = getCustomMenus().filter(m => m.menuMode !== 'folder');
    let html = '<option value="">請選擇看板...</option>';
    menus.forEach(m => {
        let sel = window.cleanId(m.id) === window.cleanId(selectedId) ? 'selected' : '';
        html += `<option value="${window.escapeHTML(m.id)}" ${sel}>${window.escapeHTML(m.displayName)} (${window.escapeHTML(m.name)})</option>`;
    });
    return html;
}

// 樹狀建構器：新加入的未儲存項目預設皆為自己建立，因此預設可拖曳
window.tbCanReorder = function () {
    return true;
};

window.tbAddLink = function (container, menuId = null, opts) {
    opts = opts || {};
    const draggable = opts.draggable !== undefined ? opts.draggable : window.tbCanReorder();
    const removable = opts.removable !== undefined ? opts.removable : true;
    let div = document.createElement('div');
    div.className = 'd-flex align-items-center mb-2 bg-white border rounded p-2 shadow-sm tb-item tb-link';
    div.setAttribute('data-type', 'link');
    if (draggable) div.setAttribute('draggable', 'true');
    const handleHtml = draggable
        ? '<i class="fas fa-grip-vertical text-muted me-3 cursor-move tb-drag-handle" style="cursor: grab;"></i>'
        : '<i class="fas fa-lock text-muted me-3" style="opacity:0.3;" title="您沒有變更他人內容的權限"></i>';
    const removeBtnHtml = removable
        ? '<button type="button" class="btn btn-sm text-danger border-0 ms-2" onclick="this.closest(\'.tb-item\').remove()"><i class="fas fa-times"></i></button>'
        : '';
    div.innerHTML = `
        ${handleHtml}
        <i class="fas fa-link text-primary me-2"></i>
        <select class="form-select form-select-sm flex-grow-1 border-primary bg-primary bg-opacity-10 text-primary fw-bold tb-link-select" ${removable ? '' : 'disabled'}>
            ${getLinkOptionsHtml(menuId)}
        </select>
        ${removeBtnHtml}
    `;
    if (container) container.appendChild(div);
    return div;
};

window.tbAddFolder = function (container, folderName = '', folderId = '', opts) {
    opts = opts || {};
    const draggable = opts.draggable !== undefined ? opts.draggable : window.tbCanReorder();
    const removable = opts.removable !== undefined ? opts.removable : true;
    const nameEditable = opts.nameEditable !== undefined ? opts.nameEditable : true;
    const canAddChild = opts.canAddChild !== undefined ? opts.canAddChild : true;
    let div = document.createElement('div');
    div.className = 'mb-2 bg-white border border-warning rounded p-2 shadow-sm tb-item tb-folder';
    div.setAttribute('data-type', 'folder');
    div.setAttribute('data-id', folderId);
    if (draggable) div.setAttribute('draggable', 'true');
    const handleHtml = draggable
        ? '<i class="fas fa-grip-vertical text-muted me-3 cursor-move tb-drag-handle" style="cursor: grab;"></i>'
        : '<i class="fas fa-lock text-muted me-3" style="opacity:0.3;" title="您沒有變更他人內容的權限"></i>';
    const removeBtnHtml = removable
        ? '<button type="button" class="btn btn-sm btn-outline-danger border-0 ms-2" onclick="this.closest(\'.tb-item\').remove()"><i class="fas fa-trash-alt me-1"></i>移除群組</button>'
        : '';
    const addChildBtnHtml = canAddChild
        ? `<div class="ps-4 ms-2 mt-1"><button type="button" class="btn btn-sm btn-link text-decoration-none fw-bold p-0" onclick="window.tbAddLink(this.closest('.tb-folder').querySelector('.tb-children'))"><i class="fas fa-plus me-1"></i>加入看板</button></div>`
        : '';
    div.innerHTML = `
        <div class="d-flex align-items-center mb-2">
            ${handleHtml}
            <i class="fas fa-folder text-warning me-2 fs-5"></i>
            <input type="text" class="form-control form-control-sm flex-grow-1 border-warning fw-bold text-dark tb-folder-name" value="${window.escapeHTML(folderName)}" placeholder="群組名稱" ${nameEditable ? '' : 'readonly'}>
            ${removeBtnHtml}
        </div>
        <div class="tb-children ps-4 ms-2 border-start border-warning border-2 pb-1 pt-1" style="min-height: 30px;"></div>
        ${addChildBtnHtml}
    `;
    if (container) container.appendChild(div);
    return div;
};

export function buildTreeUI(container, parentId) {
    let menus = getCustomMenus();
    let children = menus.filter(m => m.id !== parentId && (window.isParentMatch(m.parentId, { id: parentId }) || (m.parentIds || []).some(pid => window.isParentMatch(pid, { id: parentId }))));
    children.sort((a, b) => (a.parentOrders?.[parentId] ?? a.order ?? 0) - (b.parentOrders?.[parentId] ?? b.order ?? 0));

    // 既有的列：是否可拖曳、移除、編輯名稱、新增子節點等，皆依據 getMenuPermissions 精準判斷
    children.forEach(c => {
        const perms = window.getMenuPermissions(c.id, c.createdBy);
        const removable = perms.canDelete === true;
        const nameEditable = perms.canEdit === true;
        const draggable = perms.canEdit === true;
        const canAddChild = perms.canAddChild === true;
        
        if (c.menuMode === 'folder') {
            let folderDiv = window.tbAddFolder(container, c.displayName, c.id, {
                draggable: draggable, removable, nameEditable, canAddChild
            });
            buildTreeUI(folderDiv.querySelector('.tb-children'), c.id);
        } else {
            window.tbAddLink(container, c.id, {
                draggable: draggable, removable
            });
        }
    });
}

export function initTreeDragAndDrop() {
    const section = document.getElementById('treeBuilderSection');
    if (!section || section._dndInit) return;
    section._dndInit = true;
    let dragged = null;

    section.addEventListener('dragstart', function (e) {
        if (e.target.classList && e.target.classList.contains('tb-item')) {
            dragged = e.target;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/html', dragged.innerHTML);
            setTimeout(() => dragged.classList.add('opacity-50'), 0);
        }
    });
    section.addEventListener('dragover', function (e) {
        e.preventDefault();
        if (!dragged) return; // 拖曳被權限阻擋時不做任何處理
        const target = e.target.closest('.tb-item');
        if (target && target !== dragged && !dragged.contains(target)) {
            const rect = target.getBoundingClientRect();
            const next = (e.clientY - rect.top) / (rect.bottom - rect.top) > 0.5;
            target.parentNode.insertBefore(dragged, next && target.nextSibling || target);
        } else if (e.target.classList.contains('tb-children') || e.target.id === 'treeBuilderContainer') {
            if (e.target.children.length === 0 && !dragged.contains(e.target)) {
                e.target.appendChild(dragged);
            }
        }
    });
    section.addEventListener('dragend', function (e) {
        if (dragged) dragged.classList.remove('opacity-50');
        dragged = null;
    });
}

export function parseTreeDOM(container, parentId) {
    let items = container.children;
    let order = 0;
    let results = [];
    for (let i = 0; i < items.length; i++) {
        let el = items[i];
        if (!el.classList.contains('tb-item')) continue;

        let type = el.getAttribute('data-type');
        if (type === 'link') {
            let sel = el.querySelector('.tb-link-select');
            if (sel && sel.value) {
                results.push({ id: sel.value, type: 'link', parentId: parentId, order: order });
                order += 10;
            }
        } else if (type === 'folder') {
            let nameInput = el.querySelector('.tb-folder-name');
            let folderId = el.getAttribute('data-id');
            let folderName = nameInput ? nameInput.value.trim() : '未命名群組';

            if (!folderId || folderId.startsWith('temp_') || folderId === '') {
                folderId = 'f_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
                el.setAttribute('data-id', folderId);
            }

            results.push({ id: folderId, type: 'folder', name: folderName, parentId: parentId, order: order });
            order += 10;

            let childrenContainer = el.querySelector('.tb-children');
            if (childrenContainer) {
                let childResults = parseTreeDOM(childrenContainer, folderId);
                results = results.concat(childResults);
            }
        }
    }
    return results;
}

export function openAddMenuNodeModal(id = null) {
    try {
        document.getElementById('nodeForm').reset();
        document.getElementById('editNodeId').value = id || '';
        document.getElementById('nodeModeFolder').checked = true;
        toggleNodeMode();
        setIconValToModal('node', '');

        const container = document.getElementById('treeBuilderContainer');
        container.innerHTML = '';

        // ACL textarea：新建時清空，編輯時帶入
        const nodeAllowTA = document.getElementById('nodeAllowedEmpIds');
        const nodeDenyTA = document.getElementById('nodeDeniedEmpIds');
        if (nodeAllowTA) nodeAllowTA.value = '';
        if (nodeDenyTA) nodeDenyTA.value = '';

        const menus = getCustomMenus();
        if (id) {
            const m = menus.find(x => window.cleanId(x.id) === window.cleanId(id));
            if (m) {
                if (m.menuMode !== 'folder') document.getElementById('nodeModeLink').checked = true;
                toggleNodeMode();

                document.getElementById('nodeName').value = m.name;
                document.getElementById('nodeDisplayName').value = m.displayName;
                document.getElementById('nodeUrl').value = m.url || m.targetPage || '';
                document.getElementById('nodeTarget').value = m.target || 'iframe';
                setIconValToModal('node', m.icon || '');

                if (nodeAllowTA) nodeAllowTA.value = (m.allowedEmpIds || []).join('\n');
                if (nodeDenyTA) nodeDenyTA.value = (m.deniedEmpIds || []).join('\n');

                if (m.menuMode === 'folder') {
                    const perms = window.getMenuPermissions(m.id, m.createdBy);
                    const rootBtns = document.getElementById('tbRootBtnsContainer');
                    if (rootBtns) rootBtns.style.display = perms.canAddChild ? 'flex' : 'none';
                    buildTreeUI(container, m.id);
                }
            }
        } else {
            const rootBtns = document.getElementById('tbRootBtnsContainer');
            if (rootBtns) rootBtns.style.display = 'flex';
        }

        setTimeout(() => initTreeDragAndDrop(), 100);
        showModalSafely('menuNodeModal');
    } catch (e) { console.error("[openAddMenuNodeModal] 錯誤:", e); }
}

export async function saveMenuNodeItem(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    else if (window.event && typeof window.event.preventDefault === 'function') window.event.preventDefault();

    try {
        const id = document.getElementById('editNodeId').value;
        const isFolder = document.getElementById('nodeModeFolder').checked;
        let menus = getCustomMenus();

        let mObj = id ? menus.find(x => window.cleanId(x.id) === window.cleanId(id)) : { id: 'm_' + Date.now(), isPoolItem: false, createdBy: appState.currentUser.id, parentId: null, parentIds: [] };
        mObj._wasTouched = true;

        mObj.name = document.getElementById('nodeName').value.trim();
        mObj.displayName = document.getElementById('nodeDisplayName').value.trim();
        mObj.menuMode = isFolder ? 'folder' : 'link';
        mObj.icon = getSelectedIconVal('node');
        mObj.Icon = mObj.icon;
        mObj.isEdited = true;

        // 收 ACL
        mObj.allowedEmpIds = window.__parseAclTextarea(document.getElementById('nodeAllowedEmpIds')?.value || '');
        mObj.deniedEmpIds = window.__parseAclTextarea(document.getElementById('nodeDeniedEmpIds')?.value || '');

        if (!id) {
            mObj.enabled = true; // 新節點預設啟用
            mObj.order = menus.length * 10;
            menus.push(mObj);
        }

        let oldDescendants = [];
        let visitedDesc = new Set();
        function getOldDesc(pId) {
            if (visitedDesc.has(pId)) return;
            visitedDesc.add(pId);
            menus.filter(m => m.menuMode === 'folder' && m.id !== pId && (window.isParentMatch(m.parentId, { id: pId }) || (m.parentIds || []).some(x => window.isParentMatch(x, { id: pId }))))
                .forEach(m => { oldDescendants.push(m.id); getOldDesc(m.id); });
        }
        if (mObj.id) getOldDesc(mObj.id);
        oldDescendants.forEach(dId => {
            let m = menus.find(x => window.cleanId(x.id) === window.cleanId(dId));
            if (m) m._wasTouched = true;
        });

        let foldersToDelete = [];

        if (!isFolder) {
            let inputUrl = document.getElementById('nodeUrl').value.trim();
            if (inputUrl.startsWith('page-')) { mObj.targetPage = inputUrl; mObj.url = ''; }
            else { mObj.url = inputUrl; mObj.targetPage = 'page-iframe'; }
            mObj.target = document.getElementById('nodeTarget').value;

            const myId = window.cleanId(mObj.id);
            menus.forEach(m => {
                let touched = false;
                if (window.cleanId(m.id) === myId) return; 
                if (window.cleanId(m.parentId) === myId) { m.parentId = null; touched = true; }
                if (m.parentIds) {
                    const before = m.parentIds.length;
                    m.parentIds = m.parentIds.filter(pid => window.cleanId(pid) !== myId);
                    if (m.parentIds.length !== before) touched = true;
                }
                if (m.parentOrders && m.parentOrders[mObj.id] !== undefined) {
                    delete m.parentOrders[mObj.id];
                    touched = true;
                }
                if (touched) m._wasTouched = true;
            });
            foldersToDelete = oldDescendants;
            menus = menus.filter(m => !oldDescendants.includes(m.id));
        } else {
            mObj.url = ''; mObj.targetPage = '';
            let treeNodes = parseTreeDOM(document.getElementById('treeBuilderContainer'), mObj.id);

            let treeIds = treeNodes.map(t => t.id);
            foldersToDelete = oldDescendants.filter(fid => !treeIds.includes(fid));
            menus = menus.filter(m => !foldersToDelete.includes(m.id));

            const myIds = new Set([window.cleanId(mObj.id), ...oldDescendants.map(window.cleanId)]);
            menus.forEach(m => {
                let touched = false;
                if (myIds.has(window.cleanId(m.id))) return; 
                if (myIds.has(window.cleanId(m.parentId))) { m.parentId = null; touched = true; }
                if (m.parentIds) {
                    const before = m.parentIds.length;
                    m.parentIds = m.parentIds.filter(pid => !myIds.has(window.cleanId(pid)));
                    if (m.parentIds.length !== before) touched = true;
                }
                if (m.parentOrders) {
                    Object.keys(m.parentOrders).forEach(k => {
                        if (myIds.has(window.cleanId(k))) { delete m.parentOrders[k]; touched = true; }
                    });
                }
                if (touched) m._wasTouched = true;
            });

            treeNodes.forEach(node => {
                let m = menus.find(x => window.cleanId(x.id) === window.cleanId(node.id));
                if (!m) {
                    if (node.type === 'folder') {
                        m = { id: node.id, name: node.name, displayName: node.name, menuMode: 'folder', enabled: true, isEdited: true, parentId: null, parentIds: [], parentOrders: {}, createdBy: appState.currentUser.id, isPoolItem: false };
                        m._wasTouched = true;
                        menus.push(m);
                    } else return;
                }
                m._wasTouched = true;
                if (!m.parentIds) m.parentIds = [];
                if (!m.parentOrders) m.parentOrders = {};

                if (!m.parentIds.includes(node.parentId)) m.parentIds.push(node.parentId);
                m.parentOrders[node.parentId] = node.order;
                if (!m.parentId) m.parentId = node.parentId;

                // ⭐️ 容錯：同步把 m.order 也對齊到目前的樹中位置。
                // 側邊欄排序主鍵為 parentOrders[parentId]，但為了避免 m.order
                // 仍殘留舊的全域順序、讓 fallback 路徑或上方導覽列的次要排序錯位，
                // 這裡為目前被編輯選單的「直接子節點」一併更新 m.order。
                if (window.cleanId(node.parentId) === window.cleanId(mObj.id)) {
                    m.order = node.order;
                }
            });
        }

        const menusToSend = menus.filter(m => m._wasTouched === true);
        menus.forEach(m => delete m._wasTouched);

        const result = await batchSaveMenusAPI(menusToSend);
        if (foldersToDelete.length > 0) {
            try { await batchDeleteMenusAPI(foldersToDelete); }
            catch (e) { console.error('batchDeleteMenusAPI 失敗', e); }
        }

        if (!result.success) {
            customAlert("儲存失敗: " + (result.message || '未知錯誤'));
            return false;
        }

        // 成功後處理
        hideModalSafely('menuNodeModal');
        
        try { await window.fetchInitialDataFromDB(); } catch (e) { console.error('fetch 失敗', e); }
        try {
            if (typeof renderMenuConfigTable === 'function') renderMenuConfigTable();
            if (typeof renderSidebarMenus === 'function') renderSidebarMenus();
            // ⛔️ 不呼叫 goDefaultHome()：編輯/儲存後應停留在「選單配置管理」頁，只關閉編輯視窗 +
            //    就地刷新表格/側欄即可。goDefaultHome() 會把畫面跳去使用者預設看板（整頁跳走）。
        } catch (e) { console.error('render 失敗', e); }
    } catch (error) {
        console.error("[saveMenuNodeItem] 錯誤:", error);
        try { customAlert("儲存發生未預期錯誤：" + (error?.message || error)); } catch (_) { }
    }
    return false;
}

export async function deleteMenuNodeItem(id) {
    try {
        customConfirm('確定要刪除此選單配置嗎？(底下包含的子看板將會被釋放回池中，不會被刪除)', async () => {
            let menus = getCustomMenus();

            let oldDescendants = [];
            let visitedDesc = new Set();
            function getOldDesc(pId) {
                if (visitedDesc.has(pId)) return;
                visitedDesc.add(pId);
                menus.filter(m => m.menuMode === 'folder' && m.id !== pId && (window.isParentMatch(m.parentId, { id: pId }) || (m.parentIds || []).some(x => window.isParentMatch(x, { id: pId }))))
                    .forEach(m => { oldDescendants.push(m.id); getOldDesc(m.id); });
            }
            getOldDesc(id);

            const linkageToClear = [id, ...oldDescendants].map(x => window.cleanId(x));
            menus.forEach(x => {
                if (linkageToClear.includes(window.cleanId(x.id))) return; 
                let wasAffected = false;
                if (linkageToClear.includes(window.cleanId(x.parentId))) {
                    x.parentId = null;
                    wasAffected = true;
                }
                if (x.parentIds) {
                    const before = x.parentIds.length;
                    x.parentIds = x.parentIds.filter(pid => !linkageToClear.includes(window.cleanId(pid)));
                    if (x.parentIds.length !== before) wasAffected = true;
                }
                if (x.parentOrders) {
                    linkageToClear.forEach(pid => {
                        if (x.parentOrders[pid] !== undefined) {
                            delete x.parentOrders[pid];
                            wasAffected = true;
                        }
                    });
                }
                if (wasAffected
                    && !x.parentId
                    && (!x.parentIds || x.parentIds.length === 0)
                    && (x.menuMode || '').toLowerCase() !== 'folder') {
                    x.isPoolItem = true;
                }
                if (wasAffected) x._wasTouched = true;
            });

            const idsToDelete = menus.filter(m =>
                window.cleanId(m.id) === window.cleanId(id) ||
                oldDescendants.includes(m.id)
            ).map(m => m.id);

            const menusToSend = menus.filter(m => m._wasTouched === true);
            menus.forEach(m => delete m._wasTouched);

            menus = menus.filter(m => !idsToDelete.includes(m.id));

            const result = await batchSaveMenusAPI(menusToSend);
            const delResult = await batchDeleteMenusAPI(idsToDelete);

            if (!result.success || !delResult.success) {
                customAlert("刪除失敗");
                return;
            }
            try { await window.fetchInitialDataFromDB(); } catch (e) { console.error('fetch 失敗', e); }
            try {
                if (typeof renderMenuConfigTable === 'function') renderMenuConfigTable();
                if (typeof renderWebpageTable === 'function') renderWebpageTable();
                if (typeof renderSidebarMenus === 'function') renderSidebarMenus();
                // ⛔️ 不呼叫 goDefaultHome()：刪除後應停留在「選單配置管理」頁，只就地刷新表格，不可整頁跳轉
            } catch (e) { console.error('render 失敗', e); }
        });
    } catch (e) { console.error("[deleteMenuNodeItem] 錯誤:", e); }
}

// ⭐️ 新增：全域狀態開關連動邏輯
window.toggleMenuEnable = async function (id, isEnabled) {
    let menus = getCustomMenus();
    let m = menus.find(x => window.cleanId(x.id) === window.cleanId(id));
    if (!m) return;

    m.enabled = isEnabled;

    const result = await saveMenuAPI(false, m);
    if (!result.success) {
        customAlert("儲存狀態失敗");
        // 還原：儲存失敗時把記憶體模型退回原值並重畫，讓開關回到 DB 真實狀態。
        // （此分支少見，故此處重畫造成的短暫閃爍可接受。）
        m.enabled = !isEnabled;
        if (typeof renderMenuConfigTable === 'function') renderMenuConfigTable();
        if (typeof renderWebpageTable === 'function') renderWebpageTable();
        return;
    }

    // 成功路徑「刻意不」重畫 選單配置管理 / 看板網頁管理 兩張表 —— 避免 DataTable destroy/recreate
    // 造成整張表閃爍。理由：(1)「狀態」欄就是使用者剛點的那個開關，本就已反映新狀態；該列其餘欄位
    //  （名稱/類型/內容/操作鈕）皆與 enabled 無關，毋須重建。(2) fetchInitialDataFromDB() 內部已重畫
    //  側邊欄（啟用/停用會影響上方導覽列與側邊欄可見性），且它「不會」重畫這兩張管理表，故不會引發閃爍。
    await window.fetchInitialDataFromDB();
};

// Expose for HTML inline handlers
window.togglePerMenuExpand = togglePerMenuExpand;
window.togglePerAllMenus = togglePerAllMenus;
window.restoreDefaultPersonalMenu = restoreDefaultPersonalMenu;
window.editPersonalMenu = editPersonalMenu;
window.savePersonalMenu = savePersonalMenu;
window.toggleWebpageMode = toggleWebpageMode;
window.openAddWebpageModal = openAddWebpageModal;
window.saveWebpageItem = saveWebpageItem;
window.deleteWebpageItem = deleteWebpageItem;
window.toggleNodeMode = toggleNodeMode;
window.getLinkOptionsHtml = getLinkOptionsHtml;
window.buildTreeUI = buildTreeUI;
window.initTreeDragAndDrop = initTreeDragAndDrop;
window.parseTreeDOM = parseTreeDOM;
window.openAddMenuNodeModal = openAddMenuNodeModal;
window.saveMenuNodeItem = saveMenuNodeItem;
window.deleteMenuNodeItem = deleteMenuNodeItem;

