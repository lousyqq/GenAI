// === 資料庫 / LocalStorage 鍵值常數 (已棄用 LocalStorage，僅留作常數參考) ===
const DB_MENUS = 'umc_menus_v1';
const DB_FABS = 'umc_fabs_v1';
const DB_ROLES = 'umc_roles_v1';
const DB_ACCTS = 'umc_accs_v1';
const DB_REQS = 'umc_reqs_v1';
const DB_APPS = 'umc_app_items_v1';

window.escapeHTML = function (str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
};
window.escapeHtml = window.escapeHTML; // Alias for backward compatibility

// === i18n 翻譯表 (從 TEST_20260429.html:2129-2145 移植) ===
const i18n = {
    zh: {
        menu_workspace: "個人工作區", menu_home: "首頁總覽", menu_reports: "系統看板", menu_settings: "系統設定", nav_title: "EQ Performance", role_label: "權限:", logout: "登出", welcome_title: "歡迎登入", my_role_title: "權限層級", fab_label: "廠區", current_fab_title: "目前選擇廠區",
        menu_personal_manage: "個人頁面管理", menu_webpage_manage: "看板網頁管理", menu_menu_manage: "選單配置管理", menu_fab_manage: "廠區管理", menu_role_manage: "權限管理", menu_account_manage: "帳號管理", menu_audit_manage: "申請審核管理", menu_apply: "需求申請", menu_config_manage: "設定檔管理",
        dyn_m_eastest: "EASTEST", dyn_m_eqas: "EQAS 指標", dyn_m_ze: "ZE 強化防禦群組", dyn_m_ze_1: "MNOP", dyn_m_ze_2: "WL子群組", dyn_m_ze_2_1: "ScalingTEST", dyn_m_ze_2_2: "Non Scaling", dyn_m_ze_3: "BSL", dyn_m_fdc: "FDC 指標看板", dyn_m_12m: "12M EAS", dyn_m_app_test: "12A_Module",
        login_title: "EQ Dashboard", login_emp_id: "工號 (Emp ID)", login_pwd: "密碼 (Password)", login_btn: "登入",
        nav_sys: "系統", nav_personal: "自訂", nav_fab: "廠區:", nav_sys_settings: "系統設定", nav_logout: "登出系統", nav_login_count: "累積登入次數", nav_login_time: "本次登入時間", nav_feedback: "意見箱", nav_breadcrumb_home: "首頁總覽",
        sidebar_module: "模組目錄", search_placeholder: "搜尋看板…", search_no_result: "找不到符合的看板", search_clear: "清除搜尋",
        empty_fab_title: "此廠區尚未配置看板", empty_fab_desc: "可於右上方切換至其他廠區，或由系統管理員於選單配置管理新增看板。",
        home_desc: "目前為預設系統版面。請從上方或左側選單進入各項報表或設定。", home_role_title: "我的系統權限層級", home_role_admin: "系統管理員", home_role_user: "一般使用者",
        btn_restore_default: "還原預設版面", btn_expand_all: "全部展開", btn_add_webpage: "新增網頁", btn_add_main_menu: "新增主選單配置", btn_add_fab: "新增廠區", btn_add_role: "新增群組", btn_add_account: "新增帳號", btn_add_apply: "新增申請",
        config_import_title: "從 Excel 匯入", config_export_title: "匯出 Excel 備份", config_export_desc: "將目前資料庫內容匯出為 Excel，供離線備份", btn_import_excel: "匯入並覆蓋", btn_export_excel: "匯出 Excel",
        th_display_name: "顯示名稱", th_level: "層級", th_status: "狀態", th_open_pref: "開啟方式", th_actions: "操作", th_type: "類型", th_open_config: "開啟配置 / 路徑", th_content_config: "內容配置 (子選單 / 網址)", th_fab_id: "廠區(ID)", th_default_lang: "預設語言", th_applied_roles: "套用的權限群組", th_role_name: "群組名稱", th_allowed_menus: "允許的選單組合", th_emp_id: "工號", th_name_dept: "姓名/部門", th_role_level: "權限層級", th_default_home: "登入預設首頁", th_visible_roles: "可視廠區", th_apply_time: "申請時間", th_apply_type: "申請類別 / 廠區", th_apply_reason: "申請原因與需求細節", th_apply_status: "處理狀態", th_apply_progress: "處理進度與回覆", th_applicant: "申請人",
        modal_btn_cancel: "取消", modal_btn_save: "儲存",
        fab_edit: "廠區編輯", fab_id: "廠區 ID", role_edit: "群組編輯", acc_edit: "帳號設定", name: "姓名", dept: "部門", role_level: "管理層級", delegation: "啟用委派管理", can_edit_others: "允許變更他人內容", manage_menu: "管理目錄", visible_boards: "可視廠區",
        wp_edit: "看板網頁內容配置", wp_type: "看板類型", wp_link: "網頁連結", wp_grid: "應用集合", sys_name: "系統名稱", icon: "圖示 (Icon)", open_target: "開啟方式", iframe: "嵌入網頁 (Iframe)", iframe_fullscreen: "內部嵌入 (全螢幕/沉浸模式)", blank: "新分頁 (Blank)", blank_ie: "另開分頁 (IE)", fullscreen: "新視窗開啟 (全螢幕)", popup: "新視窗開啟 (彈出小視窗)",
        menu_edit: "配置主選單", menu_type: "選單類型", menu_folder: "選單群組", menu_item: "獨立看板",
        dt_processing: "處理中...", dt_lengthMenu: "顯示 _MENU_ 筆", dt_zeroRecords: "沒有符合的結果", dt_info: "顯示第 _START_ 至 _END_ 筆，共 _TOTAL_ 筆", dt_infoEmpty: "顯示第 0 至 0 筆，共 0 筆", dt_infoFiltered: "(從 _MAX_ 筆結果過濾)", dt_search: "搜尋:", dt_first: "首頁", dt_previous: "上一頁", dt_next: "下一頁", dt_last: "尾頁",
        db_sync: "資料庫與同步",
        login_count_prefix: "這是您第 ", login_count_suffix: " 次登入", login_count_unit: "次", dept_unknown: "未設定部門", no_permission: "您沒有權限存取此廠區",
        btn_edit: "編輯", btn_delete: "刪除", btn_add: "新增", confirm_delete: "確定要刪除嗎？",
        lang_zh: "繁體中文", lang_en: "English", lang_ja: "日本語",
        file_choose: "選擇檔案", file_none: "沒有選擇檔案",
        login_src_windows: "Windows", login_src_manual: "手動", login_src_test: "測試", login_src_emergency: "緊急"
    },
    en: {
        menu_workspace: "Workspace", menu_home: "Dashboard Home", menu_reports: "System Dashboards", menu_settings: "Settings", nav_title: "EQ Performance", role_label: "Role:", logout: "Logout", welcome_title: "Welcome", my_role_title: "Access Level", fab_label: "Fab", current_fab_title: "Current Fab",
        menu_personal_manage: "Personal Pages", menu_webpage_manage: "Webpage Mgt", menu_menu_manage: "Menu Config", menu_fab_manage: "Fab Mgt", menu_role_manage: "Role Mgt", menu_account_manage: "Account Mgt", menu_audit_manage: "Audit Mgt", menu_apply: "Access Request", menu_config_manage: "Config Mgt",
        dyn_m_eastest: "EASTEST", dyn_m_eqas: "EQAS Metrics", dyn_m_ze: "ZE Defense Group", dyn_m_ze_1: "MNOP", dyn_m_ze_2: "WL Subgroup", dyn_m_ze_2_1: "ScalingTEST", dyn_m_ze_2_2: "Non Scaling", dyn_m_ze_3: "BSL", dyn_m_fdc: "FDC Metrics", dyn_m_12m: "12M EAS", dyn_m_app_test: "12A_Module",
        login_title: "EQ Dashboard", login_emp_id: "Emp ID", login_pwd: "Password", login_btn: "Login",
        nav_sys: "System", nav_personal: "Custom", nav_fab: "Fab:", nav_sys_settings: "Settings", nav_logout: "Logout", nav_login_count: "Total Logins", nav_login_time: "Login Time", nav_feedback: "Feedback", nav_breadcrumb_home: "Home",
        sidebar_module: "Modules", search_placeholder: "Search dashboards…", search_no_result: "No matching dashboards", search_clear: "Clear search",
        empty_fab_title: "No dashboards configured for this fab", empty_fab_desc: "Switch to another fab at the top right, or ask an administrator to add dashboards in Menu Config.",
        home_desc: "Default system layout. Use top or left menus to navigate.", home_role_title: "My System Role", home_role_admin: "Administrator", home_role_user: "General User",
        btn_restore_default: "Restore Default", btn_expand_all: "Expand All", btn_add_webpage: "Add Webpage", btn_add_main_menu: "Add Menu", btn_add_fab: "Add Fab", btn_add_role: "Add Role", btn_add_account: "Add Account", btn_add_apply: "New Request",
        config_import_title: "Import from Excel", config_export_title: "Export to Excel", config_export_desc: "Export current database to Excel for backup", btn_import_excel: "Import & Overwrite", btn_export_excel: "Export Excel",
        th_display_name: "Display Name", th_level: "Level", th_status: "Status", th_open_pref: "Open Preference", th_actions: "Actions", th_type: "Type", th_open_config: "Open Config / Path", th_content_config: "Content Config", th_fab_id: "Fab (ID)", th_default_lang: "Default Lang", th_applied_roles: "Applied Roles", th_role_name: "Role Name", th_allowed_menus: "Allowed Menus", th_emp_id: "Emp ID", th_name_dept: "Name/Dept", th_role_level: "Role Level", th_default_home: "Default Home", th_visible_roles: "Visible Fabs", th_apply_time: "Request Time", th_apply_type: "Type / Fab", th_apply_reason: "Reason & Details", th_apply_status: "Status", th_apply_progress: "Progress & Reply", th_applicant: "Applicant",
        modal_btn_cancel: "Cancel", modal_btn_save: "Save",
        fab_edit: "Edit Fab", fab_id: "Fab ID", role_edit: "Edit Role", acc_edit: "Account Setup", name: "Name", dept: "Dept", role_level: "Role Level", delegation: "Enable Delegation", can_edit_others: "Can Edit Others", manage_menu: "Manage Menu", visible_boards: "Visible Fabs",
        wp_edit: "Webpage Config", wp_type: "Type", wp_link: "Link", wp_grid: "App Grid", sys_name: "Sys Name", icon: "Icon", open_target: "Open Target", iframe: "Iframe", blank: "New Tab", blank_ie: "New Tab (IE)", fullscreen: "Fullscreen",
        menu_edit: "Menu Config", menu_type: "Menu Type", menu_folder: "Folder", menu_item: "Item",
        dt_processing: "Processing...", dt_lengthMenu: "Show _MENU_ entries", dt_zeroRecords: "No matching records", dt_info: "Showing _START_ to _END_ of _TOTAL_ entries", dt_infoEmpty: "Showing 0 to 0 of 0 entries", dt_infoFiltered: "(filtered from _MAX_ total entries)", dt_search: "Search:", dt_first: "First", dt_previous: "Previous", dt_next: "Next", dt_last: "Last",
        db_sync: "DB & Sync",
        login_count_prefix: "Login #", login_count_suffix: "", login_count_unit: "", dept_unknown: "Dept not set", no_permission: "No permission to access this fab",
        btn_edit: "Edit", btn_delete: "Delete", btn_add: "Add", confirm_delete: "Are you sure you want to delete?",
        lang_zh: "Traditional Chinese", lang_en: "English", lang_ja: "Japanese",
        file_choose: "Choose File", file_none: "No file chosen",
        login_src_windows: "Windows", login_src_manual: "Manual", login_src_test: "Test", login_src_emergency: "Emergency"
    },
    ja: {
        menu_workspace: "ワークスペース", menu_home: "ホーム", menu_reports: "レポート", menu_settings: "設定", nav_title: "EQ Performance", role_label: "権限:", logout: "ログアウト", welcome_title: "ようこそ", my_role_title: "権限レベル", fab_label: "工場", current_fab_title: "選択中の工場",
        menu_personal_manage: "個人ページ", menu_webpage_manage: "Webページ管理", menu_menu_manage: "メニュー構成", menu_fab_manage: "工場管理", menu_role_manage: "権限管理", menu_account_manage: "アカウント管理", menu_audit_manage: "承認管理", menu_apply: "権限申請", menu_config_manage: "設定管理",
        dyn_m_eastest: "EASTEST", dyn_m_eqas: "EQAS 指標", dyn_m_ze: "ZE 防御グループ", dyn_m_ze_1: "MNOP", dyn_m_ze_2: "WL サブグループ", dyn_m_ze_2_1: "ScalingTEST", dyn_m_ze_2_2: "Non Scaling", dyn_m_ze_3: "BSL", dyn_m_fdc: "FDC 指標", dyn_m_12m: "12M EAS", dyn_m_app_test: "12A_Module",
        login_title: "EQ ダッシュボード", login_emp_id: "社員番号 (Emp ID)", login_pwd: "パスワード (Password)", login_btn: "ログイン",
        nav_sys: "システム", nav_personal: "カスタム", nav_fab: "工場:", nav_sys_settings: "システム設定", nav_logout: "ログアウト", nav_login_count: "累積ログイン回数", nav_login_time: "今回ログイン時間", nav_feedback: "意見箱", nav_breadcrumb_home: "ホーム",
        sidebar_module: "モジュール", search_placeholder: "ダッシュボード検索…", search_no_result: "一致するダッシュボードがありません", search_clear: "検索をクリア",
        empty_fab_title: "この工場にはダッシュボードが未設定です", empty_fab_desc: "右上から他の工場に切り替えるか、管理者がメニュー構成でダッシュボードを追加してください。",
        home_desc: "デフォルトのシステムレイアウトです。上部または左側のメニューから各レポートや設定にアクセスしてください。", home_role_title: "私のシステム権限", home_role_admin: "システム管理者", home_role_user: "一般ユーザー",
        btn_restore_default: "デフォルトに戻す", btn_expand_all: "すべて展開", btn_add_webpage: "Webページ追加", btn_add_main_menu: "メニュー追加", btn_add_fab: "工場追加", btn_add_role: "権限グループ追加", btn_add_account: "アカウント追加", btn_add_apply: "新規申請",
        config_import_title: "Excel からインポート", config_export_title: "Excel へエクスポート", config_export_desc: "現在のデータベースをExcel形式でバックアップとしてエクスポートします", btn_import_excel: "インポートと上書き", btn_export_excel: "Excel エクスポート",
        th_display_name: "表示名", th_level: "レベル", th_status: "ステータス", th_open_pref: "開く設定", th_actions: "操作", th_type: "タイプ", th_open_config: "開く構成 / パス", th_content_config: "コンテンツ構成", th_fab_id: "工場(ID)", th_default_lang: "デフォルト言語", th_applied_roles: "適用された権限", th_role_name: "グループ名", th_allowed_menus: "許可されたメニュー", th_emp_id: "社員番号", th_name_dept: "氏名/部署", th_role_level: "権限レベル", th_default_home: "デフォルトホーム", th_visible_roles: "表示可能な工場", th_apply_time: "申請時間", th_apply_type: "申請タイプ / 工場", th_apply_reason: "申請理由と詳細", th_apply_status: "ステータス", th_apply_progress: "進捗と返信", th_applicant: "申請者",
        modal_btn_cancel: "キャンセル", modal_btn_save: "保存",
        fab_edit: "工場編集", fab_id: "工場 ID", role_edit: "グループ編集", acc_edit: "アカウント設定", name: "氏名", dept: "部署", role_level: "管理レベル", delegation: "委任管理を有効にする", can_edit_others: "他人のコンテンツ変更を許可", manage_menu: "管理ディレクトリ", visible_boards: "表示可能な工場",
        wp_edit: "Webページ設定", wp_type: "タイプ", wp_link: "リンク", wp_grid: "アプリグリッド", sys_name: "システム名", icon: "アイコン", open_target: "開く方法", iframe: "Iframe", blank: "新しいタブ", blank_ie: "新しいタブ (IE)", fullscreen: "フルスクリーン",
        menu_edit: "メニュー構成", menu_type: "メニュータイプ", menu_folder: "フォルダ", menu_item: "アイテム",
        dt_processing: "処理中...", dt_lengthMenu: "_MENU_ 件表示", dt_zeroRecords: "一致するレコードはありません", dt_info: "_START_ から _END_ まで表示 / 全 _TOTAL_ 件", dt_infoEmpty: "0 から 0 まで表示 / 全 0 件", dt_infoFiltered: "（全 _MAX_ 件からフィルタ）", dt_search: "検索:", dt_first: "先頭", dt_previous: "前へ", dt_next: "次へ", dt_last: "最後",
        db_sync: "DB同期",
        login_count_prefix: "第 ", login_count_suffix: " 回目のログイン", login_count_unit: "回", dept_unknown: "部署未設定", no_permission: "この工場へのアクセス権がありません",
        btn_edit: "編集", btn_delete: "削除", btn_add: "追加", confirm_delete: "削除してもよろしいですか？",
        lang_zh: "中国語（繁体）", lang_en: "英語", lang_ja: "日本語",
        file_choose: "ファイル選択", file_none: "ファイル未選択",
        login_src_windows: "Windows", login_src_manual: "手動", login_src_test: "テスト", login_src_emergency: "緊急"
    }
};

import { appState } from './store.js?v=20260607k';

// =========================================================================
// ⭐️ 終極資料讀取介面：全面接管舊有的 LocalStorage 函式，強制導向資料庫記憶體 (appState)
// =========================================================================
export function getCustomMenus() { return appState ? (appState.menus || []) : []; }
export function getFabs() { return appState ? (appState.fabs || []) : []; }
export function getRoles() { return appState ? (appState.roles || []) : []; }
export function getAccounts() { return appState ? (appState.accounts || []) : []; }
export function getAppItems() { return appState ? (appState.apps || []) : []; }

// 個人化設定暫時保留 LocalStorage，因為這部分隨使用者設備變動較合理
export function getPersonalSettings(empId) {
    try { return JSON.parse(localStorage.getItem('umc_personal_menus_' + empId)) || {}; }
    catch (e) { return {}; }
}
export async function savePersonalSettings(empId, data) {
    // 將個人設定轉換為後端 API 預期的 List<PersonalSettingDto> 格式
    const payload = [];
    for (let menuId in data) {
        payload.push({
            menuId: menuId,
            isHidden: data[menuId].hidden || false,
            openTarget: data[menuId].target || null,
            icon: data[menuId].icon || null,
            sortOrder: data[menuId].order || null
        });
    }

    // ⭐️ H2 修復：回傳成功/失敗，呼叫端才能在 DB 寫入失敗時提示並避免假報成功。
    //    （X-Requested-With CSRF 標頭由 api.js 的全域 fetch 攔截器自動補上。）
    // 1.2 修復：localStorage 只在 DB 寫入成功後才更新。
    //    舊版「先寫 localStorage 再 POST」會在 POST 失敗時讓本機快取領先於 DB（畫面顯示已存、實際沒存）。
    //    DB 才是事實來源；本機僅作快取，故必須等 response.ok 才同步。
    try {
        const response = await fetch('/api/PersonalSettings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            console.error("無法將個人選單儲存至伺服器，狀態碼:", response.status);
            return false;
        }
        localStorage.setItem('umc_personal_menus_' + empId, JSON.stringify(data));
        return true;
    } catch (e) {
        console.error("儲存個人選單失敗:", e);
        return false;
    }
}

// === i18n 工具函式 ===
// 快速取翻譯文字，若無則回傳 fallback（注意：空字串 "" 也是有效翻譯）
export function t(key, fallback) {
    if (typeof i18n !== 'undefined' && i18n[appState.currentLang] && i18n[appState.currentLang][key] !== undefined && i18n[appState.currentLang][key] !== null) return i18n[appState.currentLang][key];
    return (fallback !== undefined) ? fallback : key;
}
window.t = t;

// 取得 DataTables 多語系物件 (供 initDataTable / 個人選單 DataTable 共用)
export function getDataTableLang() {
    return {
        "processing": t('dt_processing', '處理中...'),
        "lengthMenu": t('dt_lengthMenu', '顯示 _MENU_ 筆'),
        "zeroRecords": t('dt_zeroRecords', '沒有符合的結果'),
        "info": t('dt_info', '顯示第 _START_ 至 _END_ 筆，共 _TOTAL_ 筆'),
        "infoEmpty": t('dt_infoEmpty', '顯示第 0 至 0 筆，共 0 筆'),
        "infoFiltered": t('dt_infoFiltered', '(從 _MAX_ 筆結果過濾)'),
        "search": "<i class='fas fa-search text-muted me-1'></i> " + t('dt_search', '搜尋:'),
        "paginate": { "first": t('dt_first', '首頁'), "previous": t('dt_previous', '上一頁'), "next": t('dt_next', '下一頁'), "last": t('dt_last', '尾頁') }
    };
}
window.getDataTableLang = getDataTableLang;

// Expose for HTML inline handlers
window.getCustomMenus = getCustomMenus;
window.getFabs = getFabs;
window.getRoles = getRoles;
window.getAccounts = getAccounts;
window.getAppItems = getAppItems;
window.getPersonalSettings = getPersonalSettings;
window.savePersonalSettings = savePersonalSettings;
window.t = t;
window.getDataTableLang = getDataTableLang;
window.i18n = i18n;

export { i18n };
