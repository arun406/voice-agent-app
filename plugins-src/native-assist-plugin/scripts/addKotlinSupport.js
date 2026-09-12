// Identical purpose to local-llm-plugin/scripts/addKotlinSupport.js — see that file's
// comment for why this is needed and what's unverified. Deliberately duplicated rather
// than shared so either plugin works when installed on its own.

const fs = require('fs');
const path = require('path');

const KOTLIN_VERSION = '1.9.24';
const CLASSPATH_LINE = `        classpath "org.jetbrains.kotlin:kotlin-gradle-plugin:${KOTLIN_VERSION}"`;

module.exports = function (context) {
  const projectRoot = context.opts.projectRoot;
  const rootBuildGradle = path.join(projectRoot, 'platforms', 'android', 'build.gradle');

  if (!fs.existsSync(rootBuildGradle)) {
    console.warn(`[native-assist-plugin] ${rootBuildGradle} not found — skipping Kotlin classpath injection.`);
    return;
  }

  let contents = fs.readFileSync(rootBuildGradle, 'utf8');
  if (contents.includes('kotlin-gradle-plugin')) {
    return; // already patched (possibly by local-llm-plugin's copy of this hook)
  }

  const buildscriptDepsMatch = contents.match(/buildscript\s*{[^}]*dependencies\s*{/);
  if (!buildscriptDepsMatch) {
    console.warn('[native-assist-plugin] Could not find buildscript { dependencies { ... } } block to patch — add the Kotlin classpath manually:');
    console.warn(`[native-assist-plugin]   ${CLASSPATH_LINE.trim()}`);
    return;
  }

  const insertAt = buildscriptDepsMatch.index + buildscriptDepsMatch[0].length;
  contents = contents.slice(0, insertAt) + '\n' + CLASSPATH_LINE + contents.slice(insertAt);
  fs.writeFileSync(rootBuildGradle, contents, 'utf8');
  console.log('[native-assist-plugin] Injected Kotlin Gradle plugin classpath into platforms/android/build.gradle');
};
