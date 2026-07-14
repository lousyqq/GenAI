export const appState = {
    currentUser: null,
    currentLang: 'zh',
    // 本系統為 12A 專用：不再提供廠區切換，固定綁定 12A
    currentFab: '12A',
    currentLayoutMode: 'system',
    currentAppGridMenuId: null,
    modals: {},
    confirmActionCallback: null,
    dragSrcEl: null,
    dragSrcId: null,
    dragSrcParentId: null,
    draggedRoleItem: null,
    systemAlertModalObj: null,
    systemConfirmModalObj: null,
    currentTreeData: [],
    expandedPerMenuIds: new Set(),
    isPerAllExpanded: false,
    dtInstances: {},
    // 管理頁 DataTable 的「每頁筆數 (pageLength)」session 記憶：key=tableId。
    //   使用者調整筆數後，拖曳/編輯儲存等 destroy+rebuild 不再跳回預設 10；只有「整頁重整」(模組重載→appState 重生) 才回預設。
    dtPageLenMemory: {},
    currentActiveTopMenuId: null,
    currentActiveSidebarMenuId: null,
    isPinned: true,
    tempDefaultPages: {},
    hasUnsavedChanges: false,
    _currentValidMenus: []
};

// Expose state globally ONLY for debugging purposes
// Production code should import appState from store.js
window.appState = appState;
