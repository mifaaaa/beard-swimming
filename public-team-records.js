let lastLiveTeamSnapshot = null;
let publicTeamBackupDate = null;

function publicTeamSnapshot(records, updatedAt) {
  return {
    updatedAt,
    records: records.filter(r => EVENTS[r.course]?.includes(r.event) && ['男', '女'].includes(r.gender))
      .map(r => ({
        course: r.course, gender: r.gender, event: r.event, holder: r.holder,
        seconds: Number(r.seconds), record_series_name: recordMeetLabel(r), publicDate: teamDate(r)
      }))
  };
}

async function restorePublishedTeamRecords(generation) {
  let cached;
  try { cached = await scoreDB('get', 'public-records'); } catch {}
  let snapshot;
  try {
    const response = await fetch('./public-team-records.json', {
      cache: 'no-cache', signal: AbortSignal.timeout(4000)
    });
    if (response.ok) snapshot = await response.json();
  } catch {}
  const havePublished = Number.isFinite(Date.parse(snapshot?.updatedAt)) && Array.isArray(snapshot.records) &&
      snapshot.records.length && snapshot.records.every(r =>
        r && EVENTS[r.course]?.includes(r.event) && ['男', '女'].includes(r.gender) &&
        typeof r.holder === 'string' && Number.isFinite(r.seconds) && r.seconds > 0 &&
        typeof r.record_series_name === 'string' && typeof r.publicDate === 'string');
  if (!havePublished || (cached?.records?.length && cached.at > Date.parse(snapshot.updatedAt))) {
    if (!cached?.records?.length || !Number.isFinite(cached.at)) return false;
    snapshot = publicTeamSnapshot(cached.records, new Date(cached.at).toISOString());
  }
  if (generation !== cloudGeneration) return false;

  clearCoachData();
  state.records = snapshot.records;
  publicTeamBackupDate = snapshot.updatedAt;
  scoreOffline = true;
  render();
  return true;
}

function downloadPublishedTeamRecords() {
  if (!state.coach || scoreOffline || !lastLiveTeamSnapshot?.records.length) return;
  const file = new Blob([JSON.stringify(lastLiveTeamSnapshot, null, 2) + '\n'], {
    type: 'application/json'
  });
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'public-team-records.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
