// Patterns shared by the T3 guard and its own unit test, so both use the same one.

/**
 * An @x402/ package named as a module specifier: a quote, apostrophe or backtick right before "@x402/".
 * Limit: text inside a comment that itself quotes '@x402/...' would also match.
 */
export const X402_SPECIFIER = /["'\x60]@x402\//;
