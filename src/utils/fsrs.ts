import { getStorage, updateStorage } from './storage';

// Simplified FSRS configuration
const DEFAULT_STABILITY = 1;
const DEFAULT_DIFFICULTY = 5;

// Grades map roughly to mastery score 1 (forgot), 2 (hard), 3 (good), 4 (easy)
// For our Mastery 1-5, we'll map: 1, 2 -> forgot(1); 3 -> hard(2); 4 -> good(3); 5 -> easy(4)
export const calculateNextReview = (
    masteryScore: number,
    currentStability: number,
    currentDifficulty: number
) => {
    let grade = 1;
    if (masteryScore === 3) grade = 2;
    else if (masteryScore === 4) grade = 3;
    else if (masteryScore === 5) grade = 4;

    let newDifficulty = currentDifficulty - (grade - 3) * 0.5;
    newDifficulty = Math.max(1, Math.min(10, newDifficulty));

    let newStability = currentStability;
    if (grade === 1) {
        newStability = Math.max(0.1, currentStability * 0.2);
    } else {
        const factor = grade === 2 ? 1.5 : grade === 3 ? 2.5 : 3.5;
        newStability = currentStability * factor;
    }

    // Next due date in ms
    const scheduledDays = Math.max(1, Math.round(newStability));
    const due = Date.now() + scheduledDays * 24 * 60 * 60 * 1000;

    return { stability: newStability, difficulty: newDifficulty, scheduled_days: scheduledDays, due };
};

export const processReview = async (nodeId: string, masteryScore: number) => {
    const storage = await getStorage();
    const record = storage.fsrsData[nodeId];
    if (!record) return;

    const { stability, difficulty, scheduled_days, due } = calculateNextReview(
        masteryScore,
        record.stability || DEFAULT_STABILITY,
        record.difficulty || DEFAULT_DIFFICULTY
    );

    const updatedRecord = {
        ...record,
        stability,
        difficulty,
        scheduled_days,
        due,
        state: 'Review' as const,
        reps: record.reps + 1,
        lapses: masteryScore <= 2 ? record.lapses + 1 : record.lapses
    };

    // Check if it's a new day to reset today's counters.
    const todayStr = new Date().toISOString().split('T')[0];
    let newCompletedRevisions = storage.completedRevisionsToday;
    let newRevisionSecondsToday = storage.revisionSecondsToday;
    let newLastDate = storage.lastRevisionDate;

    if (storage.lastRevisionDate !== todayStr) {
        newCompletedRevisions = 1; // It's a new day, this is the 1st
        newRevisionSecondsToday = 0;
        newLastDate = todayStr;
    } else {
        newCompletedRevisions += 1;
    }

    await updateStorage({
        fsrsData: { ...storage.fsrsData, [nodeId]: updatedRecord },
        completedRevisionsToday: newCompletedRevisions,
        revisionSecondsToday: newRevisionSecondsToday,
        lastRevisionDate: newLastDate,
    });
};

export const addRevisionSeconds = async (sessionSecondsSpent: number) => {
    const storage = await getStorage();
    const safeSeconds = Math.max(0, Math.round(sessionSecondsSpent));

    if (safeSeconds === 0) return;

    const todayStr = new Date().toISOString().split('T')[0];
    let newRevisionSecondsToday = storage.revisionSecondsToday;
    let newCompletedRevisions = storage.completedRevisionsToday;
    let newLastDate = storage.lastRevisionDate;

    if (storage.lastRevisionDate !== todayStr) {
        newRevisionSecondsToday = safeSeconds;
        newCompletedRevisions = 0;
        newLastDate = todayStr;
    } else {
        newRevisionSecondsToday += safeSeconds;
    }

    await updateStorage({
        revisionSecondsToday: newRevisionSecondsToday,
        completedRevisionsToday: newCompletedRevisions,
        lastRevisionDate: newLastDate,
    });
};

export const getTodaysReviews = async () => {
    const storage = await getStorage();
    const now = Date.now();

    // Check daily limit reset
    const todayStr = new Date().toISOString().split('T')[0];
    if (storage.lastRevisionDate !== todayStr) {
        // Reset completed revisions for the new day
        await updateStorage({
            completedRevisionsToday: 0,
            revisionSecondsToday: 0,
            lastRevisionDate: todayStr
        });
        storage.completedRevisionsToday = 0; // Update local reference
        storage.revisionSecondsToday = 0;
    }

    const dailyLimitMinutes = Math.max(10, storage.dailyRevisionMinutesLimit || 60);
    if (storage.revisionSecondsToday >= dailyLimitMinutes * 60) {
        return []; // Time budget reached for today.
    }

    // Find all due items
    const dueItems = Object.entries(storage.fsrsData)
        .filter(([, data]) => data.due <= now)
        .map(([nodeId]) => nodeId);

    // Shuffle due items for variety.
    const shuffled = dueItems.sort(() => 0.5 - Math.random());
    return shuffled;
};
