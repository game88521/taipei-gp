/** Rex <game88521@gmail.com>. Shared capability and typed failure codes; no browser or credential dependencies. */
export const CITY_AUTO_RESUME_VERSION='frontier-city-resume-v1';
export const CITY_RESUME_TERMINAL_CODES=['SEAT_EXPIRED','SEAT_REJECTED','VERSION_MISMATCH','ROOM_GONE'] as const;
export const CITY_RESUME_RETRYABLE_CODES=['SEAT_BUSY'] as const;
export type CityResumeCode=typeof CITY_RESUME_TERMINAL_CODES[number]|typeof CITY_RESUME_RETRYABLE_CODES[number];
export const cityResumeTerminal=(code:unknown):boolean=>typeof code==='string'&&(CITY_RESUME_TERMINAL_CODES as readonly string[]).includes(code);
