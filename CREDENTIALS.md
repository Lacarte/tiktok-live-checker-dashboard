# How to Get Your Credentials

To make the app work with your real data, you need two things: a **Sheet ID** and a **Google Search API Key**.

## 1. Get the Sheet ID
1. Open your Google Sheet in the browser.
2. Look at the URL. It looks like this:
   `https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit`
3. The **Sheet ID** is the long string between `/d/` and `/edit`.
   - In this example: `1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms`

## 2. Get the API Key (Google Cloud)
Since this app is client-side only, we use a public API key.
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. **Create a New Project** (e.g., named "TikTokAnalytics").
3. In the search bar at the top, type **"Google Sheets API"** and click on it.
4. Click **Enable**.
5. Go to the **Credentials** tab (left sidebar).
6. Click **+ CREATE CREDENTIALS** -> **API Key**.
7. Copy the generated key (starts with `AIza...`).

## 3. Important: Share Your Sheet
Because we are using a simple API Key (not OAuth login), the sheet must be readable by the code.
1. In your Google Sheet, click **Share** (top right).
2. Under "General access", change "Restricted" to **"Anyone with the link"**.
3. Set the role to **Viewer**.
   *(Note: This makes the sheet read-only accessible to anyone who has the ID. Since it's analytics, this is usually fine for personal tools).*

## 4. Updates `src/sheetService.js`
Open `src/sheetService.js` and paste your values:
```javascript
const SHEET_ID = "PASTE_YOUR_SHEET_ID_HERE";
const RANGE = "Sheet1!A:D"; // Make sure your tab is named 'Sheet1'
const API_KEY = "PASTE_YOUR_API_KEY_HERE";
```
