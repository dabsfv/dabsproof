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
  networksLabel: 'Networks checked:',
  escalationLead: 'The severity could rise to',
  severityLabel: 'severity:',
  versionLabel: 'version',
  schemesSeparate:
    'Routes with different payment schemes were compared separately. This report says nothing about whether a payment made under one scheme works on a route that uses another.',
  nothingFixed: 'Nothing was checked: no route had fixed payment terms in the configuration.',
  notExportedHeading: 'These routes could not be checked, because the configuration does not fix their payment terms:',
  notExportedOverall: 'Because of these routes, the overall result is could not verify.',
  perResourceLeftOut:
    'These routes give each item its own address. X402-03.cross-route and X402-03.dup-index did not compare them with any other route; X402-03.index-range-overlap below says whether their address ranges could be compared:',
  otherNetworks:
    'These routes are on networks other than Base Sepolia. They were checked from your route manifest only; live checks run on Base Sepolia only:',
  queryVariantsNotTried:
    'Tiers chosen by details of the request, such as a query string, were not tried; that is part of the live checks.',
  previousLabel: 'Earlier manifests compared:',
  previousUnreadableHeading: 'These earlier manifests could not be read:',
  movedHeading: 'These routes have a different payment address or index than in your earlier manifest:',
  reusedOtherTermsHeading:
    'These payment addresses or address indexes belonged to a different route in your earlier manifest, which had a different price or other terms:',
  earlierGivenTo: 'earlier given to',
  wasLabel: 'was',
  nowLabel: 'now',
  tierLabel: 'tier',
  schemeLabel: 'scheme',
  addressIndexLabel: 'address index',
  addressIndexesLabel: 'address indexes',
  rangeTo: 'to',
  baseIndexLabel: 'base address index',
  outcomeCount: 'Outcome',
  count: 'Count',
});

/** Every fixed sentence a seller can read from the static check: report text and manifest messages. */
export const reportSentences = (): string[] => [...Object.values(REPORT_TEXT), ...Object.values(MANIFEST_TEXT)];
