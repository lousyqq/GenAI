// === admin/stats-ui.js — 網站使用率與流量統計儀表板 ===
// 對應頁面：#page-site-stats
import { safeDestroyDataTable, initDataTable } from '../render/sidebar.js?v=20260719';

let _currentStatsMode = 'daily'; // 'daily' 或 'monthly'
let _statsInitialized = false;

// === 圖表色彩（與 index.html 圖例、KPI 卡左框線一致）===
//   頁面文案一律用白話「進站人數 / 瀏覽次數」，UV/PV 術語只留在程式內部欄位名。
const STATS_COLOR_UV = '#10b981';
const STATS_COLOR_PV = '#3b82f6';

// === 自製圖表 tooltip（取代原生 title 屬性：即時顯示、不用停留等待，且樣式可讀）===
let _statsChartTip = null;
function getStatsChartTip() {
    if (!_statsChartTip) {
        _statsChartTip = document.createElement('div');
        _statsChartTip.className = 'stats-chart-tip';
        _statsChartTip.style.display = 'none';
        document.body.appendChild(_statsChartTip);
    }
    return _statsChartTip;
}

function bindStatsChartTooltip(container) {
    if (container.dataset.tipBound === '1') return; // 事件掛在 container 上，innerHTML 重繪不需重掛
    container.dataset.tipBound = '1';
    let hoverGroup = null;

    container.addEventListener('mouseover', (e) => {
        const g = e.target.closest('.stats-bar-group');
        if (!g || g === hoverGroup) return;
        if (hoverGroup) hoverGroup.classList.remove('stats-bar-hover');
        hoverGroup = g;
        g.classList.add('stats-bar-hover');
        const tip = getStatsChartTip();
        tip.innerHTML = `<div class="fw-bold mb-1">${window.escapeHTML(g.dataset.tipTitle || '')}</div>`
            + `<div><span class="stats-legend-dot" style="background:${STATS_COLOR_UV};"></span>進站人數：${Number(g.dataset.uv || 0).toLocaleString()} 人</div>`
            + `<div><span class="stats-legend-dot" style="background:${STATS_COLOR_PV};"></span>瀏覽次數：${Number(g.dataset.pv || 0).toLocaleString()} 次</div>`;
        tip.style.display = 'block';
    });

    container.addEventListener('mousemove', (e) => {
        const tip = getStatsChartTip();
        if (tip.style.display === 'none') return;
        // 跟隨滑鼠，靠近視窗右緣時翻到左側避免被裁切
        const pad = 14;
        let x = e.clientX + pad;
        if (x + tip.offsetWidth > window.innerWidth - 8) x = e.clientX - tip.offsetWidth - pad;
        tip.style.left = `${x}px`;
        tip.style.top = `${Math.max(8, e.clientY - tip.offsetHeight - pad)}px`;
    });

    container.addEventListener('mouseleave', () => {
        if (hoverGroup) { hoverGroup.classList.remove('stats-bar-hover'); hoverGroup = null; }
        getStatsChartTip().style.display = 'none';
    });
}

/**
 * 共用 CSS 長條圖渲染（日報表 / 月報表共用）。
 * items: [{ label: X 軸標籤, tipTitle: tooltip 標題, uv, pv }]
 */
function renderStatsBarChart(container, items, opts = {}) {
    const barWidth = opts.barWidth || 10;
    const minWidth = opts.groupMinWidth || 28;
    const gapClass = opts.groupGapClass || 'gap-1';
    const labelClass = opts.boldLabel ? 'small fw-bold text-secondary mt-1' : 'small text-secondary mt-1';

    let max = 10;
    items.forEach(t => { if (t.pv > max) max = t.pv; if (t.uv > max) max = t.uv; });

    let html = '';
    items.forEach(t => {
        const uvHeight = Math.max(6, Math.round((t.uv / max) * 190));
        const pvHeight = Math.max(6, Math.round((t.pv / max) * 190));
        html += `
            <div class="d-flex flex-column align-items-center flex-grow-1 stats-bar-group" style="min-width: ${minWidth}px;"
                 data-tip-title="${window.escapeHTML(t.tipTitle)}" data-uv="${t.uv}" data-pv="${t.pv}">
                <div class="d-flex align-items-end justify-content-center ${gapClass} w-100" style="height: 200px;">
                    <div class="rounded-top shadow-sm transition-all" style="width: ${barWidth}px; height: ${uvHeight}px; background: linear-gradient(180deg, ${STATS_COLOR_UV} 0%, #059669 100%);"></div>
                    <div class="rounded-top shadow-sm transition-all" style="width: ${barWidth}px; height: ${pvHeight}px; background: linear-gradient(180deg, ${STATS_COLOR_PV} 0%, #2563eb 100%);"></div>
                </div>
                <div class="${labelClass}" style="font-size: 0.75rem;">${window.escapeHTML(t.label)}</div>
            </div>`;
    });
    container.innerHTML = html;
    bindStatsChartTooltip(container);
}

export function initSiteStats() {
    if (!_statsInitialized) {
        initDateSelects();
        _statsInitialized = true;
    }
    loadSiteStats();
}
window.initSiteStats = initSiteStats;

function initDateSelects() {
    const yearSelect = document.getElementById('statsYearSelect');
    const monthSelect = document.getElementById('statsMonthSelect');
    if (!yearSelect || !monthSelect) return;

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    // 填充年份 (目前年度前 2 年到後 1 年)
    yearSelect.innerHTML = '';
    for (let y = currentYear + 1; y >= currentYear - 2; y--) {
        const opt = document.createElement('option');
        opt.value = y;
        opt.textContent = `${y} 年`;
        if (y === currentYear) opt.selected = true;
        yearSelect.appendChild(opt);
    }

    // 填充月份 (1 ~ 12 月)
    monthSelect.innerHTML = '';
    for (let m = 1; m <= 12; m++) {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = `${m} 月`;
        if (m === currentMonth) opt.selected = true;
        monthSelect.appendChild(opt);
    }
}

export function switchStatsMode(mode) {
    _currentStatsMode = mode;
    const monthSelect = document.getElementById('statsMonthSelect');
    if (monthSelect) {
        monthSelect.style.display = mode === 'monthly' ? 'none' : 'inline-block';
    }
    loadSiteStats();
}
window.switchStatsMode = switchStatsMode;

export async function loadSiteStats() {
    const yearSelect = document.getElementById('statsYearSelect');
    const monthSelect = document.getElementById('statsMonthSelect');
    const year = yearSelect ? parseInt(yearSelect.value, 10) || new Date().getFullYear() : new Date().getFullYear();
    const month = monthSelect ? parseInt(monthSelect.value, 10) || (new Date().getMonth() + 1) : (new Date().getMonth() + 1);

    // 1) 載入頂層摘要 KPI 與部門使用占比
    await loadSummaryKPIs();

    // 2) 根據模式載入趨勢圖與明細
    if (_currentStatsMode === 'daily') {
        await loadDailyBreakdown(year, month);
    } else {
        await loadMonthlyBreakdown(year);
    }
}
window.loadSiteStats = loadSiteStats;

async function loadSummaryKPIs() {
    try {
        const resp = await fetch(window.toAppUrl('/api/Stats/Summary'));
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        if (!data || !data.success) return;

        // KPI 今日
        const elTodayUv = document.getElementById('statTodayUv');
        const elTodayPv = document.getElementById('statTodayPv');
        const elTodayAvg = document.getElementById('statTodayAvg');
        const elTodayDate = document.getElementById('statTodayDate');
        if (elTodayUv) elTodayUv.textContent = (data.today?.uv || 0).toLocaleString();
        if (elTodayPv) elTodayPv.textContent = (data.today?.pv || 0).toLocaleString();
        if (elTodayAvg) {
            const uv = data.today?.uv || 0;
            const pv = data.today?.pv || 0;
            elTodayAvg.textContent = uv > 0 ? (pv / uv).toFixed(1) : '0';
        }
        if (elTodayDate) elTodayDate.textContent = `統計日期: ${data.today?.date || '今天'}`;

        // KPI 本月
        const elMonthUv = document.getElementById('statMonthUv');
        const elMonthPv = document.getElementById('statMonthPv');
        const elMonthAvg = document.getElementById('statMonthAvg');
        const elMonthLabel = document.getElementById('statMonthLabel');
        if (elMonthUv) elMonthUv.textContent = (data.thisMonth?.uv || 0).toLocaleString();
        if (elMonthPv) elMonthPv.textContent = (data.thisMonth?.pv || 0).toLocaleString();
        if (elMonthAvg) elMonthAvg.textContent = `${data.thisMonth?.avgViewsPerUser || 0}`;
        if (elMonthLabel) elMonthLabel.textContent = `統計月份: ${data.thisMonth?.yearMonth || '本月'}（開站以來累計瀏覽 ${(data.total?.pv || 0).toLocaleString()} 次）`;

        // 部門占比 TOP 5
        const deptContainer = document.getElementById('statsDeptContainer');
        if (deptContainer && data.topDepartments) {
            if (data.topDepartments.length === 0) {
                deptContainer.innerHTML = '<div class="text-center text-muted py-4">本月尚無部門統計數據</div>';
            } else {
                const totalMonthUv = data.thisMonth?.uv || 1;
                let html = '<div class="d-flex flex-column gap-3 py-1">';
                data.topDepartments.forEach((d, idx) => {
                    const percent = Math.min(100, Math.round((d.uv / totalMonthUv) * 100));
                    const colors = ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ec4899'];
                    const color = colors[idx % colors.length];
                    html += `
                        <div>
                            <div class="d-flex justify-content-between align-items-center small mb-1">
                                <span class="fw-bold text-dark"><span class="badge bg-light text-dark border me-1">${idx + 1}</span>${window.escapeHTML(d.department || '未分類')}</span>
                                <span class="fw-bold" style="color: ${color};">${d.uv} 人 (${percent}%) / ${d.pv} 次</span>
                            </div>
                            <div class="progress" style="height: 8px; background-color: #f1f5f9;">
                                <div class="progress-bar rounded-pill" role="progressbar" style="width: ${percent}%; background-color: ${color};" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100"></div>
                            </div>
                        </div>`;
                });
                html += '</div>';
                deptContainer.innerHTML = html;
            }
        }
    } catch (e) {
        console.error('載入摘要 Summary 失敗:', e);
    }
}

async function loadDailyBreakdown(year, month) {
    const chartContainer = document.getElementById('statsChartContainer');
    const tableHeader = document.getElementById('statsTableHeader');
    const tableBody = document.getElementById('statsTableBody');
    const titleEl = document.getElementById('statsChartTitle');
    const tableTitleEl = document.getElementById('statsTableTitle');
    const countEl = document.getElementById('statsDetailsCount');

    safeDestroyDataTable('dtStatsDetail');

    if (titleEl) titleEl.innerHTML = `<i class="fas fa-chart-bar text-primary me-2"></i>${year} 年 ${month} 月 — 每日進站人數與瀏覽次數走勢`;
    if (tableTitleEl) tableTitleEl.innerHTML = `<i class="fas fa-list text-secondary me-2"></i>${year} 年 ${month} 月 — 進站同仁詳細紀錄`;
    if (tableHeader) {
        tableHeader.innerHTML = '<th>日期</th><th>工號</th><th>姓名</th><th>所屬部門</th><th>當日瀏覽次數</th><th>首次進入</th><th>最後進入</th>';
    }

    if (chartContainer) chartContainer.innerHTML = '<div class="text-center text-muted w-100 py-5"><i class="fas fa-spinner fa-spin me-1"></i> 載入每日走勢中...</div>';
    if (tableBody) tableBody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4"><i class="fas fa-spinner fa-spin me-1"></i> 查詢明細中...</td></tr>';

    try {
        const resp = await fetch(window.toAppUrl(`/api/Stats/Daily?year=${year}&month=${month}`));
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        if (!data || !data.success) return;

        // 繪製每日趨勢 CSS Bar Chart（共用渲染器 + 自製 tooltip）
        if (chartContainer) {
            const trend = data.trend || [];
            if (trend.length === 0) {
                chartContainer.innerHTML = '<div class="text-center text-muted w-100 py-5">該月尚無瀏覽流量紀錄</div>';
            } else {
                renderStatsBarChart(chartContainer, trend.map(t => ({
                    label: t.date.split('-')[2] + '日',
                    tipTitle: t.date,
                    uv: t.uv,
                    pv: t.pv
                })), { barWidth: 10, groupMinWidth: 28, groupGapClass: 'gap-1', boldLabel: false });
            }
        }

        // 渲染下注明細資料表
        if (tableBody) {
            const details = data.details || [];
            if (countEl) countEl.textContent = `共 ${details.length} 筆`;
            if (details.length === 0) {
                tableBody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">該月尚無人員訪客明細</td></tr>';
            } else {
                tableBody.innerHTML = details.map(item => `
                    <tr>
                        <td class="text-secondary">${item.statDate}</td>
                        <td class="fw-bold text-primary">${window.escapeHTML(item.empId)}</td>
                        <td class="fw-bold">${window.escapeHTML(item.empName)}</td>
                        <td><span class="badge bg-light text-dark border">${window.escapeHTML(item.department)}</span></td>
                        <td><span class="badge bg-primary px-3 py-1 fs-6">${item.pageViews}</span></td>
                        <td class="small text-muted">${item.firstVisit}</td>
                        <td class="small text-muted">${item.lastVisit}</td>
                    </tr>`).join('');
                initDataTable('dtStatsDetail', true, 25);
            }
        }
    } catch (e) {
        console.error('載入每日 breakdown 失敗:', e);
        if (chartContainer) chartContainer.innerHTML = '<div class="text-center text-danger w-100 py-5">無法載入圖表</div>';
        if (tableBody) tableBody.innerHTML = '<tr><td colspan="7" class="text-center text-danger py-4">查詢失敗</td></tr>';
    }
}

async function loadMonthlyBreakdown(year) {
    const chartContainer = document.getElementById('statsChartContainer');
    const tableHeader = document.getElementById('statsTableHeader');
    const tableBody = document.getElementById('statsTableBody');
    const titleEl = document.getElementById('statsChartTitle');
    const tableTitleEl = document.getElementById('statsTableTitle');
    const countEl = document.getElementById('statsDetailsCount');

    safeDestroyDataTable('dtStatsDetail');

    if (titleEl) titleEl.innerHTML = `<i class="fas fa-chart-bar text-primary me-2"></i>${year} 年度 — 各月份進站人數與瀏覽次數走勢`;
    if (tableTitleEl) tableTitleEl.innerHTML = `<i class="fas fa-list text-secondary me-2"></i>${year} 年度 — 各月份彙總清單`;
    if (tableHeader) {
        tableHeader.innerHTML = '<th>月份</th><th>進站人數 (當月不重複)</th><th>瀏覽次數 (當月累計)</th><th>平均每人瀏覽</th><th>活躍度</th>';
    }

    if (chartContainer) chartContainer.innerHTML = '<div class="text-center text-muted w-100 py-5"><i class="fas fa-spinner fa-spin me-1"></i> 載入月度走勢中...</div>';
    if (tableBody) tableBody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4"><i class="fas fa-spinner fa-spin me-1"></i> 查詢月份清單中...</td></tr>';

    try {
        const resp = await fetch(window.toAppUrl(`/api/Stats/Monthly?year=${year}`));
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        if (!data || !data.success) return;

        // 繪製月度趨勢 CSS Bar Chart（共用渲染器 + 自製 tooltip；固定顯示 1~12 月）
        if (chartContainer) {
            const monthly = data.monthly || [];
            if (monthly.length === 0) {
                chartContainer.innerHTML = '<div class="text-center text-muted w-100 py-5">年度尚無瀏覽紀錄</div>';
            } else {
                const items = [];
                for (let m = 1; m <= 12; m++) {
                    const item = monthly.find(x => x.month === m) || { uv: 0, pv: 0 };
                    items.push({ label: `${m}月`, tipTitle: `${year} 年 ${m} 月`, uv: item.uv, pv: item.pv });
                }
                renderStatsBarChart(chartContainer, items, { barWidth: 14, groupMinWidth: 40, groupGapClass: 'gap-2', boldLabel: true });
            }
        }

        // 渲染下方月份清單
        if (tableBody) {
            const monthly = data.monthly || [];
            if (countEl) countEl.textContent = `共 ${monthly.length} 個月`;
            if (monthly.length === 0) {
                tableBody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4">年度尚無月份數據</td></tr>';
            } else {
                tableBody.innerHTML = monthly.map(item => {
                    const avg = item.uv > 0 ? (item.pv / item.uv).toFixed(1) : '0';
                    let badgeColor = 'bg-secondary';
                    let label = '正常';
                    if (item.pv > 500) { badgeColor = 'bg-danger'; label = '極高活躍'; }
                    else if (item.pv > 100) { badgeColor = 'bg-success'; label = '高度活躍'; }
                    else if (item.pv > 20) { badgeColor = 'bg-info'; label = '穩定進站'; }
                    return `
                        <tr>
                            <td class="fw-bold text-dark fs-6">${item.monthLabel}</td>
                            <td><span class="badge bg-success px-3 py-1 fs-6">${item.uv.toLocaleString()} 人</span></td>
                            <td><span class="badge bg-primary px-3 py-1 fs-6">${item.pv.toLocaleString()} 次</span></td>
                            <td class="fw-bold text-secondary">${avg} <small>次/人</small></td>
                            <td><span class="badge ${badgeColor}">${label}</span></td>
                        </tr>`;
                }).join('');
                initDataTable('dtStatsDetail', true, 25);
            }
        }
    } catch (e) {
        console.error('載入月度 breakdown 失敗:', e);
        if (chartContainer) chartContainer.innerHTML = '<div class="text-center text-danger w-100 py-5">無法載入圖表</div>';
        if (tableBody) tableBody.innerHTML = '<tr><td colspan="5" class="text-center text-danger py-4">查詢失敗</td></tr>';
    }
}

export function exportSiteStats() {
    const yearSelect = document.getElementById('statsYearSelect');
    const monthSelect = document.getElementById('statsMonthSelect');
    const year = yearSelect ? yearSelect.value : new Date().getFullYear();
    const month = monthSelect ? monthSelect.value : (new Date().getMonth() + 1);
    const url = window.toAppUrl(`/api/Stats/Export?year=${year}&month=${month}`);
    window.location.href = url;
}
window.exportSiteStats = exportSiteStats;
