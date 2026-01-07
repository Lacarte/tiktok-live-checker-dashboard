import { fetchSheetData } from "./sheetService.js";
import { computeSessions, computeSessionsList } from "./sessions.js";
import { computeScore } from "./metrics.js";

// ==================== CHART.JS DARK THEME CONFIG ====================
Chart.defaults.color = '#94a3b8';
Chart.defaults.borderColor = '#334155';
Chart.defaults.backgroundColor = 'rgba(59, 130, 246, 0.5)';

// Dark theme colors for charts
const chartColors = {
    primary: '#3b82f6',
    primaryGlow: 'rgba(59, 130, 246, 0.3)',
    success: '#22c55e',
    successGlow: 'rgba(34, 197, 94, 0.2)',
    warning: '#f59e0b',
    warningGlow: 'rgba(245, 158, 11, 0.2)',
    cyan: '#06b6d4',
    cyanGlow: 'rgba(6, 182, 212, 0.2)',
    magenta: '#ec4899',
    magentaGlow: 'rgba(236, 72, 153, 0.2)',
    purple: '#a855f7',
    purpleGlow: 'rgba(168, 85, 247, 0.2)',
    grid: '#334155',
    text: '#94a3b8'
};

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
let autoRefreshInterval = null;
let currentSelectedUser = null; // Track currently selected user in User Activity tab
let isInitialLoad = true; // Track if this is the first load (don't play sound on page load)
let isManualVipChange = false; // Track if VIP list was just manually changed (don't play sound)
const AUTO_REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// VIP notification sound
const vipNotificationSound = new Audio("assets/new-vip.mp3");

// LocalStorage key for tracking online VIPs
const ONLINE_VIPS_KEY = "tiktok-analytics-online-vips";

// Track newly detected VIP users for animation (with timestamp for auto-expiry)
const NEW_VIPS_KEY = "tiktok-analytics-new-vips";
const NEW_VIP_HIGHLIGHT_DURATION = 3 * 60 * 1000; // 3 minutes in milliseconds

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

// ==================== TIMEZONE SETTINGS ====================
const TIMEZONE_KEY = "tiktok-analytics-timezone";
const DEFAULT_TIMEZONE = "America/New_York"; // EST by default

function getTimezone() {
    return localStorage.getItem(TIMEZONE_KEY) || DEFAULT_TIMEZONE;
}

function setTimezone(tz) {
    localStorage.setItem(TIMEZONE_KEY, tz);
}

// ==================== INITIALIZATION ====================
// Set date picker to today's date in the selected timezone
function setDatePickerToToday() {
    const tz = getTimezone();
    const todayInTz = new Date().toLocaleDateString("en-CA", { timeZone: tz }); // YYYY-MM-DD format
    datePicker.value = todayInTz;
}
setDatePickerToToday();

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
const loadingOverlay = document.getElementById("loadingOverlay");

const showLoading = () => {
    if (loadingOverlay) loadingOverlay.style.display = "flex";
};

const hideLoading = () => {
    if (loadingOverlay) loadingOverlay.style.display = "none";
};

const loadData = async () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = "Loading...";
    showLoading();
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
        hideLoading();
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

// User search - uses processedData (filtered by date)
const userSearch = document.getElementById("userSearch");
if (userSearch) {
    userSearch.oninput = () => {
        const val = userSearch.value.toLowerCase();
        const user = processedData.find(u => u.nickname.toLowerCase() === val);
        if (user) {
            currentSelectedUser = user.nickname; // Track selected user
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

    const tz = getTimezone();

    // Filter rows using selected timezone
    const filteredRows = rawGlobalData.filter(r => {
        if (!r.datetime) return false;
        const d = r.datetime;

        // Check if datetime is valid
        if (isNaN(d.getTime())) return false;

        if (timeframe === "all") return true;

        if (timeframe === "day") {
            // Get date in selected timezone (YYYY-MM-DD format)
            const dateInTz = d.toLocaleDateString("en-CA", { timeZone: tz });
            return dateInTz === datePicker.value;
        }

        if (timeframe === "week") {
            return isDateInSelectedWeek(d, datePicker.value, tz);
        }

        if (timeframe === "month") {
            // Get year-month in selected timezone
            const dateInTz = d.toLocaleDateString("en-CA", { timeZone: tz });
            return dateInTz.startsWith(datePicker.value);
        }
        return true;
    });

    // Process data
    processedData = processData(filteredRows);

    // Show/hide no data overlay
    updateNoDataOverlay(filteredRows.length, timeframe);

    // Update user list for search
    updateUserList();

    // Render current tab
    renderCurrentTab();

    // Refresh selected user's data if one is selected
    refreshSelectedUser();
}

// Refresh the currently selected user's data when filter changes
function refreshSelectedUser() {
    if (!currentSelectedUser) return;

    const user = processedData.find(u => u.nickname.toLowerCase() === currentSelectedUser.toLowerCase());

    if (user) {
        // User exists in filtered data - update their view
        renderUserActivity(user);
    } else {
        // User not in filtered data - hide user activity sections
        const userSummary = document.getElementById("userSummary");
        const userCharts = document.getElementById("userCharts");
        const userTimeline = document.getElementById("userTimeline");
        const userSessionDetails = document.getElementById("userSessionDetails");

        if (userSummary) userSummary.style.display = "none";
        if (userCharts) userCharts.style.display = "none";
        if (userTimeline) userTimeline.style.display = "none";
        if (userSessionDetails) userSessionDetails.style.display = "none";
    }
}

// ==================== NO DATA OVERLAY ====================
function updateNoDataOverlay(recordCount, timeframe) {
    const overlay = document.getElementById("noDataOverlay");
    const message = document.getElementById("noDataMessage");
    if (!overlay || !message) return;

    if (recordCount === 0 && timeframe !== "all") {
        // Build friendly message based on timeframe
        let periodText = "";
        if (timeframe === "day") {
            const selectedDate = new Date(datePicker.value);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            selectedDate.setHours(0, 0, 0, 0);

            if (selectedDate > today) {
                periodText = "This is a future date.";
            } else {
                periodText = `No records found for ${datePicker.value}.`;
            }
        } else if (timeframe === "week") {
            periodText = `No records found for the selected week.`;
        } else if (timeframe === "month") {
            periodText = `No records found for the selected month.`;
        }

        message.textContent = periodText;
        overlay.style.display = "flex";
    } else {
        overlay.style.display = "none";
    }
}

function isDateInSelectedWeek(date, weekString, tz) {
    if (!weekString) return false;
    const [year, week] = weekString.split("-W");

    // Get date components in selected timezone
    const dateInTz = new Date(date.toLocaleString("en-US", { timeZone: tz }));
    const dYear = dateInTz.getFullYear();

    const target = new Date(dateInTz.valueOf());
    const dayNr = (dateInTz.getDay() + 6) % 7;
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
        byUser[r.nickname] = byUser[r.nickname] || { records: [], followers: [], displayNickname: r.displayNickname || r.nickname };
        byUser[r.nickname].records.push(r);
        byUser[r.nickname].followers.push(r.followers);
        // Keep the most recent displayNickname
        if (r.displayNickname) {
            byUser[r.nickname].displayNickname = r.displayNickname;
        }
    });

    return Object.entries(byUser).map(([nickname, data]) => {
        const sortedRecords = data.records.sort((a, b) => a.datetime - b.datetime);
        const minutes = computeSessions(sortedRecords);
        const sessions = computeSessionsList(sortedRecords);
        const avgFollowers = data.followers.reduce((s, f) => s + f, 0) / data.followers.length;
        const maxFollowers = Math.max(...data.followers);

        return {
            nickname, // Username for internal tracking
            displayNickname: data.displayNickname || nickname, // Original nickname for tooltip
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
    // Use processedData so only users from filtered date are shown
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

// Initialize timezone select
const timezoneSelect = document.getElementById("timezoneSelect");
if (timezoneSelect) {
    // Load saved timezone
    timezoneSelect.value = getTimezone();

    // Save on change, update date picker, and re-filter/render
    timezoneSelect.addEventListener("change", (e) => {
        setTimezone(e.target.value);
        setDatePickerToToday(); // Update date picker to today in new timezone
        applyFilterAndRender(); // Re-filter and render with new timezone
    });
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
    const tz = getTimezone();
    return d.toLocaleDateString("en-US", { timeZone: tz });
};

const formatDateTime = (d) => {
    if (!d) return "-";
    const tz = getTimezone();
    return d.toLocaleString("en-US", { timeZone: tz });
};

const formatTimeOnly = (d, includeSeconds = false) => {
    if (!d) return "-";
    const tz = getTimezone();
    const options = {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit'
    };
    if (includeSeconds) {
        options.second = '2-digit';
    }
    return d.toLocaleTimeString("en-US", options);
};

const shortenName = (name, maxLength = 15) => {
    if (!name || name.length <= maxLength) return name;
    return name.substring(0, maxLength) + "...";
};

// ==================== USER MARKS (VIP & DELETED) ====================
const USER_MARKS_KEY = "tiktok-analytics-user-marks";

function getUserMarks() {
    const stored = localStorage.getItem(USER_MARKS_KEY);
    return stored ? JSON.parse(stored) : { vip: [], deleted: [] };
}

function saveUserMarks(marks) {
    localStorage.setItem(USER_MARKS_KEY, JSON.stringify(marks));
}

function toggleUserMark(nickname, markType) {
    const marks = getUserMarks();
    const list = marks[markType] || [];
    const index = list.indexOf(nickname);

    if (index === -1) {
        list.push(nickname);
    } else {
        list.splice(index, 1);
    }

    marks[markType] = list;
    saveUserMarks(marks);

    // If marking as VIP, set flag to prevent sound on re-render
    if (markType === "vip") {
        isManualVipChange = true;
    }

    renderLiveStatus(); // Re-render to update UI
}

function isUserMarked(nickname, markType) {
    const marks = getUserMarks();
    return (marks[markType] || []).includes(nickname);
}

// Close menus when clicking outside
document.addEventListener("click", (e) => {
    if (!e.target.closest(".user-menu-container")) {
        document.querySelectorAll(".user-menu-dropdown.show").forEach(menu => {
            menu.classList.remove("show");
        });
    }
});

// ==================== LIVE STATUS (NOW ONLINE & GHOST) ====================
function renderLiveStatus() {
    if (!rawGlobalData.length) return;

    const tz = getTimezone();
    const timeframe = timeframeSelect.value;

    // Check if we're viewing a past date (not today)
    const todayInTz = new Date().toLocaleDateString("en-CA", { timeZone: tz });
    const isViewingPastDate = timeframe === "day" && datePicker.value !== todayInTz;

    // Get timestamps from FILTERED data for the selected period
    const filteredTimestamps = [...new Set(
        processedData.flatMap(u => u.records.map(r => r.datetime?.getTime()))
    )].filter(Boolean).sort((a, b) => b - a);

    // Get all unique timestamps from RAW data (for current day detection)
    const allTimestamps = [...new Set(rawGlobalData.map(r => r.datetime?.getTime()))].filter(Boolean).sort((a, b) => b - a);

    if (filteredTimestamps.length < 1) {
        // No data for selected period - clear both lists
        const nowOnlineList = document.getElementById("now-online-list");
        const ghostList = document.getElementById("ghost-list");
        if (nowOnlineList) nowOnlineList.innerHTML = '<li class="empty-state">No users currently online</li>';
        if (ghostList) ghostList.innerHTML = '<li class="empty-state">No ghost users</li>';
        updateMarksCountBadge();
        return;
    }

    const nowOnline = [];
    const ghosts = [];
    let latestBlockTime = null; // Declare at outer scope for use in rendering

    if (isViewingPastDate) {
        // PAST DATE: Show last block users in Ghost section, Now Online is empty
        latestBlockTime = filteredTimestamps[0];
        const latestBlockThreshold = latestBlockTime - 1 * 60 * 1000; // 1 min tolerance

        // Find users in the last block of the past day
        processedData.forEach(user => {
            const userLatestRecord = user.records
                .filter(r => r.datetime)
                .sort((a, b) => b.datetime - a.datetime)[0];

            if (userLatestRecord && userLatestRecord.datetime.getTime() >= latestBlockThreshold) {
                // User was in the last block of this past day - show as ghost
                user.lastSeen = userLatestRecord.datetime;
                ghosts.push(user);
            }
        });

        // Don't check for VIP notifications on past dates
    } else {
        // CURRENT DATE or ALL TIME: Normal behavior
        if (allTimestamps.length < 1) return;

        latestBlockTime = allTimestamps[0];
        const latestBlockThreshold = latestBlockTime - 1 * 60 * 1000; // 1 min tolerance for same block

        // Find users in the latest block (from raw data - current status)
        const latestBlockUsers = new Set();
        rawGlobalData.forEach(r => {
            if (r.datetime && r.datetime.getTime() >= latestBlockThreshold) {
                latestBlockUsers.add(r.nickname);
            }
        });

        // Find the previous block (first timestamp that's outside the latest block threshold)
        let previousBlockTime = null;
        for (const ts of allTimestamps) {
            if (ts < latestBlockThreshold) {
                previousBlockTime = ts;
                break;
            }
        }

        // Now Online: users in the latest block (that are also in filtered data)
        processedData.forEach(user => {
            if (latestBlockUsers.has(user.nickname)) {
                nowOnline.push(user);
            }
        });

        // Check for new VIP users online and play notification sound
        checkForNewOnlineVips(nowOnline);

        // Ghost detection: only if gap between last two blocks is < 60 minutes
        if (previousBlockTime) {
            const gapMinutes = (latestBlockTime - previousBlockTime) / (1000 * 60);

            if (gapMinutes < 60) {
                // Find users in the previous block
                const previousBlockThreshold = previousBlockTime - 1 * 60 * 1000; // 1 min tolerance
                const previousBlockUsers = new Set();
                rawGlobalData.forEach(r => {
                    if (r.datetime && r.datetime.getTime() >= previousBlockThreshold && r.datetime.getTime() < latestBlockThreshold) {
                        previousBlockUsers.add(r.nickname);
                    }
                });

                // Ghost: was in previous block but NOT in latest block
                processedData.forEach(user => {
                    if (previousBlockUsers.has(user.nickname) && !latestBlockUsers.has(user.nickname)) {
                        ghosts.push(user);
                    }
                });
            }
        }
    }

    // Clean up expired new VIP highlights before rendering
    cleanupExpiredNewVips();

    // Render Now Online
    const nowOnlineList = document.getElementById("now-online-list");
    if (nowOnlineList) {
        nowOnlineList.innerHTML = "";

        if (nowOnline.length === 0) {
            nowOnlineList.innerHTML = '<li class="empty-state">No users currently online</li>';
        } else {
            nowOnline.forEach(user => {
                const isVip = isUserMarked(user.nickname, "vip");
                const isMarkedDelete = isUserMarked(user.nickname, "toDelete");
                const hasNewVipHighlight = isVip && isNewVipHighlight(user.nickname);
                const li = document.createElement("li");
                li.className = `${isVip ? "vip-user" : ""} ${isMarkedDelete ? "marked-delete" : ""} ${hasNewVipHighlight ? "new-vip-highlight" : ""}`.trim();

                // Truncate username to 12 chars, tooltip shows: full username | full nickname
                const username = user.nickname;
                const displayNickname = user.displayNickname || username;
                const labelName = username.length > 12 ? username.substring(0, 12) + "..." : username;
                const tooltip = `${username} | ${displayNickname}`;

                li.innerHTML = `
                    <div class="user-item">
                        ${isMarkedDelete ? '<span class="delete-badge" title="Marked for deletion">❌</span>' : ''}
                        ${isVip && !isMarkedDelete ? '<span class="vip-badge" title="VIP">👁️</span>' : ''}
                        <a href="${user.link || '#'}" target="_blank" title="${tooltip}">${labelName}</a>
                        <div class="user-menu-container">
                            <button class="user-menu-btn" title="Options">☰</button>
                            <div class="user-menu-dropdown">
                                <button class="menu-option ${isVip ? 'active' : ''}" data-action="vip" data-user="${user.nickname}">
                                    👁️ ${isVip ? 'Remove VIP' : 'Mark as VIP'}
                                </button>
                                <button class="menu-option delete ${isMarkedDelete ? 'active' : ''}" data-action="toDelete" data-user="${user.nickname}">
                                    ❌ ${isMarkedDelete ? 'Unmark Delete' : 'Mark for Delete'}
                                </button>
                            </div>
                        </div>
                    </div>
                `;
                nowOnlineList.appendChild(li);
            });

            // Attach event listeners
            attachUserMenuListeners(nowOnlineList);
        }
    }

    // Render Ghost
    const ghostList = document.getElementById("ghost-list");
    if (ghostList) {
        ghostList.innerHTML = "";

        if (ghosts.length === 0) {
            ghostList.innerHTML = isViewingPastDate
                ? '<li class="empty-state">No users in last block</li>'
                : '<li class="empty-state">No ghost users</li>';
        } else {
            ghosts.forEach(user => {
                const isVip = isUserMarked(user.nickname, "vip");
                const isMarkedDelete = isUserMarked(user.nickname, "toDelete");
                const hasNewVipHighlight = isVip && isNewVipHighlight(user.nickname);
                const li = document.createElement("li");
                li.className = `${isVip ? "vip-user" : ""} ${isMarkedDelete ? "marked-delete" : ""} ${hasNewVipHighlight ? "new-vip-highlight" : ""}`.trim();

                // Truncate username to 12 chars, tooltip shows: full username | full nickname
                const username = user.nickname;
                const displayNickname = user.displayNickname || username;
                const labelName = username.length > 12 ? username.substring(0, 12) + "..." : username;

                // Different tooltip for past dates vs current date
                let timeInfo;
                if (isViewingPastDate) {
                    timeInfo = `Last seen: ${formatTimeOnly(user.lastSeen, true)}`;
                } else {
                    const minAgo = Math.round((latestBlockTime - (user.lastSeen?.getTime() || 0)) / (1000 * 60));
                    timeInfo = `Left ${minAgo} min ago`;
                }
                // Tooltip: full username | full nickname + time info
                const tooltip = `${username} | ${displayNickname} - ${timeInfo}`;

                li.innerHTML = `
                    <div class="user-item">
                        ${isMarkedDelete ? '<span class="delete-badge" title="Marked for deletion">❌</span>' : ''}
                        ${isVip && !isMarkedDelete ? '<span class="vip-badge" title="VIP">👁️</span>' : ''}
                        <a href="${user.link || '#'}" target="_blank" title="${tooltip}">${labelName}</a>
                        <div class="user-menu-container">
                            <button class="user-menu-btn" title="Options">☰</button>
                            <div class="user-menu-dropdown">
                                <button class="menu-option ${isVip ? 'active' : ''}" data-action="vip" data-user="${user.nickname}">
                                    👁️ ${isVip ? 'Remove VIP' : 'Mark as VIP'}
                                </button>
                                <button class="menu-option delete ${isMarkedDelete ? 'active' : ''}" data-action="toDelete" data-user="${user.nickname}">
                                    ❌ ${isMarkedDelete ? 'Unmark Delete' : 'Mark for Delete'}
                                </button>
                            </div>
                        </div>
                    </div>
                `;
                ghostList.appendChild(li);
            });

            // Attach event listeners
            attachUserMenuListeners(ghostList);
        }
    }

    // Update marks count badge
    updateMarksCountBadge();
}

function updateMarksCountBadge() {
    const marksCountBadge = document.getElementById("marksCountBadge");
    if (marksCountBadge) {
        const marks = getUserMarks();
        const total = (marks.vip?.length || 0) + (marks.toDelete?.length || 0);
        marksCountBadge.textContent = total;
    }
}

// Get previously online VIPs from localStorage
function getPreviousOnlineVips() {
    try {
        const stored = localStorage.getItem(ONLINE_VIPS_KEY);
        if (stored) {
            return new Set(JSON.parse(stored));
        }
    } catch (err) {
        console.warn("Error reading online VIPs from localStorage:", err);
    }
    return new Set();
}

// Save current online VIPs to localStorage
function saveOnlineVips(vipsSet) {
    try {
        localStorage.setItem(ONLINE_VIPS_KEY, JSON.stringify([...vipsSet]));
    } catch (err) {
        console.warn("Error saving online VIPs to localStorage:", err);
    }
}

// Get new VIPs with their detection timestamps (for animation)
function getNewVipsWithTimestamps() {
    try {
        const stored = localStorage.getItem(NEW_VIPS_KEY);
        if (stored) {
            return JSON.parse(stored); // { nickname: timestamp }
        }
    } catch (err) {
        console.warn("Error reading new VIPs from localStorage:", err);
    }
    return {};
}

// Save new VIPs with timestamps
function saveNewVipsWithTimestamps(newVipsMap) {
    try {
        localStorage.setItem(NEW_VIPS_KEY, JSON.stringify(newVipsMap));
    } catch (err) {
        console.warn("Error saving new VIPs to localStorage:", err);
    }
}

// Check if a user should have the new VIP highlight animation
function isNewVipHighlight(nickname) {
    const newVips = getNewVipsWithTimestamps();
    const detectedAt = newVips[nickname];
    if (!detectedAt) return false;

    const elapsed = Date.now() - detectedAt;
    return elapsed < NEW_VIP_HIGHLIGHT_DURATION;
}

// Add a new VIP to the highlight list
function addNewVipHighlight(nickname) {
    const newVips = getNewVipsWithTimestamps();
    newVips[nickname] = Date.now();
    saveNewVipsWithTimestamps(newVips);
}

// Clean up expired new VIP highlights
function cleanupExpiredNewVips() {
    const newVips = getNewVipsWithTimestamps();
    const now = Date.now();
    let hasChanges = false;

    for (const nickname in newVips) {
        if (now - newVips[nickname] >= NEW_VIP_HIGHLIGHT_DURATION) {
            delete newVips[nickname];
            hasChanges = true;
        }
    }

    if (hasChanges) {
        saveNewVipsWithTimestamps(newVips);
    }
}

// Check for new VIP users coming online and play notification sound
function checkForNewOnlineVips(nowOnline) {
    const marks = getUserMarks();
    const vipList = marks.vip || [];

    // Get current online VIP users
    const currentOnlineVips = new Set();
    nowOnline.forEach(user => {
        if (vipList.includes(user.nickname)) {
            currentOnlineVips.add(user.nickname);
        }
    });

    // Get previous online VIPs from localStorage
    const previousOnlineVips = getPreviousOnlineVips();

    // Find new VIP users (online now but weren't before)
    const newVips = [];
    currentOnlineVips.forEach(nickname => {
        if (!previousOnlineVips.has(nickname)) {
            newVips.push(nickname);
        }
    });

    // Play sound and add highlight if there are new VIP users online (but not on initial page load or manual VIP change)
    if (newVips.length > 0 && !isInitialLoad && !isManualVipChange) {
        console.log("New VIP user(s) online:", newVips.join(", "));
        playVipNotificationSound();

        // Add new VIPs to highlight list for animation
        newVips.forEach(nickname => addNewVipHighlight(nickname));
    }

    // Save current state to localStorage for next comparison
    saveOnlineVips(currentOnlineVips);

    // Reset flags
    if (isInitialLoad) {
        isInitialLoad = false;
    }
    if (isManualVipChange) {
        isManualVipChange = false;
    }
}

// Play the VIP notification sound
function playVipNotificationSound() {
    try {
        vipNotificationSound.currentTime = 0; // Reset to start
        vipNotificationSound.play().catch(err => {
            console.warn("Could not play VIP notification sound:", err.message);
        });
    } catch (err) {
        console.warn("Error playing VIP notification sound:", err);
    }
}

function attachUserMenuListeners(container) {
    container.querySelectorAll(".user-menu-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const dropdown = btn.nextElementSibling;
            document.querySelectorAll(".user-menu-dropdown.show").forEach(menu => {
                if (menu !== dropdown) menu.classList.remove("show");
            });
            dropdown.classList.toggle("show");
        });
    });

    container.querySelectorAll(".menu-option").forEach(opt => {
        opt.addEventListener("click", (e) => {
            e.stopPropagation();
            const action = opt.dataset.action;
            const username = opt.dataset.user;
            toggleUserMark(username, action);
        });
    });
}

function renderMarksModal() {
    const vipList = document.getElementById("vip-list");
    const toDeleteList = document.getElementById("to-delete-list");
    const vipCount = document.getElementById("vip-count");
    const toDeleteCount = document.getElementById("to-delete-count");
    const marksCountBadge = document.getElementById("marksCountBadge");

    const marks = getUserMarks();
    const vipUsers = marks.vip || [];
    const toDeleteUsers = marks.toDelete || [];

    // Update count badges
    if (vipCount) vipCount.textContent = vipUsers.length;
    if (toDeleteCount) toDeleteCount.textContent = toDeleteUsers.length;
    if (marksCountBadge) marksCountBadge.textContent = vipUsers.length + toDeleteUsers.length;

    // Render VIP list
    if (vipList) {
        vipList.innerHTML = "";
        if (vipUsers.length === 0) {
            vipList.innerHTML = '<li class="empty-state">No VIP users</li>';
        } else {
            vipUsers.forEach(nickname => {
                const li = document.createElement("li");
                li.innerHTML = `
                    <span>${nickname}</span>
                    <button class="clear-user-btn" data-user="${nickname}" data-type="vip" title="Remove">✕</button>
                `;
                vipList.appendChild(li);
            });
        }
    }

    // Render To Delete list
    if (toDeleteList) {
        toDeleteList.innerHTML = "";
        if (toDeleteUsers.length === 0) {
            toDeleteList.innerHTML = '<li class="empty-state">No users marked for deletion</li>';
        } else {
            toDeleteUsers.forEach(nickname => {
                const li = document.createElement("li");
                li.innerHTML = `
                    <span>${nickname}</span>
                    <button class="clear-user-btn" data-user="${nickname}" data-type="toDelete" title="Remove">✕</button>
                `;
                toDeleteList.appendChild(li);
            });
        }
    }

    // Attach clear individual user listeners
    document.querySelectorAll("#marksModal .clear-user-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const username = btn.dataset.user;
            const type = btn.dataset.type;
            toggleUserMark(username, type);
            renderMarksModal();
        });
    });
}

function clearAllVip() {
    if (confirm("Are you sure you want to clear all VIP users?")) {
        const marks = getUserMarks();
        marks.vip = [];
        saveUserMarks(marks);
        renderMarksModal();
        renderLiveStatus();
    }
}

function clearAllToDelete() {
    if (confirm("Are you sure you want to clear all users marked for deletion?")) {
        const marks = getUserMarks();
        marks.toDelete = [];
        saveUserMarks(marks);
        renderMarksModal();
        renderLiveStatus();
    }
}

// Modal controls
const marksModal = document.getElementById("marksModal");
const viewMarksBtn = document.getElementById("viewMarksBtn");
const closeMarksModal = document.getElementById("closeMarksModal");

if (viewMarksBtn) {
    viewMarksBtn.addEventListener("click", () => {
        renderMarksModal();
        marksModal.style.display = "flex";
    });
}

if (closeMarksModal) {
    closeMarksModal.addEventListener("click", () => {
        marksModal.style.display = "none";
    });
}

if (marksModal) {
    marksModal.addEventListener("click", (e) => {
        if (e.target === marksModal) {
            marksModal.style.display = "none";
        }
    });
}

// Attach clear all button listeners
const clearAllVipBtn = document.getElementById("clear-all-vip");
const clearAllDeleteBtn = document.getElementById("clear-all-delete");

if (clearAllVipBtn) {
    clearAllVipBtn.addEventListener("click", clearAllVip);
}

if (clearAllDeleteBtn) {
    clearAllDeleteBtn.addEventListener("click", clearAllToDelete);
}

// ==================== IMPORT/EXPORT USER MARKS ====================
function exportUserMarks() {
    const marks = getUserMarks();
    const dataStr = JSON.stringify(marks, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `tiktok-analytics-marks-${new Date().toISOString().split("T")[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function importUserMarks(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const imported = JSON.parse(e.target.result);

            // Validate structure
            if (typeof imported !== "object" || imported === null) {
                throw new Error("Invalid format");
            }

            // Merge with existing marks
            const currentMarks = getUserMarks();

            // Merge VIP list
            if (Array.isArray(imported.vip)) {
                const vipSet = new Set([...currentMarks.vip, ...imported.vip]);
                currentMarks.vip = [...vipSet];
            }

            // Merge toDelete list (handle both "deleted" and "toDelete" keys)
            const importedDelete = imported.toDelete || imported.deleted || [];
            if (Array.isArray(importedDelete)) {
                const deleteSet = new Set([...currentMarks.toDelete || [], ...importedDelete]);
                currentMarks.toDelete = [...deleteSet];
            }

            saveUserMarks(currentMarks);
            renderLiveStatus();
            alert(`Import successful!\nVIP: ${currentMarks.vip.length} users\nTo Delete: ${(currentMarks.toDelete || []).length} users`);
        } catch (err) {
            console.error("Import error:", err);
            alert("Failed to import file. Please ensure it's a valid JSON file.");
        }
    };
    reader.readAsText(file);
}

// Attach export button listener
const exportBtn = document.getElementById("exportMarks");
if (exportBtn) {
    exportBtn.addEventListener("click", exportUserMarks);
}

// Attach import button listener
const importBtn = document.getElementById("importMarks");
const importFile = document.getElementById("importFile");
if (importBtn && importFile) {
    importBtn.addEventListener("click", () => importFile.click());
    importFile.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (file) {
            importUserMarks(file);
            e.target.value = ""; // Reset file input
        }
    });
}

// ==================== TAB 1: OVERVIEW ====================
function renderOverviewTab() {
    if (!processedData.length) return;

    // Render live status sections
    renderLiveStatus();

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

    const topScoreUserEl = document.getElementById("kpi-top-score-user");
    if (topScoreUserEl && topScorer) {
        topScoreUserEl.textContent = shortenName(topScorer.nickname, 10);
        topScoreUserEl.title = topScorer.nickname;
    } else if (topScoreUserEl) {
        topScoreUserEl.textContent = "-";
    }
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
            labels: top10.map(d => shortenName(d.nickname, 12)),
            datasets: [{
                label: "Score",
                data: top10.map(d => d.score),
                backgroundColor: chartColors.primary,
                borderColor: chartColors.primary,
                borderRadius: 6,
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: chartColors.grid },
                    ticks: { color: chartColors.text }
                },
                x: {
                    ticks: { maxRotation: 45, minRotation: 45, color: chartColors.text },
                    grid: { display: false }
                }
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
    const tz = getTimezone();

    // Use filtered data (processedData) to respect date filter
    processedData.forEach(u => {
        u.records.forEach(r => {
            if (!r.datetime) return;
            let key;
            if (timeframe === "day") {
                // Get hour in selected timezone
                key = parseInt(r.datetime.toLocaleString("en-US", { timeZone: tz, hour: 'numeric', hour12: false }));
            } else {
                // Get date in selected timezone
                key = r.datetime.toLocaleDateString("en-CA", { timeZone: tz }); // en-CA gives YYYY-MM-DD format
            }
            byTime[key] = (byTime[key] || 0) + 1;
        });
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
                borderColor: chartColors.success,
                backgroundColor: chartColors.successGlow,
                fill: true,
                tension: 0.4,
                pointBackgroundColor: chartColors.success,
                pointBorderColor: chartColors.success,
                pointRadius: 3,
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: chartColors.grid },
                    ticks: { color: chartColors.text }
                },
                x: {
                    grid: { color: chartColors.grid },
                    ticks: { color: chartColors.text }
                }
            }
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
        const displayName = shortenName(u.nickname, 20);
        const needsTooltip = u.nickname.length > 20;
        li.innerHTML = `
            <span class="name" ${needsTooltip ? `title="${u.nickname}"` : ""}>${i + 1}. ${displayName}</span>
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
                backgroundColor: chartColors.warning,
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: chartColors.grid },
                    ticks: { color: chartColors.text }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: chartColors.text }
                }
            }
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
                backgroundColor: chartColors.purple,
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: chartColors.grid },
                    ticks: { color: chartColors.text }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: chartColors.text }
                }
            }
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
    document.getElementById("userSessionDetails").style.display = "block";

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

    // Consistency score (sessions per unique day) - timezone aware
    const tz = getTimezone();
    const uniqueDays = new Set(user.records.map(r => r.datetime.toLocaleDateString("en-CA", { timeZone: tz }))).size;
    const consistency = uniqueDays > 0 ? (user.sessionCount / uniqueDays).toFixed(1) : 0;
    document.getElementById("user-consistency").textContent = `${consistency} sessions/day`;

    // Render session details first (doesn't depend on Chart.js)
    renderSessionDetails(user);
    renderUserTimeline(user);

    // Charts (wrap in try-catch to prevent errors from blocking other renders)
    try {
        renderUserMinutesChart(user);
    } catch (err) {
        console.error("Error rendering minutes chart:", err);
    }

    try {
        renderUserFollowersChart(user);
    } catch (err) {
        console.error("Error rendering followers chart:", err);
    }
}

function renderSessionDetails(user) {
    const tbody = document.getElementById("sessionDetailsBody");
    if (!tbody) return;

    tbody.innerHTML = "";

    // Recompute sessions from records to ensure fresh data
    const sessions = user.records && user.records.length > 0
        ? computeSessionsList(user.records)
        : [];

    if (sessions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">No sessions recorded</td></tr>';
        return;
    }

    // Sort sessions by start time (most recent first)
    const sortedSessions = [...sessions].sort((a, b) => {
        const aTime = a.start instanceof Date ? a.start.getTime() : a.start;
        const bTime = b.start instanceof Date ? b.start.getTime() : b.start;
        return bTime - aTime;
    });

    sortedSessions.forEach((session, index) => {
        const tr = document.createElement("tr");

        // Handle both Date objects and timestamps
        const startDate = session.start instanceof Date ? session.start : new Date(session.start);
        const endDate = session.end instanceof Date ? session.end : new Date(session.end);

        // Use timezone-aware formatting
        const dateStr = formatDate(startDate);
        const startTime = formatTimeOnly(startDate, true);
        const endTime = formatTimeOnly(endDate, true);
        const duration = session.duration > 0 ? formatTime(session.duration) : "< 1 min";

        tr.innerHTML = `
            <td>${sortedSessions.length - index}</td>
            <td>${dateStr}</td>
            <td>${startTime}</td>
            <td>${endTime}</td>
            <td>${duration}</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderUserMinutesChart(user) {
    const ctx = document.getElementById("userMinutesChart");
    if (!ctx) return;

    // Group by day (timezone-aware)
    const byDay = {};
    const tz = getTimezone();
    user.records.forEach(r => {
        const day = r.datetime.toLocaleDateString("en-CA", { timeZone: tz }); // YYYY-MM-DD
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
                borderColor: chartColors.cyan,
                backgroundColor: chartColors.cyanGlow,
                fill: true,
                tension: 0.4,
                pointBackgroundColor: chartColors.cyan,
                pointBorderColor: chartColors.cyan,
                pointRadius: 3,
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: chartColors.grid },
                    ticks: { color: chartColors.text }
                },
                x: {
                    grid: { color: chartColors.grid },
                    ticks: { color: chartColors.text }
                }
            }
        }
    });
}

function renderUserFollowersChart(user) {
    const ctx = document.getElementById("userFollowersChart");
    if (!ctx) return;

    // Sort records by time and create labels/data arrays (timezone-aware)
    const sortedRecords = [...user.records].sort((a, b) => a.datetime - b.datetime);
    const labels = sortedRecords.map(r => formatTimeOnly(r.datetime));
    const data = sortedRecords.map(r => r.followers);

    if (charts.userFollowers) charts.userFollowers.destroy();

    charts.userFollowers = new Chart(ctx, {
        type: "line",
        data: {
            labels: labels,
            datasets: [{
                label: "Followers",
                data: data,
                borderColor: chartColors.magenta,
                backgroundColor: chartColors.magentaGlow,
                fill: true,
                tension: 0.4,
                pointBackgroundColor: chartColors.magenta,
                pointBorderColor: chartColors.magenta,
                pointRadius: 3,
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: {
                    grid: { color: chartColors.grid },
                    ticks: { color: chartColors.text, maxRotation: 45, minRotation: 45 }
                },
                y: {
                    beginAtZero: false,
                    grid: { color: chartColors.grid },
                    ticks: { color: chartColors.text }
                }
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
                backgroundColor: chartColors.cyan,
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: chartColors.grid },
                    ticks: { color: chartColors.text }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: chartColors.text }
                }
            }
        }
    });
}

function renderHeatmap() {
    const ctx = document.getElementById("heatmapChart");
    if (!ctx) return;

    // Activity by hour (0-23) in selected timezone
    const hours = Array.from({ length: 24 }, (_, i) => i);
    const hourCounts = {};
    hours.forEach(h => hourCounts[h] = 0);
    const tz = getTimezone();

    // Use filtered data (processedData) to respect date filter
    processedData.forEach(u => {
        u.records.forEach(r => {
            if (!r.datetime) return;
            // Get hour in selected timezone
            const hour = parseInt(r.datetime.toLocaleString("en-US", { timeZone: tz, hour: 'numeric', hour12: false }));
            if (hour >= 0 && hour <= 23) {
                hourCounts[hour]++;
            }
        });
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
                    return `rgba(6, 182, 212, ${0.3 + intensity * 0.7})`;
                }),
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: chartColors.grid },
                    ticks: { color: chartColors.text }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: chartColors.text }
                }
            }
        }
    });
}

function renderReliabilityMatrix() {
    const container = document.getElementById("reliabilityMatrix");
    if (!container) return;

    // Get unique days and top 10 users (timezone-aware) - use filtered data
    const allDays = new Set();
    const tz = getTimezone();
    processedData.forEach(u => {
        u.records.forEach(r => {
            if (r.datetime) {
                allDays.add(r.datetime.toLocaleDateString("en-CA", { timeZone: tz })); // YYYY-MM-DD format
            }
        });
    });
    const days = [...allDays].sort().slice(-7); // Last 7 days from filtered data
    const topUsers = [...processedData].sort((a, b) => b.minutes - a.minutes).slice(0, 10);

    // Build matrix data using filtered data
    const matrix = {};
    topUsers.forEach(u => {
        matrix[u.nickname] = {};
        days.forEach(d => matrix[u.nickname][d] = 0);
    });

    processedData.forEach(u => {
        u.records.forEach(r => {
            if (!r.datetime) return;
            const day = r.datetime.toLocaleDateString("en-CA", { timeZone: tz });
            const nick = u.nickname;
            if (matrix[nick] && days.includes(day)) {
                matrix[nick][day]++;
            }
        });
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

    // Highest Activity Burst (most records in single hour) - use filtered data
    const hourlyActivity = {};
    const tz = getTimezone();
    processedData.forEach(u => {
        u.records.forEach(r => {
            if (!r.datetime) return;
            // Use timezone-aware hour grouping
            const dateStr = r.datetime.toLocaleDateString("en-CA", { timeZone: tz });
            const hourStr = r.datetime.toLocaleString("en-US", { timeZone: tz, hour: "2-digit", hour12: false });
            const key = `${u.nickname}-${dateStr}-${hourStr}`;
            hourlyActivity[key] = (hourlyActivity[key] || 0) + 1;
        });
    });
    let maxBurst = { user: null, count: 0 };
    Object.entries(hourlyActivity).forEach(([key, count]) => {
        if (count > maxBurst.count) {
            maxBurst = { user: key.split("-")[0], count };
        }
    });
    document.getElementById("insight-activity-burst").textContent =
        maxBurst.user ? `${maxBurst.user} (${maxBurst.count} pings/hr)` : "N/A";

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

// ==================== AUTO REFRESH ====================
const autoRefreshToggle = document.getElementById("autoRefreshToggle");
const AUTO_REFRESH_STORAGE_KEY = "tiktok-analytics-auto-refresh";

function startAutoRefresh() {
    if (autoRefreshInterval) return;
    autoRefreshInterval = setInterval(() => {
        console.log("Auto-refreshing data...");
        loadData();
    }, AUTO_REFRESH_INTERVAL_MS);
}

function stopAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
    }
}

function saveAutoRefreshState(enabled) {
    localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, JSON.stringify(enabled));
}

function loadAutoRefreshState() {
    const stored = localStorage.getItem(AUTO_REFRESH_STORAGE_KEY);
    return stored ? JSON.parse(stored) : false;
}

if (autoRefreshToggle) {
    // Load saved state
    const savedState = loadAutoRefreshState();
    autoRefreshToggle.checked = savedState;
    if (savedState) {
        startAutoRefresh();
    }

    autoRefreshToggle.addEventListener("change", (e) => {
        const isEnabled = e.target.checked;
        saveAutoRefreshState(isEnabled);
        if (isEnabled) {
            startAutoRefresh();
        } else {
            stopAutoRefresh();
        }
    });
}

// ==================== AUTO LOAD ====================
loadData();
