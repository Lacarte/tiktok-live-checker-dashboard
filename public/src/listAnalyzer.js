// ==================== LIST ANALYZER MODULE ====================
// Analyzes uploaded JSON arrays of usernames against connection data

const LIST_ANALYZER_STORAGE_KEY = "tiktok-analytics-list-analyzer";

// State
let analyzerData = [];
let currentFilter = "all";

// DOM Elements
const uploadListBtn = document.getElementById("uploadListBtn");
const listAnalyzerFile = document.getElementById("listAnalyzerFile");
const uploadedFileName = document.getElementById("uploadedFileName");
const listAnalyzerResults = document.getElementById("listAnalyzerResults");
const analyzerTableBody = document.getElementById("analyzerTableBody");
const downloadFullInfoBtn = document.getElementById("downloadFullInfo");
const downloadSimpleListBtn = document.getElementById("downloadSimpleList");
const clearAnalyzerListBtn = document.getElementById("clearAnalyzerList");
const filterBtns = document.querySelectorAll(".filter-btn");

// Stats elements
const analyzerTotalEl = document.getElementById("analyzer-total");
const analyzerNeverEl = document.getElementById("analyzer-never");
const analyzerConnectedEl = document.getElementById("analyzer-connected");

/**
 * Initialize the list analyzer module
 * @param {Function} getDataFn - Function to get the raw global data
 * @param {Function} getTimezoneFn - Function to get the current timezone
 */
export function initListAnalyzer(getDataFn, getTimezoneFn) {
    // Load saved data from localStorage
    loadFromStorage();

    // Setup event listeners
    if (uploadListBtn && listAnalyzerFile) {
        uploadListBtn.addEventListener("click", () => {
            listAnalyzerFile.click();
        });

        listAnalyzerFile.addEventListener("change", (e) => {
            const file = e.target.files[0];
            if (file) {
                handleFileUpload(file, getDataFn, getTimezoneFn);
            }
        });
    }

    if (downloadFullInfoBtn) {
        downloadFullInfoBtn.addEventListener("click", () => downloadFullInfo(getTimezoneFn));
    }

    if (downloadSimpleListBtn) {
        downloadSimpleListBtn.addEventListener("click", downloadSimpleList);
    }

    if (clearAnalyzerListBtn) {
        clearAnalyzerListBtn.addEventListener("click", clearAnalyzerData);
    }

    // Filter buttons
    filterBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            currentFilter = btn.dataset.filter;
            filterBtns.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            renderTable(getTimezoneFn);
        });
    });

    // Initial render if we have data
    if (analyzerData.length > 0) {
        renderResults(getTimezoneFn);
    }
}

/**
 * Re-analyze the stored list with fresh data
 * @param {Function} getDataFn - Function to get the raw global data
 * @param {Function} getTimezoneFn - Function to get the current timezone
 */
export function refreshAnalyzerData(getDataFn, getTimezoneFn) {
    if (analyzerData.length === 0) return;

    const usernames = analyzerData.map(u => u.username);
    const rawData = getDataFn();
    analyzerData = analyzeUsernames(usernames, rawData);
    saveToStorage();
    renderResults(getTimezoneFn);
}

/**
 * Handle file upload
 */
function handleFileUpload(file, getDataFn, getTimezoneFn) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const content = e.target.result;
            const usernames = JSON.parse(content);

            if (!Array.isArray(usernames)) {
                alert("Invalid file format. Please upload a JSON array of usernames.");
                return;
            }

            // Validate that all items are strings
            const validUsernames = usernames.filter(u => typeof u === "string" && u.trim() !== "");

            if (validUsernames.length === 0) {
                alert("No valid usernames found in the file.");
                return;
            }

            // Clear old data before loading new list
            analyzerData = [];
            localStorage.removeItem(LIST_ANALYZER_STORAGE_KEY);

            // Analyze against connection data
            const rawData = getDataFn();
            analyzerData = analyzeUsernames(validUsernames, rawData);

            // Save to localStorage
            saveToStorage();

            // Update UI
            uploadedFileName.textContent = `Loaded: ${file.name} (${validUsernames.length} users)`;
            renderResults(getTimezoneFn);

        } catch (err) {
            console.error("Error parsing JSON:", err);
            alert("Error parsing JSON file. Please ensure it's a valid JSON array.");
        }
    };
    reader.readAsText(file);
}

/**
 * Analyze usernames against connection data
 */
function analyzeUsernames(usernames, rawData) {
    // Create a map of username -> records for quick lookup
    const userRecordsMap = new Map();

    rawData.forEach(record => {
        const nickname = record.nickname?.toLowerCase();
        if (nickname) {
            if (!userRecordsMap.has(nickname)) {
                userRecordsMap.set(nickname, []);
            }
            userRecordsMap.get(nickname).push(record);
        }
    });

    // Analyze each username
    return usernames.map(username => {
        const normalizedUsername = username.toLowerCase().trim();
        const records = userRecordsMap.get(normalizedUsername) || [];

        if (records.length === 0) {
            return {
                username: username.trim(),
                status: "never",
                lastConnected: null,
                lastConnectedDate: null,
                connectionCount: 0
            };
        }

        // Find the most recent connection
        let lastRecord = records[0];
        records.forEach(record => {
            if (record.datetime && (!lastRecord.datetime || record.datetime > lastRecord.datetime)) {
                lastRecord = record;
            }
        });

        return {
            username: username.trim(),
            status: "connected",
            lastConnected: lastRecord.datetime,
            lastConnectedDate: lastRecord.datetime ? lastRecord.datetime.toISOString() : null,
            connectionCount: records.length
        };
    });
}

/**
 * Calculate time ago string
 */
function getTimeAgo(date) {
    if (!date) return "-";

    const now = new Date();
    const diffMs = now - date;
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);
    const diffWeeks = Math.floor(diffDays / 7);
    const diffMonths = Math.floor(diffDays / 30);

    if (diffMonths > 0) {
        return { text: `${diffMonths} month${diffMonths > 1 ? 's' : ''} ago`, staleLevel: "very-stale" };
    }
    if (diffWeeks > 0) {
        return { text: `${diffWeeks} week${diffWeeks > 1 ? 's' : ''} ago`, staleLevel: diffWeeks > 2 ? "very-stale" : "stale" };
    }
    if (diffDays > 0) {
        return { text: `${diffDays} day${diffDays > 1 ? 's' : ''} ago`, staleLevel: diffDays > 3 ? "stale" : "" };
    }
    if (diffHours > 0) {
        return { text: `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`, staleLevel: "" };
    }
    if (diffMinutes > 0) {
        return { text: `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''} ago`, staleLevel: "" };
    }
    return { text: "Just now", staleLevel: "" };
}

/**
 * Render results
 */
function renderResults(getTimezoneFn) {
    if (!listAnalyzerResults) return;

    listAnalyzerResults.style.display = "block";

    // Update stats
    const total = analyzerData.length;
    const neverConnected = analyzerData.filter(u => u.status === "never").length;
    const connected = analyzerData.filter(u => u.status === "connected").length;

    if (analyzerTotalEl) analyzerTotalEl.textContent = total;
    if (analyzerNeverEl) analyzerNeverEl.textContent = neverConnected;
    if (analyzerConnectedEl) analyzerConnectedEl.textContent = connected;

    renderTable(getTimezoneFn);
}

/**
 * Render the table with current filter
 */
function renderTable(getTimezoneFn) {
    if (!analyzerTableBody) return;

    const tz = getTimezoneFn();

    // Filter data
    let filteredData = analyzerData;
    if (currentFilter === "never") {
        filteredData = analyzerData.filter(u => u.status === "never");
    } else if (currentFilter === "connected") {
        filteredData = analyzerData.filter(u => u.status === "connected");
    }

    // Sort: connected users by last connected date (most recent first), then never connected
    filteredData.sort((a, b) => {
        if (a.status === "never" && b.status === "never") return 0;
        if (a.status === "never") return 1;
        if (b.status === "never") return -1;
        // Both connected - sort by last connected (most recent first)
        const dateA = a.lastConnected ? new Date(a.lastConnected) : new Date(0);
        const dateB = b.lastConnected ? new Date(b.lastConnected) : new Date(0);
        return dateB - dateA;
    });

    analyzerTableBody.innerHTML = filteredData.map((user, index) => {
        const timeAgo = user.lastConnected ? getTimeAgo(new Date(user.lastConnected)) : { text: "-", staleLevel: "" };
        const lastConnectedStr = user.lastConnected
            ? new Date(user.lastConnected).toLocaleString("en-US", { timeZone: tz })
            : "-";

        const timeAgoClass = timeAgo.staleLevel ? `time-ago-${timeAgo.staleLevel}` : "";

        return `
            <tr data-username="${user.username}">
                <td>
                    <a href="https://www.tiktok.com/@${user.username}" target="_blank" rel="noopener">
                        ${user.username}
                    </a>
                </td>
                <td>
                    <span class="status-badge ${user.status}">
                        ${user.status === "never" ? "Never Connected" : "Connected"}
                    </span>
                </td>
                <td>${lastConnectedStr}</td>
                <td class="${timeAgoClass}">${timeAgo.text}</td>
                <td>
                    <button class="delete-user-btn" data-username="${user.username}" title="Remove from list">
                        ✕
                    </button>
                </td>
            </tr>
        `;
    }).join("");

    // Add delete button listeners
    analyzerTableBody.querySelectorAll(".delete-user-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const username = e.target.dataset.username;
            removeUser(username, getTimezoneFn);
        });
    });
}

/**
 * Remove a user from the list
 */
function removeUser(username, getTimezoneFn) {
    analyzerData = analyzerData.filter(u => u.username !== username);
    saveToStorage();
    renderResults(getTimezoneFn);

    if (analyzerData.length === 0) {
        listAnalyzerResults.style.display = "none";
        uploadedFileName.textContent = "";
    }
}

/**
 * Clear all analyzer data
 */
function clearAnalyzerData() {
    if (!confirm("Are you sure you want to clear the entire list?")) return;

    analyzerData = [];
    saveToStorage();
    listAnalyzerResults.style.display = "none";
    uploadedFileName.textContent = "";
}

/**
 * Download full info JSON
 */
function downloadFullInfo(getTimezoneFn) {
    const tz = getTimezoneFn();

    const fullData = analyzerData.map(user => {
        const timeAgo = user.lastConnected ? getTimeAgo(new Date(user.lastConnected)) : { text: "-", staleLevel: "" };
        return {
            username: user.username,
            status: user.status,
            lastConnected: user.lastConnected
                ? new Date(user.lastConnected).toLocaleString("en-US", { timeZone: tz })
                : null,
            lastConnectedISO: user.lastConnectedDate,
            timeAgo: timeAgo.text,
            connectionCount: user.connectionCount
        };
    });

    const blob = new Blob([JSON.stringify(fullData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `user-list-analysis-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

/**
 * Download simple username array
 */
function downloadSimpleList() {
    const usernames = analyzerData.map(u => u.username);

    const blob = new Blob([JSON.stringify(usernames, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `user-list-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

/**
 * Save to localStorage
 */
function saveToStorage() {
    localStorage.setItem(LIST_ANALYZER_STORAGE_KEY, JSON.stringify(analyzerData));
}

/**
 * Load from localStorage
 */
function loadFromStorage() {
    try {
        const stored = localStorage.getItem(LIST_ANALYZER_STORAGE_KEY);
        if (stored) {
            analyzerData = JSON.parse(stored);
            // Convert date strings back to Date objects
            analyzerData = analyzerData.map(user => ({
                ...user,
                lastConnected: user.lastConnectedDate ? new Date(user.lastConnectedDate) : null
            }));
        }
    } catch (err) {
        console.error("Error loading analyzer data from localStorage:", err);
        analyzerData = [];
    }
}
