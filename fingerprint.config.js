/**
 * What counts toward the runtime version (app.config.ts uses the fingerprint policy). Over-the-air
 * updates only reach APKs with the same fingerprint, so leave out things that never change native
 * code: npm scripts and .gitignore. Editing them must not cut installed APKs off from updates.
 * @type {import('expo/fingerprint').Config}
 */
const { SourceSkips } = require('expo/fingerprint');

module.exports = {
  sourceSkips: SourceSkips.PackageJsonScriptsAll | SourceSkips.GitIgnore,
};
