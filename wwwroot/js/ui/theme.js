// === theme.js — 深色/淺色模式切換模組 ===
// 責任：讀取 localStorage → 套用至 <html data-theme> → 提供切換函式
// 投影機友善：深色模式使用高對比度文字 (WCAG AAA ≥ 7:1)

const THEME_KEY = 'genai_theme';

/**
 * 初始化主題：優先讀取 localStorage，其次偵測系統偏好
 * 注意：index.html 的 <head> 中已有一段同步腳本在 CSS 載入前就設好 data-theme，
 *       此函式僅作為 JS 載入後的「確認 + 綁定事件」用途，不會造成 FOUC。
 */
export function initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') {
        applyTheme(saved);
    } else {
        // 首次訪問：預設強制為淺色模式 (依使用者要求)
        applyTheme('light');
    }
    updateToggleIcon();

    // 已經取消系統偏好的自動跟隨，確保使用者體驗一致
}

/**
 * 切換深色 ↔ 淺色模式
 */
export function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    localStorage.setItem(THEME_KEY, next);
    updateToggleIcon();
}

/**
 * 套用指定主題至 <html>
 */
function applyTheme(mode) {
    document.documentElement.setAttribute('data-theme', mode);
}

/**
 * 更新導覽列切換按鈕的圖示 (月亮 ↔ 太陽)
 */
function updateToggleIcon() {
    const btn = document.getElementById('btn-theme-toggle');
    if (!btn) return;

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const icon = btn.querySelector('i');
    if (icon) {
        // 給深淺色切換加上專屬顏色，避免白色的太陽看起來像齒輪
        icon.className = isDark ? 'fas fa-sun text-warning' : 'fas fa-moon text-secondary';
    }
    const title = isDark ? '切換至淺色模式' : '切換至深色模式';
    btn.title = title;
    btn.setAttribute('aria-label', title);
}

/**
 * 取得目前主題
 */
export function getCurrentTheme() {
    return document.documentElement.getAttribute('data-theme') || 'light';
}

// 掛到 window 上供 HTML onclick 使用
window.toggleTheme = toggleTheme;
window.initTheme = initTheme;
window.getCurrentTheme = getCurrentTheme;
