const CODE = /^[a-z][a-z-]{2,40}$/;

/** 200 with only the address. */
export const paid = (address) => Response.json({ payTo: address });

/**
 * 503 with only an error code: the fix kit's FixkitError code, else 'unexpected'. The message is
 * never used. The check is by name, not instanceof: in the spike, a value set in a module by
 * register() did not reach a route, so the error here may come from a different copy of the fix kit.
 */
export function refusal(error) {
  const code =
    error && error.name === 'FixkitError' && typeof error.code === 'string' && CODE.test(error.code)
      ? error.code
      : 'unexpected';
  return Response.json({ refused: code }, { status: 503 });
}
