// Every fixed sentence the report prints. pnpm lint:wording checks all of them.
import { MANIFEST_TEXT } from '../manifest/messages.js';

export const REPORT_TEXT = Object.freeze({
  fromManifest: 'Found from your route manifest, not from a live run.',
  nothingChecked: 'Nothing was checked: only Base Sepolia is checked.',
  skippedRoutes: 'These routes were not checked, because only Base Sepolia (eip155:84532) is checked:',
  sameMistake: 'Same mistake as above: fixing the repeated index fixes both.',
  noIndex: 'No route in this manifest uses an address index.',
  sharedHeading: 'These routes, as written in your manifest:',
  whatSomeoneCouldDo: 'What someone could do:',
  howToFix: 'How to fix',
  notAFix: 'Not a fix:',
  coverage:
    'This report covers only the manifest given. Nothing was sent to any server, and routes or settings that the manifest does not hold were not looked at.',
  invalidManifest: 'The manifest could not be checked, so nothing was checked.',
  manifestLabel: 'Manifest:',
  routesReadLabel: 'Routes read:',
  networkLabel: 'Network checked:',
  escalationLead: 'The severity could rise to',
  severityLabel: 'severity:',
  versionLabel: 'version',
  outcomeCount: 'Outcome',
  count: 'Count',
});

/** Every fixed sentence a seller can read from the static check: report text and manifest messages. */
export const reportSentences = (): string[] => [...Object.values(REPORT_TEXT), ...Object.values(MANIFEST_TEXT)];
