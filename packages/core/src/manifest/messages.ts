// Every message the manifest loader and schema can show a seller. pnpm lint:wording checks them.
export const MANIFEST_TEXT = Object.freeze({
  envRefused: 'Environment files are never read.',
  cannotOpen: 'The manifest file could not be opened.',
  tooLarge: 'The manifest file is larger than 1 MB.',
  notJson: 'The manifest is not valid JSON.',
  wrongFormat: 'The manifest does not match the expected format.',
  address: 'an address is 0x followed by 40 hex characters',
  route: 'a route is a path starting with /, with no spaces or backticks',
  price: "a price is a whole number of the asset's smallest units",
  network: 'a network looks like eip155:84532',
  addressOrIndex: 'give exactly one of address or index',
  routeTwice: 'this route is listed twice',
  topLevel: '(top level)',
});
