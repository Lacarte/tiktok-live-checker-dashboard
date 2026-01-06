import { fetchSheetData } from "./sheetService.js";
import { computeSessions, computeSessionsList } from "./sessions.js";
import { computeScore } from "./metrics.js";

// ==================== DOM ELEMENTS ====================
const refreshBtn = document.getElementById("refresh");
const datePicker = document.getElementById("datePicker");
const timeframeSelect = document.getElementById("timeframeSelect");
const pageTitle = document.getElementById("pageTitle");
const lastUpdatedEl = document.getElementById("lastUpdated");
const totalRecordsEl = document.getElementById("totalRecords");

// Tab Navigation
const navItems = document.querySelectorAll(".nav-item");
const tabContents = document.querySelectorAll(".tab-content");

// ==================== STATE ====================
let rawGlobalData = [];
let processedData = [];
let currentTab = "overview";
let currentSort = { key: "score", order: "desc" };

// Chart instances
let charts = {
    topScore: null,
    activityTime: null,
    sessionDist: null,
    followersDist: null,
    userMinutes: null,
    userFollowers: null,
    sessionLength: null,
    heatmap: null
};

// ==================== INITIALIZATION ====================
datePicker.valueAsDate = new Date();

// Tab Navigation
navItems.forEach(item => {
    item.addEventListener("click", () => {
        const tab = item.dataset.tab;
        switchTab(tab);
    });
});

function switchTab(tab) {
    currentTab = tab;

    // Update nav
    navItems.forEach(n => n.classList.remove("active"));
    document.querySelector(`[data-tab="${tab}"]`).classList.add("active");

    // Update content
    tabContents.forEach(c => c.classList.remove("active"));
    document.getElementById(`tab-${tab}`).classList.add("active");

    // Update title
    const titles = {
        overview: "Overview",
        rankings: "Rankings",
        "user-activity": "User Activity",
        sessions: "Sessions & Time",
        insights: "Insights & Anomalies"
    };
    pageTitle.textContent = titles[tab] || "Dashboard";

    // Re-render current tab
    renderCurrentTab();
}

// ==================== DATA LOADING ====================
const loadData = async () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = "Loading...";
    try {
        rawGlobalData = await fetchSheetData();
        lastUpdatedEl.textContent = `Updated: ${new Date().toLocaleTimeString()}`;
        totalRecordsEl.textContent = `Records: ${rawGlobalData.length}`;
        applyFilterAndRender();
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

// Ranking mode change
const rankingModeSelect = document.getElementById("rankingMode");
if (rankingModeSelect) {
    rankingModeSelect.onchange = () => {
        currentSort.key = rankingModeSelect.value;
        currentSort.order = "desc";
        renderRankingsTab();
    };
}

// User search
const userSearch = document.getElementById("userSearch");
if (userSearch) {
    userSearch.oninput = () => {
        const val = userSearch.value.toLowerCase();
        const user = processedData.find(u => u.nickname.toLowerCase() === val);
        if (user) {
            renderUserActivity(user);
        }
    };
}

// ==================== FILTERING ====================
function applyFilterAndRender() {
    if (!rawGlobalData.length) return;

    // Dynamic input type
    const timeframe = timeframeSelect.value;
    if (timeframe === "day") datePicker.type = "date";
    else if (timeframe === "week") datePicker.type = "week";
    else if (timeframe === "month") datePicker.type = "month";
    else datePicker.type = "date";

    // Filter rows
    const filteredRows = rawGlobalData.filter(r => {
        if (!r.datetime) return false;
        const d = r.datetime;

        if (timeframe === "all") return true;

        if (timeframe === "day") {
            return d.toISOString().split("T")[0] === datePicker.value;
        }

        if (timeframe === "week") {
            return isDateInSelectedWeek(d, datePicker.value);
        }

        if (timeframe === "month") {
            return d.toISOString().startsWith(datePicker.value);
        }
        return true;
    });

    // Process data
    processedData = processData(filteredRows);

    // Update user list for search
    updateUserList();

    // Render current tab
    renderCurrentTab();
}

function isDateInSelectedWeek(date, weekString) {
    if (!weekString) return false;
    const [year, week] = weekString.split("-W");
    const dYear = date.getFullYear();
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
        byUser[r.nickname] = byUser[r.nickname] || { records: [], followers: [] };
        byUser[r.nickname].records.push(r);
        byUser[r.nickname].followers.push(r.followers);
    });

    return Object.entries(byUser).map(([nickname, data]) => {
        const sortedRecords = data.records.sort((a, b) => a.datetime - b.datetime);
        const minutes = computeSessions(sortedRecords);
        const sessions = computeSessionsList(sortedRecords);
        const avgFollowers = data.followers.reduce((s, f) => s + f, 0) / data.followers.length;
        const maxFollowers = Math.max(...data.followers);

        return {
            nickname,
            minutes,
            sessions,
            sessionCount: sessions.length,
            avgFollowers,
            maxFollowers,
            score: computeScore(minutes, avgFollowers),
            records: sortedRecords,
            firstSeen: sortedRecords[0]?.datetime,
            lastSeen: sortedRecords[sortedRecords.length - 1]?.datetime,
            link: sortedRecords[0]?.link
        };
    });
}

function updateUserList() {
    const datalist = document.getElementById("userList");
    if (!datalist) return;
    datalist.innerHTML = "";
    processedData.forEach(u => {
        const opt = document.createElement("option");
        opt.value = u.nickname;
        datalist.appendChild(opt);
    });
}

// ==================== RENDERING ====================
function renderCurrentTab() {
    switch (currentTab) {
        case "overview":
            renderOverviewTab();
            break;
        case "rankings":
            renderRankingsTab();
            break;
        case "user-activity":
            // Keep current user if selected
            break;
        case "sessions":
            renderSessionsTab();
            break;
        case "insights":
            renderInsightsTab();
            break;
    }
}

// ==================== HELPERS ====================
const formatTime = (m) => {
    if (m >= 60) return `${(m / 60).toFixed(1)} hrs`;
    return `${m.toFixed(0)} min`;
};

const formatNumber = (n) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toFixed(0);
};

const formatDate = (d) => {
    if (!d) return "-";
    return d.toLocaleDateString();
};

// ==================== TAB 1: OVERVIEW ====================
function renderOverviewTab() {
    if (!processedData.length) return;

    // KPIs
    const totalMinutes = processedData.reduce((s, u) => s + u.minutes, 0);
    const totalSessions = processedData.reduce((s, u) => s + u.sessionCount, 0);
    const activeUsers = processedData.length;
    const avgSession = totalSessions > 0 ? totalMinutes / totalSessions : 0;

    const topScorer = [...processedData].sort((a, b) => b.score - a.score)[0];

    document.getElementById("kpi-total-minutes").textContent = formatTime(totalMinutes);
    document.getElementById("kpi-total-sessions").textContent = totalSessions;
    document.getElementById("kpi-active-users").textContent = activeUsers;
    document.getElementById("kpi-avg-session").textContent = formatTime(avgSession);
    document.getElementById("kpi-top-score-user").textContent = topScorer?.nickname || "-";
    document.getElementById("kpi-top-score-value").textContent = `Score: ${formatNumber(topScorer?.score || 0)}`;

    // Top 10 by Score Chart
    renderTopScoreChart();

    // Activity Over Time Chart
    renderActivityTimeChart();

    // Top 5 Panels
    renderTop5Panels();
}

function renderTopScoreChart() {
    const ctx = document.getElementById("topScoreChart");
    if (!ctx) return;

    const top10 = [...processedData].sort((a, b) => b.score - a.score).slice(0, 10);

    if (charts.topScore) charts.topScore.destroy();

    charts.topScore = new Chart(ctx, {
        type: "bar",
        data: {
            labels: top10.map(d => d.nickname),
            datasets: [{
                label: "Score",
                data: top10.map(d => d.score),
                backgroundColor: "#3b82f6",
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true },
                x: { ticks: { maxRotation: 45, minRotation: 45 } }
            }
        }
    });
}

function renderActivityTimeChart() {
    const ctx = document.getElementById("activityTimeChart");
    if (!ctx) return;

    // Group by hour or day depending on timeframe
    const timeframe = timeframeSelect.value;
    const byTime = {};

    rawGlobalData.forEach(r => {
        if (!r.datetime) return;
        let key;
        if (timeframe === "day") {
            key = r.datetime.getHours();
        } else {
            key = r.datetime.toISOString().split("T")[0];
        }
        byTime[key] = (byTime[key] || 0) + 1;
    });

    const labels = Object.keys(byTime).sort((a, b) => a - b);
    const data = labels.map(k => byTime[k]);

    if (charts.activityTime) charts.activityTime.destroy();

    charts.activityTime = new Chart(ctx, {
        type: "line",
        data: {
            labels: timeframe === "day" ? labels.map(h => `${h}:00`) : labels,
            datasets: [{
                label: "Activity (Records)",
                data: data,
                borderColor: "#16a34a",
                backgroundColor: "rgba(22, 163, 74, 0.1)",
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true } }
        }
    });
}

function renderTop5Panels() {
    // By Score
    const byScore = [...processedData].sort((a, b) => b.score - a.score).slice(0, 5);
    renderHighlightList("top5-score", byScore, u => formatNumber(u.score));

    // By Minutes
    const byMinutes = [...processedData].sort((a, b) => b.minutes - a.minutes).slice(0, 5);
    renderHighlightList("top5-minutes", byMinutes, u => formatTime(u.minutes));

    // By Sessions
    const bySessions = [...processedData].sort((a, b) => b.sessionCount - a.sessionCount).slice(0, 5);
    renderHighlightList("top5-sessions", bySessions, u => `${u.sessionCount} sessions`);

    // By Followers
    const byFollowers = [...processedData].sort((a, b) => b.avgFollowers - a.avgFollowers).slice(0, 5);
    renderHighlightList("top5-followers", byFollowers, u => formatNumber(u.avgFollowers));
}

function renderHighlightList(elementId, data, valueFormatter) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.innerHTML = "";
    data.forEach((u, i) => {
        const li = document.createElement("li");
        li.innerHTML = `
            <span class="name">${i + 1}. ${u.nickname}</span>
            <span class="value">${valueFormatter(u)}</span>
        `;
        el.appendChild(li);
    });
}

// ==================== TAB 2: RANKINGS ====================
function renderRankingsTab() {
    if (!processedData.length) return;

    // Sort data
    const sorted = [...processedData].sort((a, b) => {
        let valA = a[currentSort.key];
        let valB = b[currentSort.key];

        if (currentSort.key === "nickname") {
            valA = a.nickname.toLowerCase();
            valB = b.nickname.toLowerCase();
        } else if (currentSort.key === "sessions") {
            valA = a.sessionCount;
            valB = b.sessionCount;
        }

        if (valA < valB) return currentSort.order === "asc" ? -1 : 1;
        if (valA > valB) return currentSort.order === "asc" ? 1 : -1;
        return 0;
    });

    // Render table
    const tbody = document.getElementById("rankingBody");
    if (tbody) {
        tbody.innerHTML = "";
        sorted.forEach((u, i) => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${i + 1}</td>
                <td><a href="${u.link || '#'}" target="_blank">${u.nickname}</a></td>
                <td>${formatTime(u.minutes)}</td>
                <td>${u.sessionCount}</td>
                <td>${formatNumber(u.avgFollowers)}</td>
                <td>${formatNumber(u.maxFollowers)}</td>
                <td>${formatNumber(u.score)}</td>
                <td>${formatDate(u.firstSeen)}</td>
                <td>${formatDate(u.lastSeen)}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    // Distribution charts
    renderSessionDistChart();
    renderFollowersDistChart();
}

// Sortable headers
document.querySelectorAll("th.sortable").forEach(th => {
    th.addEventListener("click", () => {
        const key = th.dataset.sort;
        if (currentSort.key === key) {
            currentSort.order = currentSort.order === "asc" ? "desc" : "asc";
        } else {
            currentSort.key = key;
            currentSort.order = "desc";
        }
        renderRankingsTab();
    });
});

function renderSessionDistChart() {
    const ctx = document.getElementById("sessionDistChart");
    if (!ctx) return;

    // Create histogram buckets
    const buckets = { "0-15": 0, "15-30": 0, "30-60": 0, "60-120": 0, "120+": 0 };
    processedData.forEach(u => {
        const m = u.minutes;
        if (m <= 15) buckets["0-15"]++;
        else if (m <= 30) buckets["15-30"]++;
        else if (m <= 60) buckets["30-60"]++;
        else if (m <= 120) buckets["60-120"]++;
        else buckets["120+"]++;
    });

    if (charts.sessionDist) charts.sessionDist.destroy();

    charts.sessionDist = new Chart(ctx, {
        type: "bar",
        data: {
            labels: Object.keys(buckets).map(k => `${k} min`),
            datasets: [{
                label: "Users",
                data: Object.values(buckets),
                backgroundColor: "#f59e0b",
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true } }
        }
    });
}

function renderFollowersDistChart() {
    const ctx = document.getElementById("followersDistChart");
    if (!ctx) return;

    const buckets = { "0-100": 0, "100-500": 0, "500-1K": 0, "1K-10K": 0, "10K+": 0 };
    processedData.forEach(u => {
        const f = u.avgFollowers;
        if (f <= 100) buckets["0-100"]++;
        else if (f <= 500) buckets["100-500"]++;
        else if (f <= 1000) buckets["500-1K"]++;
        else if (f <= 10000) buckets["1K-10K"]++;
        else buckets["10K+"]++;
    });

    if (charts.followersDist) charts.followersDist.destroy();

    charts.followersDist = new Chart(ctx, {
        type: "bar",
        data: {
            labels: Object.keys(buckets),
            datasets: [{
                label: "Users",
                data: Object.values(buckets),
                backgroundColor: "#8b5cf6",
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true } }
        }
    });
}

// ==================== TAB 3: USER ACTIVITY ====================
function renderUserActivity(user) {
    if (!user) return;

    // Show sections
    document.getElementById("userSummary").style.display = "block";
    document.getElementById("userCharts").style.display = "grid";
    document.getElementById("userTimeline").style.display = "block";

    // Profile link
    const profileLink = document.getElementById("userProfileLink");
    if (profileLink && user.link) {
        profileLink.href = user.link;
        profileLink.style.display = "inline";
    }

    // Summary
    document.getElementById("selectedUserName").textContent = user.nickname;
    document.getElementById("user-total-minutes").textContent = formatTime(user.minutes);
    document.getElementById("user-sessions").textContent = user.sessionCount;
    document.getElementById("user-avg-session").textContent = formatTime(user.sessionCount > 0 ? user.minutes / user.sessionCount : 0);
    document.getElementById("user-avg-followers").textContent = formatNumber(user.avgFollowers);
    document.getElementById("user-max-followers").textContent = formatNumber(user.maxFollowers);

    // Consistency score (sessions per unique day)
    const uniqueDays = new Set(user.records.map(r => r.datetime.toISOString().split("T")[0])).size;
    const consistency = uniqueDays > 0 ? (user.sessionCount / uniqueDays).toFixed(1) : 0;
    document.getElementById("user-consistency").textContent = `${consistency} sessions/day`;

    // Charts
    renderUserMinutesChart(user);
    renderUserFollowersChart(user);
    renderUserTimeline(user);
}

function renderUserMinutesChart(user) {
    const ctx = document.getElementById("userMinutesChart");
    if (!ctx) return;

    // Group by day
    const byDay = {};
    user.records.forEach(r => {
        const day = r.datetime.toISOString().split("T")[0];
        byDay[day] = (byDay[day] || 0) + 1;
    });

    const labels = Object.keys(byDay).sort();
    const data = labels.map(d => byDay[d] * 5); // Approximate minutes (5 min per ping)

    if (charts.userMinutes) charts.userMinutes.destroy();

    charts.userMinutes = new Chart(ctx, {
        type: "line",
        data: {
            labels: labels,
            datasets: [{
                label: "Minutes",
                data: data,
                borderColor: "#3b82f6",
                backgroundColor: "rgba(59, 130, 246, 0.1)",
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true } }
        }
    });
}

function renderUserFollowersChart(user) {
    const ctx = document.getElementById("userFollowersChart");
    if (!ctx) return;

    const data = user.records.map(r => ({ x: r.datetime, y: r.followers }));

    if (charts.userFollowers) charts.userFollowers.destroy();

    charts.userFollowers = new Chart(ctx, {
        type: "line",
        data: {
            datasets: [{
                label: "Followers",
                data: data,
                borderColor: "#16a34a",
                backgroundColor: "rgba(22, 163, 74, 0.1)",
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { type: "time", time: { unit: "hour" } },
                y: { beginAtZero: true }
            }
        }
    });
}

function renderUserTimeline(user) {
    const container = document.getElementById("sessionTimeline");
    if (!container) return;
    container.innerHTML = "";

    // Create blocks for each hour over the data range
    if (!user.records.length) return;

    const startDate = new Date(user.firstSeen);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(user.lastSeen);
    endDate.setHours(23, 59, 59, 999);

    const hourMs = 60 * 60 * 1000;
    const recordTimes = new Set(user.records.map(r => Math.floor(r.datetime.getTime() / hourMs)));

    let current = new Date(startDate);
    while (current <= endDate) {
        const hourKey = Math.floor(current.getTime() / hourMs);
        const block = document.createElement("div");
        block.className = "timeline-block";
        block.title = current.toLocaleString();

        if (recordTimes.has(hourKey)) {
            block.classList.add("active");
        }

        container.appendChild(block);
        current = new Date(current.getTime() + hourMs);
    }
}

// ==================== TAB 4: SESSIONS & TIME ====================
function renderSessionsTab() {
    if (!processedData.length) return;

    renderSessionLengthHist();
    renderHeatmap();
    renderReliabilityMatrix();
}

function renderSessionLengthHist() {
    const ctx = document.getElementById("sessionLengthHist");
    if (!ctx) return;

    // Collect all session lengths
    const allSessions = processedData.flatMap(u => u.sessions.map(s => s.duration));

    const buckets = { "0-5": 0, "5-15": 0, "15-30": 0, "30-60": 0, "60-120": 0, "120+": 0 };
    allSessions.forEach(d => {
        if (d <= 5) buckets["0-5"]++;
        else if (d <= 15) buckets["5-15"]++;
        else if (d <= 30) buckets["15-30"]++;
        else if (d <= 60) buckets["30-60"]++;
        else if (d <= 120) buckets["60-120"]++;
        else buckets["120+"]++;
    });

    if (charts.sessionLength) charts.sessionLength.destroy();

    charts.sessionLength = new Chart(ctx, {
        type: "bar",
        data: {
            labels: Object.keys(buckets).map(k => `${k} min`),
            datasets: [{
                label: "Sessions",
                data: Object.values(buckets),
                backgroundColor: "#0891b2",
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true } }
        }
    });
}

function renderHeatmap() {
    const ctx = document.getElementById("heatmapChart");
    if (!ctx) return;

    // Activity by hour (6-23)
    const hours = Array.from({ length: 18 }, (_, i) => i + 6);
    const hourCounts = {};
    hours.forEach(h => hourCounts[h] = 0);

    rawGlobalData.forEach(r => {
        if (!r.datetime) return;
        const hour = r.datetime.getHours();
        if (hour >= 6 && hour <= 23) {
            hourCounts[hour]++;
        }
    });

    if (charts.heatmap) charts.heatmap.destroy();

    const maxCount = Math.max(...Object.values(hourCounts));

    charts.heatmap = new Chart(ctx, {
        type: "bar",
        data: {
            labels: hours.map(h => `${h}:00`),
            datasets: [{
                label: "Activity",
                data: hours.map(h => hourCounts[h]),
                backgroundColor: hours.map(h => {
                    const intensity = hourCounts[h] / maxCount;
                    return `rgba(59, 130, 246, ${0.3 + intensity * 0.7})`;
                }),
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true } }
        }
    });
}

function renderReliabilityMatrix() {
    const container = document.getElementById("reliabilityMatrix");
    if (!container) return;

    // Get unique days and top 10 users
    const allDays = new Set();
    rawGlobalData.forEach(r => {
        if (r.datetime) {
            allDays.add(r.datetime.toISOString().split("T")[0]);
        }
    });
    const days = [...allDays].sort().slice(-7); // Last 7 days
    const topUsers = [...processedData].sort((a, b) => b.minutes - a.minutes).slice(0, 10);

    // Build matrix data
    const matrix = {};
    topUsers.forEach(u => {
        matrix[u.nickname] = {};
        days.forEach(d => matrix[u.nickname][d] = 0);
    });

    rawGlobalData.forEach(r => {
        if (!r.datetime) return;
        const day = r.datetime.toISOString().split("T")[0];
        const nick = r.nickname;
        if (matrix[nick] && days.includes(day)) {
            matrix[nick][day]++;
        }
    });

    // Create table
    let html = '<table class="matrix-table"><thead><tr><th>User</th>';
    days.forEach(d => {
        html += `<th>${d.split("-").slice(1).join("/")}</th>`;
    });
    html += '</tr></thead><tbody>';

    topUsers.forEach(u => {
        html += `<tr><td>${u.nickname}</td>`;
        days.forEach(d => {
            const count = matrix[u.nickname][d];
            let cls = "empty";
            if (count > 5) cls = "green";
            else if (count > 0) cls = "yellow";
            else cls = "red";
            html += `<td class="matrix-cell ${cls}">${count || "-"}</td>`;
        });
        html += '</tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

// ==================== TAB 5: INSIGHTS ====================
function renderInsightsTab() {
    if (!processedData.length) return;

    // Highest Follower Spike
    let maxSpike = { user: null, spike: 0 };
    processedData.forEach(u => {
        if (u.records.length < 2) return;
        for (let i = 1; i < u.records.length; i++) {
            const spike = u.records[i].followers - u.records[i - 1].followers;
            if (spike > maxSpike.spike) {
                maxSpike = { user: u.nickname, spike };
            }
        }
    });
    document.getElementById("insight-follower-spike").textContent =
        maxSpike.user ? `${maxSpike.user} (+${formatNumber(maxSpike.spike)})` : "N/A";

    // Longest Continuous Presence
    let longestPresence = { user: null, minutes: 0 };
    processedData.forEach(u => {
        if (u.minutes > longestPresence.minutes) {
            longestPresence = { user: u.nickname, minutes: u.minutes };
        }
    });
    document.getElementById("insight-longest-presence").textContent =
        longestPresence.user ? `${longestPresence.user} (${formatTime(longestPresence.minutes)})` : "N/A";

    // Most Consistent Streamer
    let mostConsistent = { user: null, consistency: 0 };
    processedData.forEach(u => {
        const uniqueDays = new Set(u.records.map(r => r.datetime.toISOString().split("T")[0])).size;
        const consistency = uniqueDays;
        if (consistency > mostConsistent.consistency) {
            mostConsistent = { user: u.nickname, consistency };
        }
    });
    document.getElementById("insight-most-consistent").textContent =
        mostConsistent.user ? `${mostConsistent.user} (${mostConsistent.consistency} days)` : "N/A";

    // Highest Activity Burst (most records in single hour)
    const hourlyActivity = {};
    rawGlobalData.forEach(r => {
        if (!r.datetime) return;
        const key = `${r.nickname}-${r.datetime.toISOString().slice(0, 13)}`;
        hourlyActivity[key] = (hourlyActivity[key] || 0) + 1;
    });
    let maxBurst = { key: null, count: 0 };
    Object.entries(hourlyActivity).forEach(([key, count]) => {
        if (count > maxBurst.count) {
            maxBurst = { key, count };
        }
    });
    document.getElementById("insight-activity-burst").textContent =
        maxBurst.key ? `${maxBurst.key.split("-")[0]} (${maxBurst.count} pings/hr)` : "N/A";

    // Opportunity Signals
    renderOpportunitySignals();
    renderAnomalies();
}

function renderOpportunitySignals() {
    // Growth Opportunity: High followers, low time
    const avgMinutes = processedData.reduce((s, u) => s + u.minutes, 0) / processedData.length;
    const avgFollowers = processedData.reduce((s, u) => s + u.avgFollowers, 0) / processedData.length;

    const growthOpp = processedData
        .filter(u => u.avgFollowers > avgFollowers && u.minutes < avgMinutes)
        .sort((a, b) => b.avgFollowers - a.avgFollowers)
        .slice(0, 5);

    const growthList = document.getElementById("growth-opportunities");
    if (growthList) {
        growthList.innerHTML = "";
        if (growthOpp.length === 0) {
            growthList.innerHTML = "<li>No opportunities detected</li>";
        } else {
            growthOpp.forEach(u => {
                const li = document.createElement("li");
                li.innerHTML = `<span>${u.nickname}</span><span>${formatNumber(u.avgFollowers)} followers, ${formatTime(u.minutes)}</span>`;
                growthList.appendChild(li);
            });
        }
    }

    // Exposure Inefficiency: High time, low followers
    const exposureIssues = processedData
        .filter(u => u.minutes > avgMinutes && u.avgFollowers < avgFollowers)
        .sort((a, b) => b.minutes - a.minutes)
        .slice(0, 5);

    const exposureList = document.getElementById("exposure-issues");
    if (exposureList) {
        exposureList.innerHTML = "";
        if (exposureIssues.length === 0) {
            exposureList.innerHTML = "<li>No issues detected</li>";
        } else {
            exposureIssues.forEach(u => {
                const li = document.createElement("li");
                li.innerHTML = `<span>${u.nickname}</span><span>${formatTime(u.minutes)}, ${formatNumber(u.avgFollowers)} followers</span>`;
                exposureList.appendChild(li);
            });
        }
    }
}

function renderAnomalies() {
    const container = document.getElementById("anomalies-list");
    if (!container) return;

    const anomalies = [];

    // Detect sudden follower jumps
    processedData.forEach(u => {
        if (u.records.length < 2) return;
        for (let i = 1; i < u.records.length; i++) {
            const spike = u.records[i].followers - u.records[i - 1].followers;
            if (spike > 1000) {
                anomalies.push({
                    type: "spike",
                    title: `Follower spike: ${u.nickname}`,
                    desc: `+${formatNumber(spike)} followers in a single session`
                });
                break;
            }
        }
    });

    // Detect long offline gaps after high activity
    processedData.forEach(u => {
        if (u.records.length < 2) return;
        for (let i = 1; i < u.records.length; i++) {
            const gap = (u.records[i].datetime - u.records[i - 1].datetime) / (1000 * 60 * 60);
            if (gap > 24 && u.minutes > 60) {
                anomalies.push({
                    type: "gap",
                    title: `Long gap: ${u.nickname}`,
                    desc: `${gap.toFixed(0)} hours offline after active streaming`
                });
                break;
            }
        }
    });

    if (anomalies.length === 0) {
        container.innerHTML = '<p class="text-muted">No anomalies detected</p>';
    } else {
        container.innerHTML = anomalies.slice(0, 5).map(a => `
            <div class="anomaly-item">
                <span class="icon">${a.type === "spike" ? "📈" : "⏸️"}</span>
                <div class="content">
                    <div class="title">${a.title}</div>
                    <div class="desc">${a.desc}</div>
                </div>
            </div>
        `).join("");
    }
}

// ==================== AUTO LOAD ====================
loadData();
