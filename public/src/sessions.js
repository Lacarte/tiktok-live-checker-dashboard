const MAX_GAP = 45 * 60 * 1000; // 45 min

export function computeSessions(records) {
    if (!records || records.length === 0) return 0;

    // Sort by time
    records.sort((a, b) => a.datetime - b.datetime);

    let totalConnected = 0;

    for (let i = 1; i < records.length; i++) {
        const diff = records[i].datetime - records[i - 1].datetime;
        if (diff <= MAX_GAP) {
            totalConnected += Math.min(diff, 15 * 60 * 1000);
        }
    }

    return totalConnected / 60000; // minutes
}

export function computeSessionsList(records) {
    if (!records || records.length === 0) return [];

    // Sort by time
    const sorted = [...records].sort((a, b) => a.datetime - b.datetime);

    // If only one record, return a single session
    if (sorted.length === 1) {
        return [{
            start: sorted[0].datetime,
            end: sorted[0].datetime,
            duration: 5 // Assume minimum 5 min for a single ping
        }];
    }

    const sessions = [];
    let sessionStart = sorted[0].datetime;
    let sessionEnd = sorted[0].datetime;
    let sessionDuration = 0;

    for (let i = 1; i < sorted.length; i++) {
        const diff = sorted[i].datetime - sorted[i - 1].datetime;

        if (diff <= MAX_GAP) {
            // Continue current session
            sessionDuration += Math.min(diff, 15 * 60 * 1000);
            sessionEnd = sorted[i].datetime;
        } else {
            // End current session, start new one
            sessions.push({
                start: sessionStart,
                end: sessionEnd,
                duration: sessionDuration > 0 ? sessionDuration / 60000 : 5 // minimum 5 min
            });
            sessionStart = sorted[i].datetime;
            sessionEnd = sorted[i].datetime;
            sessionDuration = 0;
        }
    }

    // Always push the last session
    sessions.push({
        start: sessionStart,
        end: sessionEnd,
        duration: sessionDuration > 0 ? sessionDuration / 60000 : 5 // minimum 5 min
    });

    return sessions;
}
