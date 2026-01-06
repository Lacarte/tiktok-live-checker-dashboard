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

    const sessions = [];
    let sessionStart = sorted[0].datetime;
    let sessionDuration = 0;

    for (let i = 1; i < sorted.length; i++) {
        const diff = sorted[i].datetime - sorted[i - 1].datetime;

        if (diff <= MAX_GAP) {
            // Continue current session
            sessionDuration += Math.min(diff, 15 * 60 * 1000);
        } else {
            // End current session, start new one
            if (sessionDuration > 0) {
                sessions.push({
                    start: sessionStart,
                    end: sorted[i - 1].datetime,
                    duration: sessionDuration / 60000 // minutes
                });
            }
            sessionStart = sorted[i].datetime;
            sessionDuration = 0;
        }
    }

    // Push last session if it has duration
    if (sessionDuration > 0) {
        sessions.push({
            start: sessionStart,
            end: sorted[sorted.length - 1].datetime,
            duration: sessionDuration / 60000
        });
    }

    // If only one record or no valid sessions, create a minimal session
    if (sessions.length === 0 && sorted.length > 0) {
        sessions.push({
            start: sorted[0].datetime,
            end: sorted[sorted.length - 1].datetime,
            duration: 0
        });
    }

    return sessions;
}
