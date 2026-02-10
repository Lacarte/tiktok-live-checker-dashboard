const SHEET_ID = "1WkRvSCdwlLFs16EdBVVANjh9sG_wuCP8eJiVkMOd5RM";
const RANGE = "live_checker!A:D";
const API_KEY = "AIzaSyCmczFnl6hG0VNBOyeeKBD_RNqgUOPEr0U";

export async function fetchSheetData() {
  let rawRows = [];

  try {
    // 1. Check for placeholders
    if (SHEET_ID.includes("YOUR_SHEET") || API_KEY.includes("YOUR_API")) {
      console.warn("Using mock data (Placeholders detected).");
      rawRows = getMockRawRows();
    } else {
      // 2. Try Fetching
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${RANGE}?key=${API_KEY}`;
      const res = await fetch(url);

      if (!res.ok) {
        const errText = await res.text();
        console.error("Google API Error Details:", errText);

        if (res.status === 403) throw new Error("PERMISSION_DENIED");
        if (res.status === 404) throw new Error("SHEET_NOT_FOUND");
        throw new Error(`HTTP_ERROR_${res.status}`);
      }
      const json = await res.json();
      if (json.values && json.values.length > 1) {
        // [0] is header, slice(1) is data
        rawRows = json.values.slice(1);
      }
    }
  } catch (err) {
    console.error("Fetch failed:", err);

    // 3. Handle Errors with Alert & Fallback
    if (err.message === "PERMISSION_DENIED") {
      alert("⚠️ ACCESS DENIED (403)\n\nFalling back to MOCK DATA.\n\nPlease set your Sheet to 'Anyone with the link' (Viewer).");
    } else if (err.message === "SHEET_NOT_FOUND") {
      alert("⚠️ SHEET NOT FOUND (404)\n\nFalling back to MOCK DATA.");
    } else {
      alert(`⚠️ ERROR: ${err.message}\n\nFalling back to MOCK DATA.`);
    }

    rawRows = getMockRawRows();
  }

  // 4. Process Data (Always extract username logic)
  return processRows(rawRows);
}

// Parse follower counts that may be formatted like "1.7K" or "1.0M"
function parseFollowerCount(value) {
  if (value === null || value === undefined || value === "") return 0;

  // If already a number, return it
  if (typeof value === "number") return value;

  // Convert to string and trim
  const str = String(value).trim().toUpperCase();

  // Try parsing as plain number first
  const plainNum = Number(str);
  if (!isNaN(plainNum)) return plainNum;

  // Handle K (thousands) suffix
  if (str.endsWith("K")) {
    const num = parseFloat(str.slice(0, -1));
    if (!isNaN(num)) return Math.round(num * 1000);
  }

  // Handle M (millions) suffix
  if (str.endsWith("M")) {
    const num = parseFloat(str.slice(0, -1));
    if (!isNaN(num)) return Math.round(num * 1000000);
  }

  // Handle B (billions) suffix
  if (str.endsWith("B")) {
    const num = parseFloat(str.slice(0, -1));
    if (!isNaN(num)) return Math.round(num * 1000000000);
  }

  return 0;
}

function processRows(rows) {
  return rows.map(r => {
    // Column Structure:
    // A [0]: nickname (display name from TikTok)
    // B [1]: Followers
    // C [2]: Link (https://www.tiktok.com/@username/live)
    // D [3]: Timestamp (Unix timestamp in seconds)

    const link = r[2] || "";
    const displayNickname = r[0] || ""; // Original display name from TikTok
    let username = displayNickname; // Default to display name if extraction fails

    // ---------------------------------------------------------
    // EXTRACTION LOGIC: Get username from URL (Column C)
    // ---------------------------------------------------------
    try {
      if (link.includes("@")) {
        // "https://.../@username/live" -> split by '@' -> "username/live" -> split by '/' -> "username"
        const afterAt = link.split("@")[1];
        if (afterAt) {
          username = afterAt.split("/")[0];
        }
      }
    } catch (e) {
      console.warn("Regex failed for:", link);
    }
    // ---------------------------------------------------------

    // Parse timestamp - handle both Unix timestamp (seconds) and ISO string
    let datetime;
    const rawTimestamp = r[3];
    if (rawTimestamp) {
      // Check if it's a numeric timestamp (Unix seconds or milliseconds)
      const numericTs = Number(rawTimestamp);
      if (!isNaN(numericTs)) {
        // Unix timestamps in seconds are ~10 digits (before year 2286)
        // Unix timestamps in milliseconds are ~13 digits
        // If less than 10000000000 (year 2286 in seconds), treat as seconds
        datetime = numericTs < 10000000000 ? new Date(numericTs * 1000) : new Date(numericTs);
      } else {
        // Fallback to parsing as string
        datetime = new Date(rawTimestamp);
      }
    } else {
      datetime = new Date();
    }

    return {
      nickname: username, // Username (from URL) for internal tracking/reliability
      displayNickname: displayNickname, // Original display name for tooltip
      followers: parseFollowerCount(r[1]),
      link: link, // Keep original link
      datetime: datetime
    };
  });
}

function getMockRawRows() {
  const now = new Date().toISOString();
  const ago = new Date(Date.now() - 3600000).toISOString(); // 1 hr ago

  // Return RAW arrays simulating Google Sheets response
  return [
    ["User One", "150", "https://www.tiktok.com/@extracted_user_1/live", ago],
    ["User One", "155", "https://www.tiktok.com/@extracted_user_1/live", now],
    ["Someone Else", "5000", "https://www.tiktok.com/@streamer_pro/live", ago],
  ];
}
