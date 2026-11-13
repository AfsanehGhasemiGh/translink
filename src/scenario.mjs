export function calculateScenario(baseline, proposed, shift, transferWindow = 8) {
  for (const [name, value, min, max] of [
    ['Baseline headway', baseline, 2, 60],
    ['Proposed headway', proposed, 2, 60],
    ['Timetable shift', shift, 0, 30],
    ['Transfer window', transferWindow, 0, 30],
  ]) {
    if (!Number.isFinite(value) || value < min || value > max) {
      throw new RangeError(`${name} must be between ${min} and ${max}.`);
    }
  }
  return {
    baselineWait: baseline / 2,
    proposedWait: proposed / 2,
    waitChange: proposed / 2 - baseline / 2,
    baselineServices: 60 / baseline,
    proposedServices: 60 / proposed,
    missedConnection: shift > transferWindow,
    remainingTransfer: transferWindow - shift,
  };
}
