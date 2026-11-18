// Sentences and values shared by every registry entry. A seller reads the sentences,
// so they follow the wording rules: plain English, UK spelling, no claims.

/** Ends every "found no problem" text. */
export const COVERS_ONLY = 'This covers only what this check tried.';

/** Carried by every remediation. */
export const GENERAL_GUIDANCE = 'General guidance. It has not been tested on your service.';

/** Opens every "could not verify" text. */
export const COULD_NOT_VERIFY =
  'The check could not finish, for example because a service it depends on did not answer. This is not a finding about your service.';

/** Follows the first mention of "facilitator" in each entry's text. */
export const FACILITATOR_GLOSS = '(the payment service that checks and settles payments)';

/** First changelog line of a check that has a severity. */
export const FIRST_VERSION = 'First version. The severity is a starting point and will be reviewed after real runs.';

export const FIRST_DATE = '2026-11-18';

/** Base Sepolia, the only network these checks use. */
export const BASE_SEPOLIA = 'eip155:84532';
