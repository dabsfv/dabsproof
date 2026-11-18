// The report cases used by the golden-file and format tests: every manifest fixture, the two
// runs with an earlier manifest, and one invalid manifest.
import { brand } from '@dabsproof/brand';
import {
  analyse,
  buildInvalidManifestDocument,
  buildStaticReportDocument,
  describeIssues,
  loadManifest,
  MANIFEST_TEXT,
  ManifestSchema,
  type ReportDocument,
} from '../src/index.js';
import { FIXTURES, fixturePath, shownPath } from './fixtures.js';

export interface Case {
  name: string;
  doc: () => ReportDocument<unknown>;
}

const load = (name: string) => {
  const r = loadManifest(fixturePath(name));
  if (!r.ok) throw new Error(`${name} did not load`);
  return r.manifest;
};

const withPrevious = (name: string, prevName: string): Case => ({
  name: `${name}--previous-${prevName}`,
  doc: () =>
    buildStaticReportDocument(brand.productName, shownPath(name), analyse(load(name), { previous: [load(prevName)] }), {
      read: [shownPath(prevName)],
      unreadable: [],
    }),
});

/** A fixed invalid manifest, so its issues are the same on every run. */
const INVALID = {
  manifestVersion: 1,
  routes: [{ route: '/api/a', price: 'one', asset: '0x1', network: 'eip155:84532', index: 0, extra: 1 }],
};

export const CASES: Case[] = [
  ...FIXTURES.map(
    (name): Case => ({
      name,
      doc: () => buildStaticReportDocument(brand.productName, shownPath(name), analyse(load(name))),
    }),
  ),
  withPrevious('stale-reuse', 'stale-previous'),
  withPrevious('hd-moved', 'hd'),
  {
    name: 'invalid-manifest',
    doc: () => {
      const r = ManifestSchema.safeParse(INVALID);
      if (r.success) throw new Error('the invalid case parsed');
      return buildInvalidManifestDocument(
        brand.productName,
        'fixtures/manifests/invalid.json',
        MANIFEST_TEXT.wrongFormat,
        describeIssues(r.error.issues),
      );
    },
  },
];

/** Golden files hold <productName> instead of the name, so the name stays only in brand. */
export const withoutName = (s: string): string => s.split(brand.productName).join('<productName>');
