// === admin/stats-ui.js — 網站使用率與流量統計儀表板 ===
// 對應頁面：#page-site-stats
import { safeDestroyDataTable, initDataTable } from '../render/sidebar.js?v=20260607k';

let _currentStatsMode = 'daily'; // 'daily' 或 'monthly'
let _statsInitialized = false;

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
        if (elMonthLabel) elMonthLabel.textContent = `統計月份: ${data.thisMonth?.yearMonth || '本月'} (累計歷史進站人次: ${(data.total?.pv || 0).toLocaleString()})`;

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

    if (titleEl) titleEl.innerHTML = `<i class="fas fa-chart-bar text-primary me-2"></i>${year} 年 ${month} 月 — 每日使用人數與瀏覽走勢`;
    if (tableTitleEl) tableTitleEl.innerHTML = `<i class="fas fa-list text-secondary me-2"></i>${year} 年 ${month} 月 — 進站同仁詳細紀錄`;
    if (tableHeader) {
        tableHeader.innerHTML = '<th>日期</th><th>工號</th><th>姓名</th><th>所屬部門</th><th>當日瀏覽(PV)</th><th>首次進入</th><th>最後進入</th>';
    }

    if (chartContainer) chartContainer.innerHTML = '<div class="text-center text-muted w-100 py-5"><i class="fas fa-spinner fa-spin me-1"></i> 載入每日走勢中...</div>';
    if (tableBody) tableBody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4"><i class="fas fa-spinner fa-spin me-1"></i> 查詢明細中...</td></tr>';

    try {
        const resp = await fetch(window.toAppUrl(`/api/Stats/Daily?year=${year}&month=${month}`));
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        if (!data || !data.success) return;

        // 繪製每日趨勢 CSS Bar Chart
        if (chartContainer) {
            const trend = data.trend || [];
            if (trend.length === 0) {
                chartContainer.innerHTML = '<div class="text-center text-muted w-100 py-5">該月尚無瀏覽流量紀錄</div>';
            } else {
                let maxPv = 10;
                trend.forEach(t => { if (t.pv > maxPv) maxPv = t.pv; if (t.uv > maxPv) maxPv = t.uv; });

                let chartHtml = '';
                trend.forEach(t => {
                    const uvHeight = Math.max(6, Math.round((t.uv / maxPv) * 190));
                    const pvHeight = Math.max(6, Math.round((t.pv / maxPv) * 190));
                    const dayLabel = t.date.split('-')[2] + '日';
                    chartHtml += `
                        <div class="d-flex flex-column align-items-center flex-grow-1" style="min-width: 28px;" title="日期: ${t.date}&#10;不重複人數(UV): ${t.uv} 人&#10;總瀏覽量(PV): ${t.pv} 次">
                            <div class="d-flex align-items-end justify-content-center gap-1 w-100" style="height: 200px;">
                                <div class="rounded-top shadow-sm transition-all" style="width: 10px; height: ${uvHeight}px; background: linear-gradient(180deg, #10b981 0%, #059669 100%);"></div>
                                <div class="rounded-top shadow-sm transition-all" style="width: 10px; height: ${pvHeight}px; background: linear-gradient(180deg, #3b82f6 0%, #2563eb 100%);"></div>
                            </div>
                            <div class="small text-secondary mt-1" style="font-size: 0.75rem;">${dayLabel}</div>
                        </div>`;
                });
                chartContainer.innerHTML = chartHtml;
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
                initDataTable('dtStatsDetail', true);
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

    if (titleEl) titleEl.innerHTML = `<i class="fas fa-chart-bar text-primary me-2"></i>${year} 年度 — 各月份進站人數與瀏覽量走勢`;
    if (tableTitleEl) tableTitleEl.innerHTML = `<i class="fas fa-list text-secondary me-2"></i>${year} 年度 — 各月份彙總清單`;
    if (tableHeader) {
        tableHeader.innerHTML = '<th>月份</th><th>實際不重複使用人數 (月度 UV)</th><th>總累積瀏覽量 (月度 PV)</th><th>人均黏著度 (PV/UV)</th><th>流量強度評估</th>';
    }

    if (chartContainer) chartContainer.innerHTML = '<div class="text-center text-muted w-100 py-5"><i class="fas fa-spinner fa-spin me-1"></i> 載入月度走勢中...</div>';
    if (tableBody) tableBody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4"><i class="fas fa-spinner fa-spin me-1"></i> 查詢月份清單中...</td></tr>';

    try {
        const resp = await fetch(window.toAppUrl(`/api/Stats/Monthly?year=${year}`));
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        if (!data || !data.success) return;

        // 繪製月度趨勢 CSS Bar Chart
        if (chartContainer) {
            const monthly = data.monthly || [];
            if (monthly.length === 0) {
                chartContainer.innerHTML = '<div class="text-center text-muted w-100 py-5">年度尚無瀏覽紀錄</div>';
            } else {
                let maxPv = 10;
                monthly.forEach(m => { if (m.pv > maxPv) maxPv = m.pv; if (m.uv > maxPv) maxPv = m.uv; });

                let chartHtml = '';
                // 固定顯示 1~12 月
                for (let m = 1; m <= 12; m++) {
                    const item = monthly.find(x => x.month === m) || { uv: 0, pv: 0 };
                    const uvHeight = Math.max(6, Math.round((item.uv / maxPv) * 190));
                    const pvHeight = Math.max(6, Math.round((item.pv / maxPv) * 190));
                    chartHtml += `
                        <div class="d-flex flex-column align-items-center flex-grow-1" style="min-width: 40px;" title="${year}年${m}月&#10;不重複人數(UV): ${item.uv} 人&#10;總瀏覽量(PV): ${item.pv} 次">
                            <div class="d-flex align-items-end justify-content-center gap-2 w-100" style="height: 200px;">
                                <div class="rounded-top shadow-sm transition-all" style="width: 14px; height: ${uvHeight}px; background: linear-gradient(180deg, #10b981 0%, #059669 100%);"></div>
                                <div class="rounded-top shadow-sm transition-all" style="width: 14px; height: ${pvHeight}px; background: linear-gradient(180deg, #3b82f6 0%, #2563eb 100%);"></div>
                            </div>
                            <div class="small fw-bold text-secondary mt-1">${m}月</div>
                        </div>`;
                }
                chartContainer.innerHTML = chartHtml;
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
                initDataTable('dtStatsDetail', true);
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
