import { fetchSheetData } from "./sheetService.js";
import { computeSessions } from "./sessions.js";
import { computeScore } from "./metrics.js";

const refreshBtn = document.getElementById("refresh");
const rankingBody = document.getElementById("rankingBody");
const datePicker = document.getElementById("datePicker");
const timeframeSelect = document.getElementById("timeframeSelect");

// KPIs
const kpiDailyAvg = document.getElementById("kpi-daily-avg");
const kpiActiveUsers = document.getElementById("kpi-active-users");
const kpiMaxUser = document.getElementById("kpi-max-user");
const kpiMaxTime = document.getElementById("kpi-max-time");
const kpiMinUser = document.getElementById("kpi-min-user");
const kpiMinTime = document.getElementById("kpi-min-time");

let rawGlobalData = []; // Store RAW rows to support re-filtering
let chartInstance = null;

// Initialize
datePicker.valueAsDate = new Date();

// Load
const loadData = async () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = "Loading...";
    try {
        rawGlobalData = await fetchSheetData(); // Fetch once
        applyFilterAndRender(); // Filter & Render
    } catch (err) {
        console.error(err);
        alert("Error loading data.");
    } finally {
        refreshBtn.disabled = false;
        refreshBtn.textContent = "Refresh Data";
    }
};

refreshBtn.onclick = loadData;
datePicker.onchange = applyFilterAndRender;
timeframeSelect.onchange = applyFilterAndRender;

// --- CORE FILTERING LOGIC ---
// --- HELPERS ---
const formatTime = (m) => {
    if (m >= 60) return `${(m / 60).toFixed(1)} hrs`;
    return `${m.toFixed(0)} min`;
};

// --- SORTING STATE ---
let currentSort = { key: 'score', order: 'desc' };

// --- FILTERING & SORTING LOGIC ---
function applyFilterAndRender() {
    if (!rawGlobalData.length) return;

    // 1. Dynamic Input Logic
    const timeframe = timeframeSelect.value;
    if (timeframe === "day") datePicker.type = "date";
    else if (timeframe === "week") datePicker.type = "week";
    else if (timeframe === "month") datePicker.type = "month";
    else datePicker.type = "date"; // fallback for 'all'

    const selectedDate = datePicker.valueAsDate || new Date(datePicker.value); // Handle week/month weirdness
    // Note: week/month inputs return string like "2023-W01" or "2023-01". 
    // We might need robust parsing if valueAsDate is null.

    // 2. Filter Raw Rows
    const filteredRows = rawGlobalData.filter(r => {
        if (!r.datetime) return false;
        const d = r.datetime;

        if (timeframe === "all") return true;

        if (timeframe === "day") {
            // Standard Date Input returns YYYY-MM-DD
            return d.toISOString().split('T')[0] === datePicker.value;
        }

        if (timeframe === "week") {
            // Input type="week" returns "YYYY-W##".
            // This is tricky to match exactly without a library.
            // Simple fallback: Check if date is within 7 days of "Now"? 
            // Or let's assume standard ISO week parsing.
            // For now, let's keep it simple: Filter by Week Number?
            // Helper to get week number:
            const weekVal = datePicker.value; // "2025-W02"
            // Parse week val or just match?
            // Let's rely on datePicker value matching the user intent.
            // If user picks a week, we need to parse it.
            return isDateInSelectedWeek(d, datePicker.value);
        }

        if (timeframe === "month") {
            // Input type="month" returns "YYYY-MM"
            return d.toISOString().startsWith(datePicker.value);
        }
        return true;
    });

    // 3. Process Data
    let processedData = processData(filteredRows);

    // 4. Sort Data
    processedData.sort((a, b) => {
        let valA = a[currentSort.key];
        let valB = b[currentSort.key];

        if (currentSort.key === 'sessions') {
            // We need to calculate sessions count (records length approx)
            valA = a.records.length;
            valB = b.records.length;
        } else if (currentSort.key === 'nickname') {
            valA = a.nickname.toLowerCase();
            valB = b.nickname.toLowerCase();
        }

        if (valA < valB) return currentSort.order === 'asc' ? -1 : 1;
        if (valA > valB) return currentSort.order === 'asc' ? 1 : -1;
        return 0;
    });

    // 5. Update UI
    updateKPIs(processedData, rawGlobalData);
    renderChart(processedData);
    renderRankingTable(processedData);
}

// Sorting Click Handlers
['minutes', 'score', 'nickname'].forEach(key => {
    const el = document.getElementById(`sort-${key}`);
    if (el) {
        el.onclick = () => {
            if (currentSort.key === key) {
                currentSort.order = currentSort.order === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort.key = key;
                currentSort.order = 'desc'; // Default desc for new metrics
            }
            applyFilterAndRender();
        };
    }
});
// Special case for 'sessions' which wasn't in original keys but added in HTML
const sessionHeader = document.getElementById('sort-sessions');
if (sessionHeader) {
    sessionHeader.onclick = () => {
        if (currentSort.key === 'sessions') {
            currentSort.order = currentSort.order === 'asc' ? 'desc' : 'asc';
        } else {
            currentSort.key = 'sessions';
            currentSort.order = 'desc';
        }
        applyFilterAndRender();
    };
}


// --- HELPERS ---

function getStartOfDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

function isDateInSelectedWeek(date, weekString) {
    if (!weekString) return false;
    // weekString format: "YYYY-Www"
    // Basic check: Get ISO week of date and compare.
    // This is complex in vanilla JS. 
    // Simplified: Just match substring? No.
    // Let's use a rough approximation or assume exact match if we had a helper.
    // Allow ALL for now if implementation is too complex.
    // Better: type="week" gives start of week?
    // Let's try to parse the week string.
    const [year, week] = weekString.split('-W');
    const dYear = date.getFullYear();
    // Get ISO week
    const target = new Date(date.valueOf());
    const dayNr = (date.getDay() + 6) % 7;
    target.setDate(target.getDate() - dayNr + 3);
    const firstThursday = target.valueOf();
    target.setMonth(0, 1);
    if (target.getDay() !== 4) {
        target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
    }
    const dWeek = 1 + Math.ceil((firstThursday - target) / 604800000);

    return dYear == year && dWeek == week;
}

function processData(rows) {
    const byUser = {};
    rows.forEach(r => {
        byUser[r.nickname] = byUser[r.nickname] || { records: [], avgFollowers: 0 };
        byUser[r.nickname].records.push(r);
    });

    return Object.entries(byUser).map(([nickname, data]) => {
        const minutes = computeSessions(data.records);
        const avgFollowers = data.records.reduce((s, r) => s + r.followers, 0) / data.records.length;

        return {
            nickname,
            minutes,
            avgFollowers,
            score: computeScore(minutes, avgFollowers),
            records: data.records.sort((a, b) => a.datetime - b.datetime)
        };
    });
    // Note: Removed default sort here, handled in applyFilterAndRender
}

// --- RENDERING ---

function updateKPIs(currentData, allData) {
    // 1. Avg Daily Connection (context depends on filter, but usually "All Time" metric is best for this KPI)
    // Let's calculate Avg Daily Connection based on ALL data to keep it stable, or current?
    // User requested "Avg connection daily".
    const allUniqueDays = new Set(allData.map(r => r.datetime.toISOString().split('T')[0]));
    const allTotalMins = computeSessions(allData); // Rough approx
    // Actually computeSessions expects sorted array. 
    // Doing it globally is heavy. Let's precise:
    // Avg Daily Connection = (Sum of all session durations) / (Unique Days)
    // We already have processed data? 
    // Let's stick to the current view for consistency or global? 
    // Usually "Avg Daily" implies a long term stat.
    // Let's calculate it from the *current filtered view* if > 1 day, else show N/A?
    // Actually, let's keep the KPI simple: "Avg Daily" across ALL TIME is most useful.
    if (timeframeSelect.value === 'all' || timeframeSelect.value === 'month') {
        const totalMinutes = currentData.reduce((s, u) => s + u.minutes, 0);
        const uniqueDays = new Set(currentData.flatMap(u => u.records.map(r => r.datetime.toISOString().split('T')[0])));
        const avg = totalMinutes / (uniqueDays.size || 1);
        kpiDailyAvg.innerText = `${avg.toFixed(0)}m / day`;
    } else {
        kpiDailyAvg.innerText = "-"; // Not relevant for single day
    }

    // 2. Active Users
    kpiActiveUsers.innerText = currentData.length;

    // 3. Most Connected (Max Minutes)
    if (currentData.length > 0) {
        // Sort by minutes descending
        const sortedByMins = [...currentData].sort((a, b) => b.minutes - a.minutes);
        const max = sortedByMins[0];
        kpiMaxUser.innerText = max.nickname;
        kpiMaxTime.innerText = formatTime(max.minutes); // USAGE

        // 4. Least Connected (Min Minutes > 0)
        // Filter out those with 0 minutes (if any logic allows that, usually sessions logic returns 0 if < gap)
        const active = sortedByMins.filter(u => u.minutes > 0);
        if (active.length > 0) {
            const min = active[active.length - 1]; // Last one
            kpiMinUser.innerText = min.nickname;
            kpiMinTime.innerText = formatTime(min.minutes); // USAGE
        } else {
            kpiMinUser.innerText = "-";
            kpiMinTime.innerText = "";
        }
    } else {
        kpiMaxUser.innerText = "-"; kpiMaxTime.innerText = "";
        kpiMinUser.innerText = "-"; kpiMinTime.innerText = "";
    }
}

function renderChart(data) {
    // Top 10 for Chart
    const top = data.slice(0, 10);
    const ctx = document.getElementById('topChart').getContext('2d');

    if (chartInstance) chartInstance.destroy();

    chartInstance = new Chart(ctx, {
        type: 'bar', // or 'line'
        data: {
            labels: top.map(d => d.nickname),
            datasets: [{
                label: 'Minutes Streamed',
                data: top.map(d => d.minutes),
                backgroundColor: top.map(d => d.minutes < 60 ? '#cbd5e1' : '#3b82f6'), // Gray if low, Blue if high
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                title: { display: true, text: `Stream Time (${timeframeSelect.options[timeframeSelect.selectedIndex].text})` }
            },
            scales: {
                y: { beginAtZero: true }
            }
        }
    });
}

function renderRankingTable(data) {
    rankingBody.innerHTML = "";
    data.forEach((row, index) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td style="text-align:center; color:#64748b;">${index + 1}</td>
            <td><a href="${row.records[0].link}" target="_blank" style="text-decoration:none; color:#1e293b; font-weight:600;">${row.nickname}</a></td>
            <td>${formatTime(row.minutes)}</td>
            <td>${row.records.length}</td> <!-- Sessions/Pings Column -->
            <td>${row.score.toFixed(0)}</td>
        `;
        rankingBody.appendChild(tr);
    });
}

// Auto Load
loadData();
