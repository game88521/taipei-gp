// Rex <game88521@gmail.com>. Offline readiness check; never emits secret values.
import {pathToFileURL} from 'node:url';

export function checkResumeConfig(env = process.env) {
  const meridian = env.MERIDIAN_CHECKPOINT_SECRET;
  const series = env.SERIES_RESUME_SECRET;
  const state = (value, valid) => value === undefined ? 'MISSING' : valid ? 'CONFIGURED' : 'INVALID';
  const checks = {
    MERIDIAN_CHECKPOINT_SECRET: state(meridian, typeof meridian === 'string' && /^[a-f0-9]{64}$/.test(meridian)),
    SERIES_RESUME_SECRET: state(series, typeof series === 'string' && Buffer.byteLength(series) >= 32 && Buffer.byteLength(series) <= 4096),
  };
  return {
    status: Object.values(checks).every(value => value === 'CONFIGURED') ? 'READY' : 'ACTION_REQUIRED',
    checks,
    stationOnly: true,
    liveRacePersistence: false,
    secretValuesIncluded: false,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 2) {
    console.error('此檢查不接受命令列參數。請由伺服器私密環境注入金鑰。');
    process.exitCode = 2;
  } else {
    const report = checkResumeConfig();
    console.log(JSON.stringify(report));
    if (report.status !== 'READY') process.exitCode = 1;
  }
}
