// Module resolve hook: a relative import without an extension tries `.ts`, then `.tsx`.
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (e) {
    if (!specifier.startsWith('.') || /\.[cm]?[jt]sx?$/.test(specifier)) throw e;
    for (const ext of ['.ts', '.tsx']) {
      try {
        return await next(specifier + ext, context);
      } catch {
        // try the next extension
      }
    }
    throw e;
  }
}
