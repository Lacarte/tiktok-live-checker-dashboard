const SHEET_ID = "1WkRvSCdwlLFs16EdBVVANjh9sG_wuCP8eJiVkMOd5RM";
const RANGE = "Sheet1!A:D";
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

function processRows(rows) {
  return rows.map(r => {
    // Column Structure:
    // A [0]: Display Name (Ignored)
    // B [1]: Followers
    // C [2]: Link (https://www.tiktok.com/@username/live)
    // D [3]: Timestamp

    const link = r[2] || "";
    let nickname = r[0]; // Default to Display Name

    // ---------------------------------------------------------
    // EXTRACTION LOGIC: Get username from URL (Column C)
    // ---------------------------------------------------------
    try {
      if (link.includes("@")) {
        // "https://.../@username/live" -> split by '@' -> "username/live" -> split by '/' -> "username"
        const afterAt = link.split("@")[1];
        if (afterAt) {
          nickname = afterAt.split("/")[0];
        }
      }
    } catch (e) {
      console.warn("Regex failed for:", link);
    }
    // ---------------------------------------------------------

    return {
      nickname: nickname,
      followers: Number(r[1]),
      link: link, // Keep original link
      datetime: new Date(r[3])
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
