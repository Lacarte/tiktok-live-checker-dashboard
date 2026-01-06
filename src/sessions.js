const MAX_GAP = 45 * 60 * 1000; // 45 min

export function computeSessions(records) {
    if (!records || records.length === 0) return 0;

    // Sort by time
    records.sort((a, b) => a.datetime - b.datetime);

    let totalConnected = 0;

    // If there's only one record, we assume a small duration or 0? 
    // The logic in the prompt loop starts at i=1, so single record returns 0.
    // We might want to assume at least some duration for a single ping, 
    // but following the user's logic exactly for now.

    for (let i = 1; i < records.length; i++) {
        const diff = records[i].datetime - records[i - 1].datetime;
        if (diff <= MAX_GAP) {
            // If gap is small, add the difference. 
            // But cap single interval contribution? Prompt said: Math.min(diff, 15 * 60 * 1000)
            // This handles if we missed pings but assume they were live up to 15 mins?
            totalConnected += Math.min(diff, 15 * 60 * 1000);
        }
    }

    return totalConnected / 60000; // minutes
}
