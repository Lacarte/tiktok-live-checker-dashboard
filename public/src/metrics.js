export function computeScore(minutesConnected, avgFollowers) {
    // Simple score: minutes * followers
    return minutesConnected * avgFollowers;
}
